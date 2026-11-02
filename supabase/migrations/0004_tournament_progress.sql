-- How many teams have entered a strategy (shown to students while they wait for the tournament).
create or replace function public.tournament_progress(p_session uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.me();
  if not public.can_see_session(p_session) then raise exception 'Game not found.'; end if;
  return jsonb_build_object(
    'teams', (select count(*) from public.teams t where t.session_id = p_session
              and exists (select 1 from public.session_players sp where sp.team_id = t.id)),
    'entered', (select count(*) from public.strategies x where x.session_id = p_session and x.submitted));
end $$;

revoke execute on function public.tournament_progress(uuid) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke execute on function public.tournament_progress(uuid) from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then grant execute on function public.tournament_progress(uuid) to authenticated; end if;
end $$;
