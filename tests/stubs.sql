-- Minimal stand-ins for Supabase's auth schema and roles, for local testing only.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end $$;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}', last_sign_in_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

-- Stand-in for Supabase Realtime broadcast: realtime.send stores the message so tests can count them,
-- and realtime.topic() reads the channel name the way Realtime sets it when checking who may listen.
create schema if not exists realtime;
create table if not exists realtime.messages (id bigserial primary key, topic text not null, extension text not null default 'broadcast',
  event text, payload jsonb, private boolean default true, inserted_at timestamptz default now());
alter table realtime.messages enable row level security;
create or replace function realtime.topic() returns text language sql stable as $$ select nullif(current_setting('realtime.topic', true), '') $$;
create or replace function realtime.send(payload jsonb, event text, topic text, private boolean default true) returns void
language sql security definer as $$ insert into realtime.messages(topic, event, payload, private) values (topic, event, payload, private) $$;
grant usage on schema realtime to authenticated, anon;
grant select, insert on realtime.messages to authenticated;
grant usage on sequence realtime.messages_id_seq to authenticated;
