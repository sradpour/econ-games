-- Scheduler and outbound HTTP for the game engine. Replace <project-ref> when deploying to a new project.
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

insert into private.app_config(key, value)
values ('engine_url', 'https://sbhalwcucckiposfrdjv.supabase.co/functions/v1/engine')
on conflict (key) do update set value = excluded.value;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'econ-games-tick') then
    perform cron.unschedule('econ-games-tick');
  end if;
  perform cron.schedule('econ-games-tick', '5 seconds', 'select public.tick()');
end $$;

alter function private.email_domain(text) set search_path = '';
alter function private.cfg_text(jsonb, text, text) set search_path = '';
alter function private.team_mode(public.sessions) set search_path = '';
alter function private.team_cap(public.sessions) set search_path = '';
