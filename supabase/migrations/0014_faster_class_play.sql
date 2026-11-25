-- Faster class play.
-- Before: every save bumped the game's version, which told every student's screen to reload the whole game
-- (30 students -> ~30 reloads per save), via Postgres change streaming that re-checks permissions per student per change.
-- Now:
--  * Screens listen on a private broadcast channel "session:<id>"; only people who can see the game may listen
--    (checked once when they join the channel), and only the database can send.
--  * "changed" (round starts/ends, settings, teams…) reloads everyone; "saved" carries only counts and the team
--    that saved, so just that team (and the instructor) reload.
--  * Saves take a shared lock so they run side by side.
--  * The every-5-seconds timer log is trimmed daily; foreign-key indexes; profiles policy evaluated once per query.

-- Best-effort broadcast; never blocks a game action.
create or replace function private.notify(p_session uuid, p_event text, p_payload jsonb default '{}') returns void
language plpgsql security definer set search_path = '' as $$
begin
  if to_regprocedure('realtime.send(jsonb,text,text,boolean)') is null then return; end if;
  execute 'select realtime.send($1, $2, $3, true)'
    using coalesce(p_payload, '{}') || jsonb_build_object('session_id', p_session), p_event, 'session:' || p_session::text;
exception when others then
  null;
end $$;

-- A save: counts for everyone's progress line, plus which team saved (its members reload to see each other's work).
create or replace function private.notify_saved(p_session uuid, p_team uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.sessions; st private.session_state;
begin
  select * into s from public.sessions where id = p_session;
  select * into st from private.session_state where session_id = p_session;
  perform private.notify(p_session, 'saved', jsonb_build_object(
    'team_id', p_team,
    'required', coalesce(cardinality(st.required_team_ids), 0),
    'submitted', (select count(*) from public.decisions d where d.session_id = p_session and d.round_no = s.round_no
                  and d.stage = s.stage and d.team_id = any (coalesce(st.required_team_ids, '{}'))),
    'players', (select count(*) from public.session_players where session_id = p_session)));
end $$;

-- Anything students see about the game itself changed: tell everyone once.
create or replace function private.sessions_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (new.version, new.status, new.round_no, new.stage, new.stage_ends_at, new.paused_remaining_ms, new.title, new.config, new.closes_at)
     is distinct from (old.version, old.status, old.round_no, old.stage, old.stage_ends_at, old.paused_remaining_ms, old.title, old.config, old.closes_at) then
    perform private.notify(new.id, 'changed', jsonb_build_object('version', new.version, 'status', new.status, 'round_no', new.round_no, 'stage', new.stage));
  end if;
  return null;
end $$;
drop trigger if exists sessions_notify on public.sessions;
create trigger sessions_notify after update on public.sessions for each row execute function private.sessions_changed();

-- Who may listen to a game's channel: whoever can see the game. Nobody gets an insert policy, so only the database sends.
do $$
begin
  if to_regclass('realtime.messages') is not null then
    execute 'drop policy if exists "game members receive game updates" on realtime.messages';
    execute $p$create policy "game members receive game updates" on realtime.messages for select to authenticated using (
      realtime.messages.extension = 'broadcast'
      and case when (select realtime.topic()) ~ '^session:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
               then public.can_see_session(substring((select realtime.topic()) from 9)::uuid)
               else false end)$p$;
  end if;
end $$;

-- Stop streaming every change to the games table (the old method).
do $$
begin
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sessions') then
    execute 'alter publication supabase_realtime drop table public.sessions';
  end if;
end $$;

CREATE OR REPLACE FUNCTION public.submit_decision(p_session uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  s public.sessions;
  st private.session_state;
  sp public.session_players;
  cap uuid;
  existing public.decisions;
  backup boolean;
begin
  perform private.me();
  -- A shared lock: saves run side by side, and the round can't end in the middle of one.
  -- (Saves no longer update the game row, so the old deadlock between two share locks can't happen.)
  select * into s from public.sessions where id = p_session for share;
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

  -- Tell the team (who share the decision) and the instructor; other students just update their counter.
  perform private.notify_saved(p_session, sp.team_id);
  perform private.maybe_advance(p_session);
  return jsonb_build_object('ok', true, 'round_no', s.round_no, 'stage', s.stage);
end $function$;

CREATE OR REPLACE FUNCTION public.costs_submit(p_session uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  s public.sessions;
  st private.session_state;
  sp public.session_players;
  prev int;
begin
  perform private.me();
  select * into s from public.sessions where id = p_session for share;
  if s.id is null or not private.self_paced(s) then raise exception 'This game is not self-paced.'; end if;
  if s.status <> 'running' then raise exception 'This assignment is closed.'; end if;
  if s.closes_at is not null and s.closes_at < now() - interval '2 seconds' then raise exception 'The due date has passed.'; end if;
  select * into st from private.session_state where session_id = p_session;
  -- Lock this student's own row so a double-click can't count as two first attempts.
  select * into sp from public.session_players where session_id = p_session and user_id = auth.uid() for update;
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
  perform private.notify_saved(p_session, sp.team_id);
  perform private.call_engine(p_session, 'score');
  return jsonb_build_object('ok', true, 'attempt', coalesce(prev, 0) + 1);
end $function$;

CREATE OR REPLACE FUNCTION public.pass_check(p_session uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  update public.session_players set passed_check = true where session_id = p_session and user_id = auth.uid();
  perform private.notify_saved(p_session, null);
end $function$;

CREATE OR REPLACE FUNCTION public.join_session(p_session uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  perform private.notify_saved(p_session, null);
  return jsonb_build_object('ok', true);
end $function$;

CREATE OR REPLACE FUNCTION public.save_strategy(p_session uuid, p_description text, p_code text, p_explanation text, p_submit boolean, p_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  perform private.notify_saved(p_session, sp.team_id);
  return jsonb_build_object('ok', true);
end $function$;

CREATE OR REPLACE FUNCTION public.engine_apply(p_session uuid, p_patch jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  s public.sessions;
  e jsonb := p_patch->'expect';
  nx jsonb := p_patch->'session';
  x jsonb;
  secs numeric;
begin
  select * into s from public.sessions where id = p_session for update;
  if s.id is null then return false; end if;
  if e is not null and (s.status is distinct from (e->>'status') and not (e->>'status' = 'running' and s.status = 'paused')
                        or s.round_no is distinct from (e->>'round_no')::int
                        or s.stage is distinct from (e->>'stage')) then
    update private.session_state set advancing_until = null where session_id = p_session;
    return false;
  end if;

  if p_patch ? 'team_ids' then
    update private.session_state set team_ids = (select coalesce(array_agg(v::uuid), '{}') from jsonb_array_elements_text(p_patch->'team_ids') v)
     where session_id = p_session;
  end if;
  if p_patch ? 'config' then
    update public.sessions set config = p_patch->'config' where id = p_session;
  end if;

  for x in select * from jsonb_array_elements(coalesce(p_patch->'results', '[]')) loop
    insert into public.results(session_id, round_no, team_id, payload, earnings)
    values (p_session, (x->>'round_no')::int, (x->>'team_id')::uuid, x->'payload', coalesce((x->>'earnings')::numeric, 0))
    on conflict (session_id, round_no, team_id) do update set payload = excluded.payload, earnings = excluded.earnings;
  end loop;
  for x in select * from jsonb_array_elements(coalesce(p_patch->'round_public', '[]')) loop
    insert into public.round_public(session_id, round_no, payload) values (p_session, (x->>'round_no')::int, x->'payload')
    on conflict (session_id, round_no) do update set payload = excluded.payload;
  end loop;
  for x in select * from jsonb_array_elements(coalesce(p_patch->'assignments', '[]')) loop
    insert into public.assignments(session_id, round_no, team_id, info)
    values (p_session, (x->>'round_no')::int, (x->>'team_id')::uuid, x->'info')
    on conflict (session_id, round_no, team_id) do update set info = excluded.info;
  end loop;
  for x in select * from jsonb_array_elements(coalesce(p_patch->'outputs', '[]')) loop
    insert into public.session_outputs(session_id, kind, visibility, payload)
    values (p_session, x->>'kind', coalesce(x->>'visibility', 'students'), x->'payload')
    on conflict (session_id, kind) do update set payload = excluded.payload, visibility = excluded.visibility, created_at = now();
  end loop;

  update private.session_state set
    state = coalesce(p_patch->'state', state),
    required_team_ids = case when p_patch ? 'required'
      then (select coalesce(array_agg(v::uuid), '{}') from jsonb_array_elements_text(p_patch->'required') v)
      else required_team_ids end,
    advancing_until = null, last_error = null
  where session_id = p_session;

  if nx is not null then
    secs := nullif(nx->>'seconds', '')::numeric;
    update public.sessions set
      status = coalesce(nx->>'status', status),
      round_no = coalesce((nx->>'round_no')::int, round_no),
      stage = case when nx ? 'stage' then nx->>'stage' else stage end,
      stage_started_at = now(),
      stage_ends_at = case when coalesce(nx->>'status', status) = 'finished' then null
                           when secs is not null and secs > 0 then now() + make_interval(secs => secs) else null end,
      paused_remaining_ms = null,
      started_at = coalesce(started_at, case when nx->>'status' = 'running' then now() end),
      finished_at = case when nx->>'status' = 'finished' then now() else finished_at end
    where id = p_session;
  end if;
  -- Scoring a self-paced submission changes nothing for the rest of the class: tell only the teams scored.
  if (select count(*) from jsonb_object_keys(p_patch) k where k not in ('expect', 'results')) = 0 then
    for x in select * from jsonb_array_elements(coalesce(p_patch->'results', '[]')) loop
      perform private.notify_saved(p_session, (x->>'team_id')::uuid);
    end loop;
  else
    update public.sessions set version = version + 1 where id = p_session;
  end if;
  return true;
end $function$;

-- The game clock runs every 5 seconds and logs each run; keep one day of that log.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    delete from cron.job_run_details where end_time < now() - interval '1 day';
    if exists (select 1 from cron.job where jobname = 'econ-games-cleanup') then perform cron.unschedule('econ-games-cleanup'); end if;
    perform cron.schedule('econ-games-cleanup', '23 9 * * *', $c$delete from cron.job_run_details where end_time < now() - interval '1 day'$c$);
  end if;
end $$;

-- Indexes for lookups by team, user and instructor
create index if not exists decisions_team_idx on public.decisions(team_id);
create index if not exists decisions_submitted_by_idx on public.decisions(submitted_by);
create index if not exists results_team_idx on public.results(team_id);
create index if not exists assignments_team_idx on public.assignments(team_id);
create index if not exists session_players_user_idx on public.session_players(user_id);
create index if not exists class_members_user_idx on public.class_members(user_id);
create index if not exists classes_instructor_idx on public.classes(instructor_id);
create index if not exists sessions_instructor_idx on public.sessions(instructor_id);
create index if not exists teams_created_by_idx on public.teams(created_by);
create index if not exists chat_messages_team_idx on public.chat_messages(team_id);
create index if not exists chat_messages_user_idx on public.chat_messages(user_id);
create index if not exists strategies_team_idx on public.strategies(team_id);
create index if not exists strategies_submitted_by_idx on public.strategies(submitted_by);
create index if not exists strategies_updated_by_idx on public.strategies(updated_by);

-- Evaluate auth.uid() once per query instead of once per row
drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles for select to authenticated using (id = (select auth.uid()));

revoke execute on function private.notify(uuid, text, jsonb) from public;
revoke execute on function private.notify_saved(uuid, uuid) from public;
revoke execute on function private.sessions_changed() from public;
