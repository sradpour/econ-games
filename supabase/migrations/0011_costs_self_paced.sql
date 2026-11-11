-- Costs game: self-paced assignment / practice mode.
-- The game opens as soon as it is created; students join any time, work individually and submit to be scored
-- (one attempt, or unlimited with the best score counting). The instructor closes it.

create or replace function private.self_paced(p_session public.sessions) returns boolean
language sql immutable as $$
  select p_session.game_type = 'costs' and coalesce(p_session.config->>'pace', '') = 'self'
$$;

create or replace function public.create_session(p_class uuid, p_game_type text, p_title text, p_config jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v public.profiles; s public.sessions;
begin
  v := private.require_instructor();
  if not exists (select 1 from public.classes where id = p_class and (instructor_id = v.id or v.is_admin)) then
    raise exception 'Not your class.';
  end if;
  if p_game_type = 'costs' and coalesce(p_config->>'pace', '') = 'self' then
    p_config := p_config || jsonb_build_object('team_mode', 'individual', 'round_seconds', 0);
  end if;
  insert into public.sessions(class_id, instructor_id, game_type, title, config)
  values (p_class, (select instructor_id from public.classes where id = p_class), p_game_type,
          coalesce(nullif(trim(p_title), ''), p_game_type), coalesce(p_config, '{}'))
  returning * into s;
  insert into private.session_state(session_id) values (s.id);
  -- Self-paced (assignment / practice) games open right away: no Start button, students join any time.
  if private.self_paced(s) then perform private.call_engine(s.id, 'start'); end if;
  return jsonb_build_object('id', s.id);
end $$;

create or replace function public.join_session(p_session uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v public.profiles;
  s public.sessions;
  t uuid;
begin
  v := private.me();
  select * into s from public.sessions where id = p_session;
  if s.id is null or not public.can_see_session(p_session) then raise exception 'Game not found.'; end if;
  if exists (select 1 from public.session_players where session_id = p_session and user_id = v.id) then
    return jsonb_build_object('ok', true);
  end if;
  if v.full_name is null then raise exception 'Please finish your profile first.'; end if;
  if s.status = 'finished' then raise exception 'This game has finished.'; end if;
  if s.status <> 'lobby' and private.team_mode(s) = 'individual' and not private.self_paced(s) then
    raise exception 'This game has already started. Ask your instructor to let you into the next one.';
  end if;
  insert into public.session_players(session_id, user_id) values (p_session, v.id);
  if private.team_mode(s) = 'individual' then
    insert into public.teams(session_id, name, created_by, is_solo)
    values (p_session, private.unique_team_name(p_session, v.full_name), v.id, true)
    returning id into t;
    update public.session_players set team_id = t, team_joined_at = now() where session_id = p_session and user_id = v.id;
    -- Joining a self-paced game that is already open: add the player to the open round.
    if private.self_paced(s) and s.status in ('running', 'paused') then
      update private.session_state set team_ids = array_append(team_ids, t), required_team_ids = array_append(required_team_ids, t)
       where session_id = p_session;
    end if;
  end if;
  perform private.bump(p_session);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.engine_load(p_session uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  s public.sessions;
  st private.session_state;
begin
  select * into s from public.sessions where id = p_session;
  select * into st from private.session_state where session_id = p_session;
  return jsonb_build_object(
    'session', to_jsonb(s), 'state', st.state, 'required', to_jsonb(st.required_team_ids),
    'teams', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', coalesce(t.name, 'Removed team')) order by x.ord)
                       from unnest(st.team_ids) with ordinality as x(id, ord) left join public.teams t on t.id = x.id), '[]'),
    'decisions', coalesce((select jsonb_object_agg(d.team_id::text, d.payload) from public.decisions d
                           where d.session_id = s.id and d.round_no = s.round_no and d.stage = s.stage), '{}'),
    -- Self-paced costs game: submitted attempts and their scores so far
    'submitted', case when private.self_paced(s) then coalesce((select jsonb_object_agg(d.team_id::text, d.payload) from public.decisions d
                           where d.session_id = s.id and d.round_no = s.round_no and d.stage = 'submitted'), '{}') end,
    'scored', case when private.self_paced(s) then coalesce((select jsonb_object_agg(r.team_id::text, r.payload) from public.results r
                           where r.session_id = s.id and r.round_no = s.round_no), '{}') end
  );
end $$;

-- Submit the worksheet to be scored (self-paced costs game only). Saves it, records the attempt, and asks the engine to score it.
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

revoke execute on function private.self_paced(public.sessions) from public;
revoke execute on function public.costs_submit(uuid, jsonb) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke execute on function public.costs_submit(uuid, jsonb) from anon'; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'grant execute on function public.costs_submit(uuid, jsonb) to authenticated'; end if;
end $$;
