-- Homework: an optional due date for self-paced games, after which the game closes itself and is scored,
-- and a hint so a student who opens a game link before joining the class can be asked for the class code.

alter table public.sessions add column if not exists closes_at timestamptz;

create or replace function public.create_session(p_class uuid, p_game_type text, p_title text, p_config jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v public.profiles; s public.sessions; v_due timestamptz;
begin
  v := private.require_instructor();
  if not exists (select 1 from public.classes where id = p_class and (instructor_id = v.id or v.is_admin)) then
    raise exception 'Not your class.';
  end if;
  if p_game_type = 'costs' and coalesce(p_config->>'pace', '') = 'self' then
    p_config := p_config || jsonb_build_object('team_mode', 'individual', 'round_seconds', 0);
  end if;
  -- Optional due date (self-paced games only): the game closes itself then.
  if p_game_type = 'costs' and coalesce(p_config->>'pace', '') = 'self' then
    v_due := nullif(p_config->>'due_at', '')::timestamptz;
  end if;
  p_config := p_config - 'due_at';
  insert into public.sessions(class_id, instructor_id, game_type, title, config, closes_at)
  values (p_class, (select instructor_id from public.classes where id = p_class), p_game_type,
          coalesce(nullif(trim(p_title), ''), p_game_type), coalesce(p_config, '{}'), v_due)
  returning * into s;
  insert into private.session_state(session_id) values (s.id);
  -- Self-paced (assignment / practice) games open right away: no Start button, students join any time.
  if private.self_paced(s) then perform private.call_engine(s.id, 'start'); end if;
  return jsonb_build_object('id', s.id);
end $$;

-- Set, change or clear the due date of an open self-paced game.
create or replace function public.instructor_set_due(p_session uuid, p_due timestamptz) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.sessions;
begin
  s := private.require_owner(p_session);
  if not private.self_paced(s) then raise exception 'Only assignment / practice games have a due date.'; end if;
  if s.status = 'finished' then raise exception 'This game is already closed.'; end if;
  update public.sessions set closes_at = p_due, version = version + 1 where id = p_session;
  return jsonb_build_object('ok', true, 'closes_at', p_due);
end $$;

-- For a game link opened by someone not (yet) in the class: which class it belongs to.
create or replace function public.game_class_hint(p_session uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s public.sessions; c public.classes;
begin
  perform private.me();
  if public.can_see_session(p_session) then return jsonb_build_object('member', true); end if;
  select * into s from public.sessions where id = p_session;
  if s.id is null then return null; end if;
  select * into c from public.classes where id = s.class_id;
  if c.id is null or c.archived then return null; end if;
  return jsonb_build_object('member', false, 'class_name', c.name,
    'instructor', (select coalesce(full_name, email) from public.profiles where id = c.instructor_id));
end $$;

-- Run every few seconds by pg_cron: advance timed stages, and close self-paced games whose due date has passed.
create or replace function public.tick() returns int
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  n int := 0;
begin
  for r in select s.id from public.sessions s where s.status = 'running' and s.stage is not null loop
    if private.maybe_advance(r.id) then n := n + 1; end if;
  end loop;
  for r in select s.id from public.sessions s join private.session_state st on st.session_id = s.id
           where s.closes_at is not null and s.closes_at <= now() and s.status in ('running', 'paused')
             and private.self_paced(s) and (st.advancing_until is null or st.advancing_until < now()) loop
    update private.session_state set advancing_until = now() + interval '20 seconds' where session_id = r.id;
    perform private.call_engine(r.id, 'finish');
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.class_sessions(p_class uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.me();
  if not exists (select 1 from public.class_members where class_id = p_class and user_id = auth.uid())
     and not exists (select 1 from public.classes where id = p_class and instructor_id = auth.uid()) then
    raise exception 'You are not in this class.';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', s.id, 'title', s.title, 'game_type', s.game_type, 'status', s.status, 'created_at', s.created_at,
      'closes_at', s.closes_at, 'self_paced', private.self_paced(s),
      'joined', exists (select 1 from public.session_players sp where sp.session_id = s.id and sp.user_id = auth.uid()))
      order by s.created_at desc)
    from public.sessions s where s.class_id = p_class), '[]');
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
      'player_count', (select count(*) from public.session_players where session_id = s.id),
      'closes_at', s.closes_at
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


create or replace function public.submit_decision(p_session uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s public.sessions;
  st private.session_state;
  sp public.session_players;
  cap uuid;
  existing public.decisions;
  backup boolean;
begin
  perform private.me();
  -- Lock the game row exclusively up front. (FOR SHARE here, followed by the version bump below, let two
  -- simultaneous submissions each hold a share lock and wait for the other's: a deadlock. Now they queue.)
  select * into s from public.sessions where id = p_session for no key update;
  select * into st from private.session_state where session_id = p_session;
  select * into sp from public.session_players where session_id = p_session and user_id = auth.uid();
  if sp.user_id is null then raise exception 'Join the game first.'; end if;
  if sp.team_id is null then raise exception 'Join a team first.'; end if;
  if not sp.passed_check then raise exception 'Please complete the quick check first.'; end if;
  if s.status <> 'running' or s.stage is null or s.game_type = 'pd_tournament' then
    raise exception 'Decisions are closed right now.';
  end if;
  if s.stage_ends_at is not null and s.stage_ends_at < now() - interval '2 seconds' then
    raise exception 'Time is up for this round.';
  end if;
  if s.closes_at is not null and s.closes_at < now() - interval '2 seconds' then
    raise exception 'The due date has passed, so this assignment no longer accepts changes.';
  end if;
  if not (sp.team_id = any (st.required_team_ids)) then raise exception 'You have nothing to decide in this stage.'; end if;
  if jsonb_typeof(p_payload) <> 'object' then raise exception 'Invalid decision.'; end if;
  if s.game_type = 'costs' and length(p_payload::text) > 20000 then raise exception 'That worksheet is too large to save.'; end if;

  select * into existing from public.decisions
   where session_id = p_session and round_no = s.round_no and stage = s.stage and team_id = sp.team_id;
  cap := private.captain_of(sp.team_id, s.round_no);
  backup := s.stage_ends_at is not null and s.stage_ends_at - now() < interval '30 seconds' and existing.team_id is null;
  -- In the costs game the whole team shares one worksheet, so anyone on the team can save it.
  if s.game_type <> 'costs' and cap is distinct from auth.uid() and not backup then
    raise exception 'Only this round''s captain can submit (others can step in during the last 30 seconds).';
  end if;

  insert into public.decisions(session_id, round_no, stage, team_id, payload, submitted_by)
  values (p_session, s.round_no, s.stage, sp.team_id, p_payload, auth.uid())
  on conflict (session_id, round_no, stage, team_id)
  do update set payload = excluded.payload, submitted_by = excluded.submitted_by, submitted_at = now();

  perform private.bump(p_session);
  perform private.maybe_advance(p_session);
  return jsonb_build_object('ok', true, 'round_no', s.round_no, 'stage', s.stage);
end $$;

create or replace function public.costs_submit(p_session uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s public.sessions;
  st private.session_state;
  sp public.session_players;
  prev int;
begin
  perform private.me();
  select * into s from public.sessions where id = p_session for no key update;
  if s.id is null or not private.self_paced(s) then raise exception 'This game is not self-paced.'; end if;
  if s.status <> 'running' then raise exception 'This assignment is closed.'; end if;
  if s.closes_at is not null and s.closes_at < now() - interval '2 seconds' then raise exception 'The due date has passed.'; end if;
  select * into st from private.session_state where session_id = p_session;
  select * into sp from public.session_players where session_id = p_session and user_id = auth.uid();
  if sp.team_id is null then raise exception 'Join the game first.'; end if;
  if not sp.passed_check then raise exception 'Please complete the quick check first.'; end if;
  if jsonb_typeof(p_payload) <> 'object' or length(p_payload::text) > 20000 then raise exception 'Invalid worksheet.'; end if;
  if not (sp.team_id = any (st.required_team_ids)) then
    update private.session_state set team_ids = array_append(team_ids, sp.team_id), required_team_ids = array_append(required_team_ids, sp.team_id)
     where session_id = p_session and not (sp.team_id = any (team_ids));
  end if;
  select (payload->>'attempt')::int into prev from public.decisions
   where session_id = p_session and round_no = s.round_no and stage = 'submitted' and team_id = sp.team_id;
  if prev is not null and coalesce(s.config->>'attempts', 'unlimited') = 'one' then
    raise exception 'You have already submitted this assignment.';
  end if;
  insert into public.decisions(session_id, round_no, stage, team_id, payload, submitted_by)
  values (p_session, s.round_no, s.stage, sp.team_id, p_payload, auth.uid())
  on conflict (session_id, round_no, stage, team_id)
  do update set payload = excluded.payload, submitted_by = excluded.submitted_by, submitted_at = now();
  insert into public.decisions(session_id, round_no, stage, team_id, payload, submitted_by)
  values (p_session, s.round_no, 'submitted', sp.team_id,
          p_payload || jsonb_build_object('attempt', coalesce(prev, 0) + 1, 'submitted_at', now()), auth.uid())
  on conflict (session_id, round_no, stage, team_id)
  do update set payload = excluded.payload, submitted_by = excluded.submitted_by, submitted_at = now();
  perform private.bump(p_session);
  perform private.call_engine(p_session, 'score');
  return jsonb_build_object('ok', true, 'attempt', coalesce(prev, 0) + 1);
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.instructor_set_due(uuid, timestamptz)', 'public.game_class_hint(uuid)'] loop
    execute format('revoke execute on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke execute on function %s from anon', f); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('grant execute on function %s to authenticated', f); end if;
  end loop;
end $$;
