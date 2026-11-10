-- The strategy-tournament demo uses the real AI translator. It needs a signed-in account (any role)
-- and is limited per person per day, so the public demo cannot use up the instructor's Gemini quota.

create table if not exists private.demo_translations (
  user_id uuid not null references public.profiles(id) on delete cascade,
  day date not null default current_date,
  used int not null default 0,
  primary key (user_id, day)
);

create or replace function public.consume_demo_translation() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  n int;
begin
  perform private.me();
  insert into private.demo_translations as d (user_id, day, used) values (auth.uid(), current_date, 1)
  on conflict (user_id, day) do update set used = d.used + 1
  returning d.used into n;
  if n > 15 then raise exception 'You have used today''s 15 demo translations. Try again tomorrow, or play in a class game.'; end if;
  return jsonb_build_object('ok', true, 'used', n, 'limit', 15);
end $$;

revoke execute on function public.consume_demo_translation() from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke execute on function public.consume_demo_translation() from anon'; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'grant execute on function public.consume_demo_translation() to authenticated'; end if;
end $$;
