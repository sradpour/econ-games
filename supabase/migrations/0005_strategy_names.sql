-- Strategy names for the tournament.
alter table public.strategies add column if not exists name text not null default '';
alter table public.strategies add column if not exists submitted_name text;
drop function if exists public.save_strategy(uuid, text, text, text, boolean);

create or replace function public.save_strategy(p_session uuid, p_description text, p_code text, p_explanation text, p_submit boolean, p_name text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.sessions;
  sp public.session_players;
  v_name text;
begin
  perform private.me();
  select * into s from public.sessions where id = p_session;
  if s.game_type <> 'pd_tournament' then raise exception 'Not a strategy tournament.'; end if;
  if s.status not in ('running', 'lobby') then raise exception 'Strategy submissions are closed.'; end if;
  select * into sp from public.session_players where session_id = p_session and user_id = auth.uid();
  if sp.team_id is null then raise exception 'Join a team first.'; end if;
  if length(coalesce(p_code, '')) > 20000 or length(coalesce(p_description, '')) > 5000 then
    raise exception 'Strategy is too long.';
  end if;
  v_name := left(trim(coalesce(p_name, '')), 40);
  -- The draft is always updated; the submitted copy only changes when the team submits.
  insert into public.strategies(session_id, team_id, name, description, code, explanation, updated_by, updated_at)
  values (p_session, sp.team_id, v_name, coalesce(p_description, ''), coalesce(p_code, ''), coalesce(p_explanation, ''), auth.uid(), now())
  on conflict (session_id, team_id) do update set
    name = case when p_name is null then public.strategies.name else excluded.name end,
    description = excluded.description, code = excluded.code, explanation = excluded.explanation,
    updated_by = excluded.updated_by, updated_at = now();
  if p_submit then
    if (select coalesce(trim(name), '') from public.strategies where session_id = p_session and team_id = sp.team_id) = '' then
      raise exception 'Give your strategy a name before submitting.';
    end if;
    update public.strategies set submitted = true, submitted_at = now(), submitted_by = auth.uid(),
      submitted_name = name, submitted_description = description, submitted_code = code, submitted_explanation = explanation
    where session_id = p_session and team_id = sp.team_id;
  end if;
  perform private.bump(p_session);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.get_state(p_session uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  s public.sessions;
  st private.session_state;
  sp public.session_players;
  v_mode text;
  cap uuid;
  my_dec jsonb;
  v_required boolean := false;
  res jsonb;
begin
  perform private.me();
  select * into s from public.sessions where id = p_session;
  if s.id is null or not public.can_see_session(p_session) then raise exception 'Game not found.'; end if;
  select * into st from private.session_state where session_id = p_session;
  select * into sp from public.session_players where session_id = p_session and user_id = auth.uid();
  v_mode := private.team_mode(s);

  res := jsonb_build_object(
    'server_now', now(),
    'session', jsonb_build_object(
      'id', s.id, 'title', s.title, 'game_type', s.game_type, 'config', s.config, 'status', s.status,
      'round_no', s.round_no, 'stage', s.stage, 'stage_ends_at', s.stage_ends_at,
      'paused_remaining_ms', s.paused_remaining_ms, 'version', s.version, 'team_mode', v_mode,
      'team_cap', private.team_cap(s),
      'class_name', (select name from public.classes where id = s.class_id),
      'player_count', (select count(*) from public.session_players where session_id = s.id)
    ),
    'joined', sp.user_id is not null
  );
  if sp.user_id is null then return res; end if;

  if sp.team_id is not null and s.round_no > 0 then
    cap := private.captain_of(sp.team_id, s.round_no);
  end if;
  if sp.team_id is not null and st.session_id is not null then
    v_required := sp.team_id = any (st.required_team_ids);
    select payload into my_dec from public.decisions
     where session_id = s.id and round_no = s.round_no and stage = s.stage and team_id = sp.team_id;
  end if;

  res := res || jsonb_build_object(
    'me', jsonb_build_object(
      'user_id', sp.user_id, 'passed_check', sp.passed_check, 'team_id', sp.team_id,
      'is_captain', cap = sp.user_id,
      'captain_name', (select coalesce(full_name, email) from public.profiles where id = cap),
      'required', v_required, 'decision', my_dec,
      'decision_by', (select coalesce(p.full_name, p.email) from public.decisions d join public.profiles p on p.id = d.submitted_by
                      where d.session_id = s.id and d.round_no = s.round_no and d.stage = s.stage and d.team_id = sp.team_id)
    ),
    'team', case when sp.team_id is null then null else jsonb_build_object(
      'id', sp.team_id, 'name', (select name from public.teams where id = sp.team_id),
      'members', coalesce((select jsonb_agg(jsonb_build_object('name', m.full_name, 'is_me', m.user_id = sp.user_id) order by m.ord)
                           from private.team_members(sp.team_id) m), '[]')
    ) end,
    'teams', case when v_mode = 'teams' and s.status <> 'finished' then coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'name', t.name,
        'members', coalesce((select jsonb_agg(m.full_name order by m.ord) from private.team_members(t.id) m), '[]'))
        order by t.created_at)
      from public.teams t where t.session_id = s.id), '[]') else null end,
    'assignment', (select info from public.assignments where session_id = s.id and round_no = s.round_no and team_id = sp.team_id),
    'results', coalesce((select jsonb_agg(r.payload || jsonb_build_object('round_no', r.round_no) order by r.round_no)
                         from public.results r where r.session_id = s.id and r.team_id = sp.team_id), '[]'),
    'public', coalesce((select jsonb_agg(p.payload || jsonb_build_object('round_no', p.round_no) order by p.round_no)
                        from public.round_public p where p.session_id = s.id), '[]'),
    'outputs', coalesce((select jsonb_object_agg(o.kind, o.payload) from public.session_outputs o
                         where o.session_id = s.id and o.visibility = 'students'), '{}'),
    'progress', case when st.session_id is null then null else jsonb_build_object(
      'required', cardinality(st.required_team_ids),
      'submitted', (select count(*) from public.decisions d where d.session_id = s.id and d.round_no = s.round_no
                    and d.stage = s.stage and d.team_id = any (st.required_team_ids))) end
  );

  -- Full history for everyone at the end, if the instructor chose to reveal it
  if s.status = 'finished' and coalesce((s.config->>'reveal_at_end')::boolean, true)
     and s.game_type in ('competitive','monopolistic','oligopoly','monopoly') then
    res := res || jsonb_build_object('all_results', coalesce((
      select jsonb_agg(jsonb_build_object('team', t.name, 'round_no', r.round_no, 'price', r.payload->'price',
                                          'produced', r.payload->'produced', 'sold', r.payload->'sold',
                                          'branding', r.payload->'branding', 'profit', r.payload->'profit')
                       order by r.round_no, t.name)
      from public.results r join public.teams t on t.id = r.team_id where r.session_id = s.id), '[]'));
  end if;

  if s.game_type = 'pd_tournament' and sp.team_id is not null then
    res := res || jsonb_build_object('strategy', (
      select jsonb_build_object('name', x.name, 'submitted_name', x.submitted_name,
                                'description', x.description, 'code', x.code, 'explanation', x.explanation,
                                'submitted', x.submitted, 'submitted_code', x.submitted_code, 'submitted_at', x.submitted_at,
                                'submitted_by', (select coalesce(full_name, email) from public.profiles where id = x.submitted_by),
                                'translations_used', x.translations_used, 'updated_at', x.updated_at,
                                'updated_by', (select coalesce(full_name, email) from public.profiles where id = x.updated_by))
      from public.strategies x where x.session_id = s.id and x.team_id = sp.team_id));
  end if;
  return res;
end $$;

create or replace function public.instructor_state(p_session uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  s public.sessions;
  st private.session_state;
begin
  s := private.require_owner(p_session);
  select * into st from private.session_state where session_id = p_session;
  return jsonb_build_object(
    'server_now', now(),
    'session', to_jsonb(s) || jsonb_build_object('team_mode', private.team_mode(s), 'team_cap', private.team_cap(s),
               'class_name', (select name from public.classes where id = s.class_id),
               'join_code', (select join_code from public.classes where id = s.class_id)),
    'last_error', st.last_error, 'last_error_at', st.last_error_at,
    'required', to_jsonb(st.required_team_ids),
    'players', coalesce((select jsonb_agg(jsonb_build_object(
        'user_id', p.id, 'name', p.full_name, 'email', p.email, 'student_id', p.student_id,
        'team_id', sp.team_id, 'passed_check', sp.passed_check, 'joined_at', sp.joined_at) order by p.full_name)
      from public.session_players sp join public.profiles p on p.id = sp.user_id where sp.session_id = s.id), '[]'),
    'teams', coalesce((select jsonb_agg(jsonb_build_object(
        'id', t.id, 'name', t.name, 'is_solo', t.is_solo,
        'captain', (select coalesce(full_name, email) from public.profiles where id = private.captain_of(t.id, s.round_no)),
        'members', coalesce((select jsonb_agg(m.full_name order by m.ord) from private.team_members(t.id) m), '[]'))
        order by t.created_at)
      from public.teams t where t.session_id = s.id), '[]'),
    'decisions', coalesce((select jsonb_agg(jsonb_build_object('team_id', d.team_id, 'payload', d.payload,
        'by', (select coalesce(full_name, email) from public.profiles where id = d.submitted_by), 'at', d.submitted_at))
      from public.decisions d where d.session_id = s.id and d.round_no = s.round_no and d.stage = s.stage), '[]'),
    'results', coalesce((select jsonb_agg(jsonb_build_object('team_id', r.team_id, 'round_no', r.round_no,
        'payload', r.payload, 'earnings', r.earnings) order by r.round_no)
      from public.results r where r.session_id = s.id), '[]'),
    'public', coalesce((select jsonb_agg(p.payload || jsonb_build_object('round_no', p.round_no) order by p.round_no)
      from public.round_public p where p.session_id = s.id), '[]'),
    'outputs', coalesce((select jsonb_object_agg(o.kind, o.payload) from public.session_outputs o where o.session_id = s.id), '{}'),
    'strategies', coalesce((select jsonb_agg(jsonb_build_object('team_id', x.team_id,
        'name', coalesce(nullif(x.submitted_name, ''), x.name),
        'description', coalesce(x.submitted_description, x.description), 'code', coalesce(x.submitted_code, x.code),
        'explanation', coalesce(x.submitted_explanation, x.explanation), 'submitted', x.submitted,
        'has_newer_draft', x.submitted and (x.code is distinct from x.submitted_code or x.name is distinct from x.submitted_name), 'updated_at', x.updated_at))
      from public.strategies x where x.session_id = s.id), '[]')
  );
end $$;

revoke execute on function public.save_strategy(uuid, text, text, text, boolean, text) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke execute on function public.save_strategy(uuid, text, text, text, boolean, text) from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then grant execute on function public.save_strategy(uuid, text, text, text, boolean, text) to authenticated; end if;
end $$;
