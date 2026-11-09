-- Fix: students submitting at the same moment got "deadlock detected".
-- submit_decision took a shared lock on the session row and later updated that same row (to notify screens),
-- so two concurrent submissions could each wait for the other forever. It now takes an exclusive row lock first.

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
