-- What students see for the open round (e.g. this round's market price in perfect competition), for the instructor screen.
create or replace function public.instructor_round_info(p_session uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s public.sessions;
begin
  s := private.require_owner(p_session);
  return (select a.info from public.assignments a where a.session_id = s.id and a.round_no = s.round_no limit 1);
end $$;

revoke execute on function public.instructor_round_info(uuid) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke execute on function public.instructor_round_info(uuid) from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then grant execute on function public.instructor_round_info(uuid) to authenticated; end if;
end $$;
