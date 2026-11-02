-- Classroom Economics Games: schema, security and server functions
-- All student and instructor access goes through SECURITY DEFINER functions below;
-- tables have row-level security with no write policies, so nothing can be changed directly.

create schema if not exists private;
revoke all on schema private from public;

-- ---------------------------------------------------------------------------
-- Configuration (not reachable through the API)

create table if not exists private.app_config (
  key text primary key,
  value text not null
);

insert into private.app_config(key, value) values
  ('admin_emails', 'siavash.radpour@stockton.edu'),
  ('instructor_auto_domains', 'stockton.edu'),
  ('default_student_domains', 'go.stockton.edu'),
  ('engine_secret', md5(random()::text || clock_timestamp()::text) || md5(random()::text))
on conflict (key) do nothing;

create or replace function private.cfg(p_key text) returns text
language sql stable security definer set search_path = '' as $$
  select value from private.app_config where key = p_key
$$;

-- ---------------------------------------------------------------------------
-- Tables

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  student_id text,
  profile_completed boolean not null default false,
  is_admin boolean not null default false,
  instructor_status text not null default 'none'
    check (instructor_status in ('none', 'pending', 'approved', 'rejected')),
  created_at timestamptz not null default now()
);

create table if not exists public.classes (
  id uuid primary key default gen_random_uuid(),
  instructor_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  join_code text not null unique,
  allowed_domains text[] not null default '{}',
  archived boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.class_members (
  class_id uuid not null references public.classes(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (class_id, user_id)
);

create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  instructor_id uuid not null references public.profiles(id) on delete cascade,
  game_type text not null check (game_type in
    ('competitive','monopolistic','oligopoly','monopoly','pd_live','pd_tournament','public_goods','ultimatum')),
  title text not null,
  config jsonb not null default '{}',
  status text not null default 'lobby' check (status in ('lobby','running','paused','finished')),
  round_no int not null default 0,
  stage text,
  stage_started_at timestamptz,
  stage_ends_at timestamptz,
  paused_remaining_ms int,
  version bigint not null default 0,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index if not exists sessions_class_idx on public.sessions(class_id);

create table if not exists private.session_state (
  session_id uuid primary key references public.sessions(id) on delete cascade,
  state jsonb not null default '{}',
  team_ids uuid[] not null default '{}',          -- teams fixed at start
  required_team_ids uuid[] not null default '{}', -- who must decide in the open stage
  advancing_until timestamptz,
  last_error text,
  last_error_at timestamptz
);

-- Only used when engine_url = 'local-queue' (local testing without HTTP)
create table if not exists private.engine_queue (
  id bigserial primary key,
  session_id uuid not null,
  action text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  name text not null,
  created_by uuid references public.profiles(id) on delete set null,
  is_solo boolean not null default false,
  created_at timestamptz not null default now(),
  unique (session_id, name)
);

create table if not exists public.session_players (
  session_id uuid not null references public.sessions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  team_id uuid references public.teams(id) on delete set null,
  team_joined_at timestamptz,
  joined_at timestamptz not null default now(),
  passed_check boolean not null default false,
  primary key (session_id, user_id)
);
create index if not exists session_players_team_idx on public.session_players(team_id);

create table if not exists public.decisions (
  session_id uuid not null references public.sessions(id) on delete cascade,
  round_no int not null,
  stage text not null,
  team_id uuid not null references public.teams(id) on delete cascade,
  payload jsonb not null,
  submitted_by uuid references public.profiles(id) on delete set null,
  submitted_at timestamptz not null default now(),
  primary key (session_id, round_no, stage, team_id)
);

create table if not exists public.assignments (
  session_id uuid not null references public.sessions(id) on delete cascade,
  round_no int not null,
  team_id uuid not null references public.teams(id) on delete cascade,
  info jsonb not null default '{}',
  primary key (session_id, round_no, team_id)
);

create table if not exists public.results (
  session_id uuid not null references public.sessions(id) on delete cascade,
  round_no int not null,
  team_id uuid not null references public.teams(id) on delete cascade,
  payload jsonb not null,
  earnings numeric not null default 0,
  primary key (session_id, round_no, team_id)
);

create table if not exists public.round_public (
  session_id uuid not null references public.sessions(id) on delete cascade,
  round_no int not null,
  payload jsonb not null,
  primary key (session_id, round_no)
);

create table if not exists public.session_outputs (
  session_id uuid not null references public.sessions(id) on delete cascade,
  kind text not null,
  visibility text not null default 'students' check (visibility in ('students','instructor')),
  payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key (session_id, kind)
);

create table if not exists public.strategies (
  session_id uuid not null references public.sessions(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  description text not null default '',
  code text not null default '',
  explanation text not null default '',
  submitted boolean not null default false,
  submitted_at timestamptz,
  submitted_description text,
  submitted_code text,
  submitted_explanation text,
  submitted_by uuid references public.profiles(id) on delete set null,
  translations_used int not null default 0,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (session_id, team_id)
);

-- ---------------------------------------------------------------------------
-- Row level security: read-only access where the browser needs it (realtime), nothing else.

alter table public.profiles enable row level security;
alter table public.classes enable row level security;
alter table public.class_members enable row level security;
alter table public.sessions enable row level security;
alter table public.teams enable row level security;
alter table public.session_players enable row level security;
alter table public.decisions enable row level security;
alter table public.assignments enable row level security;
alter table public.results enable row level security;
alter table public.round_public enable row level security;
alter table public.session_outputs enable row level security;
alter table public.strategies enable row level security;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false)
$$;

create or replace function public.owns_session(p_session uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.sessions s where s.id = p_session and s.instructor_id = auth.uid())
      or public.is_admin()
$$;

create or replace function public.can_see_session(p_session uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.owns_session(p_session)
      or exists (select 1 from public.sessions s join public.class_members m on m.class_id = s.class_id
                 where s.id = p_session and m.user_id = auth.uid())
$$;

drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles for select to authenticated using (id = auth.uid());

drop policy if exists "see sessions" on public.sessions;
create policy "see sessions" on public.sessions for select to authenticated using (public.can_see_session(id));

-- Live updates: browsers subscribe to their session row and refetch when "version" changes.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.sessions;
    exception when duplicate_object then null;
    end;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- New users get a profile automatically

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_admin boolean;
begin
  v_admin := lower(new.email) = any (string_to_array(lower(coalesce(private.cfg('admin_emails'), '')), ','));
  insert into public.profiles (id, email, full_name, is_admin, instructor_status)
  values (
    new.id, lower(new.email),
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    v_admin, case when v_admin then 'approved' else 'none' end
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Small helpers

create or replace function private.email_domain(p_email text) returns text
language sql immutable as $$ select lower(split_part(p_email, '@', 2)) $$;

create or replace function private.me() returns public.profiles
language plpgsql stable security definer set search_path = '' as $$
declare v public.profiles;
begin
  select * into v from public.profiles where id = auth.uid();
  if v.id is null then raise exception 'Please sign in first.'; end if;
  return v;
end $$;

create or replace function private.require_instructor() returns public.profiles
language plpgsql stable security definer set search_path = '' as $$
declare v public.profiles;
begin
  v := private.me();
  if not (v.is_admin or v.instructor_status = 'approved') then
    raise exception 'Instructor access required.';
  end if;
  return v;
end $$;

create or replace function private.require_owner(p_session uuid) returns public.sessions
language plpgsql stable security definer set search_path = '' as $$
declare v public.sessions;
begin
  select * into v from public.sessions where id = p_session;
  if v.id is null then raise exception 'Game not found.'; end if;
  if not (v.instructor_id = auth.uid() or public.is_admin()) then raise exception 'Not your game.'; end if;
  return v;
end $$;

create or replace function private.bump(p_session uuid) returns void
language sql security definer set search_path = '' as $$
  update public.sessions set version = version + 1 where id = p_session
$$;

create or replace function private.new_join_code() returns text
language plpgsql volatile set search_path = '' as $$
declare
  chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code text;
begin
  loop
    code := '';
    for i in 1..6 loop
      code := code || substr(chars, 1 + floor(random() * length(chars))::int, 1);
    end loop;
    exit when not exists (select 1 from public.classes where join_code = code);
  end loop;
  return code;
end $$;

create or replace function private.cfg_text(p_cfg jsonb, p_key text, p_default text) returns text
language sql immutable as $$ select coalesce(nullif(p_cfg->>p_key, ''), p_default) $$;

create or replace function private.team_mode(p_session public.sessions) returns text
language sql immutable as $$
  select case
    when coalesce(p_session.config->>'team_mode', '') = 'teams' then 'teams'
    when coalesce(p_session.config->>'team_mode', '') = 'individual' then 'individual'
    when p_session.game_type in ('oligopoly', 'pd_tournament') then 'teams'
    else 'individual' end
$$;

create or replace function private.team_cap(p_session public.sessions) returns int
language sql immutable as $$ select greatest(1, coalesce(nullif(p_session.config->>'team_size', '')::int, 4)) $$;

-- Ordered members of a team (captain rotation follows this order)
create or replace function private.team_members(p_team uuid) returns table(user_id uuid, full_name text, ord int)
language sql stable security definer set search_path = '' as $$
  select sp.user_id, coalesce(p.full_name, p.email), (row_number() over (order by sp.team_joined_at, sp.user_id))::int - 1
  from public.session_players sp join public.profiles p on p.id = sp.user_id
  where sp.team_id = p_team
  order by sp.team_joined_at, sp.user_id
$$;

create or replace function private.captain_of(p_team uuid, p_round int) returns uuid
language sql stable security definer set search_path = '' as $$
  with m as (select * from private.team_members(p_team)),
       n as (select count(*)::int as c from m)
  select m.user_id from m, n where n.c > 0 and m.ord = (greatest(p_round, 1) - 1) % n.c
$$;

-- ---------------------------------------------------------------------------
-- Calling the game engine (edge function) from the database

create or replace function private.call_engine(p_session uuid, p_action text default 'advance', p_extra jsonb default '{}')
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_url text := private.cfg('engine_url');
begin
  if v_url is null then
    update private.session_state set last_error = 'Engine URL not configured', last_error_at = now() where session_id = p_session;
    return;
  end if;
  if v_url = 'local-queue' then
    insert into private.engine_queue(session_id, action) values (p_session, p_action);
    return;
  end if;
  begin
    execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 20000)'
      using v_url,
            jsonb_build_object('action', p_action, 'session_id', p_session) || coalesce(p_extra, '{}'),
            jsonb_build_object('Content-Type', 'application/json', 'x-engine-secret', private.cfg('engine_secret'));
  exception when others then
    update private.session_state set last_error = 'Could not reach engine: ' || sqlerrm, last_error_at = now() where session_id = p_session;
  end;
end $$;

-- Should the open stage end now? (timer expired, or everyone required has decided)
create or replace function private.stage_due(p_session uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select s.status = 'running' and s.stage is not null and s.game_type <> 'pd_tournament'
     and (st.advancing_until is null or st.advancing_until < now())
     and (
       (s.stage_ends_at is not null and s.stage_ends_at <= now())
       or (coalesce((s.config->>'auto_advance')::boolean, true)
           and cardinality(st.required_team_ids) > 0
           and (select count(*) from public.decisions d
                where d.session_id = s.id and d.round_no = s.round_no and d.stage = s.stage
                  and d.team_id = any (st.required_team_ids)) >= cardinality(st.required_team_ids))
     )
  from public.sessions s join private.session_state st on st.session_id = s.id
  where s.id = p_session
$$;

create or replace function private.maybe_advance(p_session uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(private.stage_due(p_session), false) then
    update private.session_state set advancing_until = now() + interval '20 seconds' where session_id = p_session;
    perform private.call_engine(p_session, 'advance');
    return true;
  end if;
  return false;
end $$;

-- Run every few seconds by pg_cron
create or replace function public.tick() returns int
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  n int := 0;
begin
  for r in select s.id from public.sessions s where s.status = 'running' and s.stage is not null loop
    if private.maybe_advance(r.id) then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- Keep-alive endpoint (stops the free project from pausing when idle)
create or replace function public.ping() returns text
language sql stable security definer set search_path = '' as $$ select 'ok ' || (select count(*) from public.sessions)::text $$;

-- ---------------------------------------------------------------------------
-- Profile & classes (everyone)

create or replace function public.get_me() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v public.profiles;
begin
  select * into v from public.profiles where id = auth.uid();
  if v.id is null then return null; end if;
  return jsonb_build_object(
    'id', v.id, 'email', v.email, 'full_name', v.full_name, 'student_id', v.student_id,
    'profile_completed', v.profile_completed,
    'is_admin', v.is_admin, 'instructor_status', v.instructor_status,
    'is_instructor', v.is_admin or v.instructor_status = 'approved',
    'default_student_domains', private.cfg('default_student_domains'),
    'classes', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'instructor', coalesce(ip.full_name, ip.email))
                       order by m.joined_at desc)
      from public.class_members m join public.classes c on c.id = m.class_id
      join public.profiles ip on ip.id = c.instructor_id
      where m.user_id = v.id and not c.archived), '[]')
  );
end $$;

create or replace function public.complete_profile(p_full_name text, p_student_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.me();
  if length(trim(coalesce(p_full_name, ''))) < 2 then raise exception 'Please enter your full name.'; end if;
  update public.profiles
     set full_name = trim(p_full_name), student_id = nullif(trim(coalesce(p_student_id, '')), ''), profile_completed = true
   where id = auth.uid();
  return public.get_me();
end $$;

create or replace function public.request_instructor() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v public.profiles;
begin
  v := private.me();
  if v.is_admin or v.instructor_status = 'approved' then return public.get_me(); end if;
  update public.profiles
     set instructor_status = case
       when private.email_domain(v.email) = any (string_to_array(lower(coalesce(private.cfg('instructor_auto_domains'), '')), ','))
       then 'approved' else 'pending' end
   where id = v.id;
  return public.get_me();
end $$;

create or replace function public.join_class(p_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v public.profiles;
  c public.classes;
begin
  v := private.me();
  select * into c from public.classes where join_code = upper(trim(p_code)) and not archived;
  if c.id is null then raise exception 'No class with that code.'; end if;
  if cardinality(c.allowed_domains) > 0
     and not private.email_domain(v.email) = any (c.allowed_domains)
     and c.instructor_id <> v.id and not v.is_admin then
    raise exception 'This class only accepts % accounts. You are signed in as %.',
      array_to_string(c.allowed_domains, ' or '), v.email;
  end if;
  insert into public.class_members(class_id, user_id) values (c.id, v.id) on conflict do nothing;
  return jsonb_build_object('class_id', c.id, 'name', c.name);
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
      'joined', exists (select 1 from public.session_players sp where sp.session_id = s.id and sp.user_id = auth.uid()))
      order by s.created_at desc)
    from public.sessions s where s.class_id = p_class), '[]');
end $$;

-- ---------------------------------------------------------------------------
-- Joining a game and teams (students)

create or replace function private.unique_team_name(p_session uuid, p_name text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  base text := left(trim(p_name), 40);
  candidate text := base;
  i int := 2;
begin
  while exists (select 1 from public.teams where session_id = p_session and lower(name) = lower(candidate)) loop
    candidate := base || ' ' || i; i := i + 1;
  end loop;
  return candidate;
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
  if s.status <> 'lobby' and private.team_mode(s) = 'individual' then
    raise exception 'This game has already started. Ask your instructor to let you into the next one.';
  end if;
  insert into public.session_players(session_id, user_id) values (p_session, v.id);
  if private.team_mode(s) = 'individual' then
    insert into public.teams(session_id, name, created_by, is_solo)
    values (p_session, private.unique_team_name(p_session, v.full_name), v.id, true)
    returning id into t;
    update public.session_players set team_id = t, team_joined_at = now() where session_id = p_session and user_id = v.id;
  end if;
  perform private.bump(p_session);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.pass_check(p_session uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.session_players set passed_check = true where session_id = p_session and user_id = auth.uid();
  perform private.bump(p_session);
end $$;

create or replace function private.lobby_player(p_session uuid) returns public.sessions
language plpgsql security definer set search_path = '' as $$
declare s public.sessions;
begin
  select * into s from public.sessions where id = p_session;
  if not exists (select 1 from public.session_players where session_id = p_session and user_id = auth.uid()) then
    raise exception 'Join the game first.';
  end if;
  if private.team_mode(s) <> 'teams' then raise exception 'This game is played individually.'; end if;
  return s;
end $$;

create or replace function public.create_team(p_session uuid, p_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s public.sessions;
  t uuid;
  old uuid;
begin
  s := private.lobby_player(p_session);
  if s.status <> 'lobby' then raise exception 'Teams are locked once the game starts.'; end if;
  if length(trim(coalesce(p_name, ''))) < 1 then raise exception 'Give your team a name.'; end if;
  if exists (select 1 from public.teams where session_id = p_session and lower(name) = lower(trim(p_name))) then
    raise exception 'That team name is taken.';
  end if;
  select team_id into old from public.session_players where session_id = p_session and user_id = auth.uid();
  insert into public.teams(session_id, name, created_by) values (p_session, left(trim(p_name), 40), auth.uid()) returning id into t;
  update public.session_players set team_id = t, team_joined_at = now() where session_id = p_session and user_id = auth.uid();
  delete from public.teams x where x.id = old and not exists (select 1 from public.session_players where team_id = old);
  perform private.bump(p_session);
  return jsonb_build_object('team_id', t);
end $$;

create or replace function public.join_team(p_team uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.sessions;
  tm public.teams;
  old uuid;
begin
  select * into tm from public.teams where id = p_team;
  if tm.id is null then raise exception 'Team not found.'; end if;
  s := private.lobby_player(tm.session_id);
  if s.status = 'finished' then raise exception 'This game has finished.'; end if;
  select team_id into old from public.session_players where session_id = s.id and user_id = auth.uid();
  if old = p_team then return; end if;
  if s.status <> 'lobby' and old is not null then raise exception 'Teams are locked once the game starts.'; end if;
  if (select count(*) from public.session_players where team_id = p_team) >= private.team_cap(s) then
    raise exception 'That team is full.';
  end if;
  update public.session_players set team_id = p_team, team_joined_at = now() where session_id = s.id and user_id = auth.uid();
  if s.status = 'lobby' then
    delete from public.teams x where x.id = old and not exists (select 1 from public.session_players where team_id = old);
  end if;
  perform private.bump(s.id);
end $$;

create or replace function public.leave_team(p_session uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.sessions;
  old uuid;
begin
  s := private.lobby_player(p_session);
  if s.status <> 'lobby' then raise exception 'Teams are locked once the game starts.'; end if;
  select team_id into old from public.session_players where session_id = p_session and user_id = auth.uid();
  update public.session_players set team_id = null, team_joined_at = null where session_id = p_session and user_id = auth.uid();
  delete from public.teams x where x.id = old and not exists (select 1 from public.session_players where team_id = old);
  perform private.bump(p_session);
end $$;

create or replace function public.rename_team(p_team uuid, p_name text) returns void
language plpgsql security definer set search_path = '' as $$
declare tm public.teams; s public.sessions;
begin
  select * into tm from public.teams where id = p_team;
  if tm.id is null then raise exception 'Team not found.'; end if;
  s := private.lobby_player(tm.session_id);
  if s.status <> 'lobby' then raise exception 'Teams are locked once the game starts.'; end if;
  if not exists (select 1 from public.session_players where team_id = p_team and user_id = auth.uid()) then
    raise exception 'Only team members can rename the team.';
  end if;
  if length(trim(coalesce(p_name, ''))) < 1 then raise exception 'Give your team a name.'; end if;
  if exists (select 1 from public.teams where session_id = tm.session_id and lower(name) = lower(trim(p_name)) and id <> p_team) then
    raise exception 'That team name is taken.';
  end if;
  update public.teams set name = left(trim(p_name), 40) where id = p_team;
  perform private.bump(tm.session_id);
end $$;

-- ---------------------------------------------------------------------------
-- Decisions

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
  if not (sp.team_id = any (st.required_team_ids)) then raise exception 'You have nothing to decide in this stage.'; end if;
  if jsonb_typeof(p_payload) <> 'object' then raise exception 'Invalid decision.'; end if;

  select * into existing from public.decisions
   where session_id = p_session and round_no = s.round_no and stage = s.stage and team_id = sp.team_id;
  cap := private.captain_of(sp.team_id, s.round_no);
  backup := s.stage_ends_at is not null and s.stage_ends_at - now() < interval '30 seconds' and existing.team_id is null;
  if cap is distinct from auth.uid() and not backup then
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

-- ---------------------------------------------------------------------------
-- What a student sees

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
      select jsonb_build_object('description', x.description, 'code', x.code, 'explanation', x.explanation,
                                'submitted', x.submitted, 'submitted_code', x.submitted_code, 'submitted_at', x.submitted_at,
                                'submitted_by', (select coalesce(full_name, email) from public.profiles where id = x.submitted_by),
                                'translations_used', x.translations_used, 'updated_at', x.updated_at,
                                'updated_by', (select coalesce(full_name, email) from public.profiles where id = x.updated_by))
      from public.strategies x where x.session_id = s.id and x.team_id = sp.team_id));
  end if;
  return res;
end $$;

-- ---------------------------------------------------------------------------
-- Strategy tournament (students)

create or replace function public.save_strategy(p_session uuid, p_description text, p_code text, p_explanation text, p_submit boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.sessions;
  sp public.session_players;
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
  -- The draft is always updated; the submitted copy only changes when the team submits.
  insert into public.strategies(session_id, team_id, description, code, explanation, updated_by, updated_at)
  values (p_session, sp.team_id, coalesce(p_description, ''), coalesce(p_code, ''), coalesce(p_explanation, ''), auth.uid(), now())
  on conflict (session_id, team_id) do update set
    description = excluded.description, code = excluded.code, explanation = excluded.explanation,
    updated_by = excluded.updated_by, updated_at = now();
  if p_submit then
    update public.strategies set submitted = true, submitted_at = now(), submitted_by = auth.uid(),
      submitted_description = description, submitted_code = code, submitted_explanation = explanation
    where session_id = p_session and team_id = sp.team_id;
  end if;
  perform private.bump(p_session);
  return jsonb_build_object('ok', true);
end $$;

-- Called by the translate-strategy edge function on behalf of the signed-in student (rate limit + membership check)
create or replace function public.consume_translation(p_session uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s public.sessions;
  sp public.session_players;
  used int;
begin
  perform private.me();
  select * into s from public.sessions where id = p_session;
  if s.game_type is distinct from 'pd_tournament' or s.status not in ('running', 'lobby') then
    raise exception 'The strategy translator is only available during a strategy tournament.';
  end if;
  select * into sp from public.session_players where session_id = p_session and user_id = auth.uid();
  if sp.team_id is null then raise exception 'Join a team first.'; end if;
  insert into public.strategies(session_id, team_id, translations_used, updated_by)
  values (p_session, sp.team_id, 1, auth.uid())
  on conflict (session_id, team_id) do update set translations_used = public.strategies.translations_used + 1
  returning translations_used into used;
  if used > 40 then raise exception 'Your team has used all 40 translations for this game.'; end if;
  return jsonb_build_object('ok', true, 'used', used);
end $$;

-- ---------------------------------------------------------------------------
-- Instructors

create or replace function public.instructor_home() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v public.profiles;
begin
  v := private.require_instructor();
  return jsonb_build_object(
    'default_student_domains', private.cfg('default_student_domains'),
    'classes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'join_code', c.join_code, 'allowed_domains', c.allowed_domains,
        'archived', c.archived, 'created_at', c.created_at,
        'instructor', case when c.instructor_id <> v.id then (select coalesce(full_name, email) from public.profiles where id = c.instructor_id) end,
        'members', (select count(*) from public.class_members m where m.class_id = c.id),
        'sessions', coalesce((select jsonb_agg(jsonb_build_object(
            'id', s.id, 'title', s.title, 'game_type', s.game_type, 'status', s.status, 'created_at', s.created_at,
            'players', (select count(*) from public.session_players sp where sp.session_id = s.id))
            order by s.created_at desc) from public.sessions s where s.class_id = c.id), '[]'))
        order by c.archived, c.created_at desc)
      from public.classes c where c.instructor_id = v.id), '[]')
  );
end $$;

create or replace function public.create_class(p_name text, p_domains text[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v public.profiles; c public.classes;
begin
  v := private.require_instructor();
  if length(trim(coalesce(p_name, ''))) < 1 then raise exception 'Give the class a name.'; end if;
  insert into public.classes(instructor_id, name, join_code, allowed_domains)
  values (v.id, trim(p_name), private.new_join_code(),
          coalesce((select array_agg(distinct lower(trim(d))) from unnest(p_domains) d where trim(d) <> ''), '{}'))
  returning * into c;
  insert into public.class_members(class_id, user_id) values (c.id, v.id) on conflict do nothing;
  return to_jsonb(c);
end $$;

create or replace function public.update_class(p_class uuid, p_name text, p_domains text[], p_archived boolean, p_new_code boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.classes;
begin
  perform private.require_instructor();
  select * into c from public.classes where id = p_class;
  if c.id is null or (c.instructor_id <> auth.uid() and not public.is_admin()) then raise exception 'Not your class.'; end if;
  update public.classes set
    name = coalesce(nullif(trim(p_name), ''), name),
    allowed_domains = coalesce((select array_agg(distinct lower(trim(d))) from unnest(p_domains) d where trim(d) <> ''), '{}'),
    archived = coalesce(p_archived, archived),
    join_code = case when p_new_code then private.new_join_code() else join_code end
  where id = p_class returning * into c;
  return to_jsonb(c);
end $$;

create or replace function public.class_roster(p_class uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_instructor();
  if not exists (select 1 from public.classes where id = p_class and (instructor_id = auth.uid() or public.is_admin())) then
    raise exception 'Not your class.';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('user_id', p.id, 'name', p.full_name, 'email', p.email,
                                                       'student_id', p.student_id, 'joined_at', m.joined_at) order by p.full_name)
                   from public.class_members m join public.profiles p on p.id = m.user_id where m.class_id = p_class), '[]');
end $$;

create or replace function public.remove_class_member(p_class uuid, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_instructor();
  if not exists (select 1 from public.classes where id = p_class and (instructor_id = auth.uid() or public.is_admin())) then
    raise exception 'Not your class.';
  end if;
  delete from public.class_members where class_id = p_class and user_id = p_user;
end $$;

create or replace function public.create_session(p_class uuid, p_game_type text, p_title text, p_config jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v public.profiles; s public.sessions;
begin
  v := private.require_instructor();
  if not exists (select 1 from public.classes where id = p_class and (instructor_id = v.id or v.is_admin)) then
    raise exception 'Not your class.';
  end if;
  insert into public.sessions(class_id, instructor_id, game_type, title, config)
  values (p_class, (select instructor_id from public.classes where id = p_class), p_game_type,
          coalesce(nullif(trim(p_title), ''), p_game_type), coalesce(p_config, '{}'))
  returning * into s;
  insert into private.session_state(session_id) values (s.id);
  return jsonb_build_object('id', s.id);
end $$;

create or replace function public.update_session(p_session uuid, p_title text, p_config jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.sessions;
begin
  s := private.require_owner(p_session);
  if s.status <> 'lobby' then
    -- once running, only display settings may change
    p_config := s.config || jsonb_strip_nulls(jsonb_build_object(
      'leaderboard', p_config->'leaderboard', 'show_prices', p_config->'show_prices',
      'reveal_at_end', p_config->'reveal_at_end', 'auto_advance', p_config->'auto_advance'));
  end if;
  update public.sessions set title = coalesce(nullif(trim(p_title), ''), title), config = coalesce(p_config, config),
                             version = version + 1 where id = p_session;
end $$;

create or replace function public.delete_session(p_session uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_owner(p_session);
  delete from public.sessions where id = p_session;
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
        'description', coalesce(x.submitted_description, x.description), 'code', coalesce(x.submitted_code, x.code),
        'explanation', coalesce(x.submitted_explanation, x.explanation), 'submitted', x.submitted,
        'has_newer_draft', x.submitted and x.code is distinct from x.submitted_code, 'updated_at', x.updated_at))
      from public.strategies x where x.session_id = s.id), '[]')
  );
end $$;

create or replace function public.instructor_team_action(p_session uuid, p_action text, p_team uuid, p_user uuid, p_name text)
returns void language plpgsql security definer set search_path = '' as $$
declare s public.sessions; old uuid;
begin
  s := private.require_owner(p_session);
  if p_action = 'rename' then
    if exists (select 1 from public.teams where session_id = p_session and lower(name) = lower(trim(p_name)) and id <> p_team) then
      raise exception 'That team name is taken.';
    end if;
    update public.teams set name = left(trim(p_name), 40) where id = p_team and session_id = p_session;
  elsif p_action = 'delete_team' then
    if s.status <> 'lobby' then raise exception 'Teams can only be removed before the game starts.'; end if;
    update public.session_players set team_id = null, team_joined_at = null where team_id = p_team;
    delete from public.teams where id = p_team and session_id = p_session;
  elsif p_action = 'move_player' then
    select team_id into old from public.session_players where session_id = p_session and user_id = p_user;
    update public.session_players set team_id = p_team, team_joined_at = now() where session_id = p_session and user_id = p_user;
    if s.status = 'lobby' then
      delete from public.teams x where x.id = old and not exists (select 1 from public.session_players where team_id = old);
    end if;
  elsif p_action = 'remove_player' then
    select team_id into old from public.session_players where session_id = p_session and user_id = p_user;
    delete from public.session_players where session_id = p_session and user_id = p_user;
    if s.status = 'lobby' then
      delete from public.teams x where x.id = old and not exists (select 1 from public.session_players where team_id = old);
    end if;
  elsif p_action = 'mark_checked' then
    update public.session_players set passed_check = true where session_id = p_session and user_id = p_user;
  else
    raise exception 'Unknown action %', p_action;
  end if;
  perform private.bump(p_session);
end $$;

-- Start / control the game. Heavy lifting happens in the engine edge function.
create or replace function public.instructor_control(p_session uuid, p_action text, p_seconds int default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.sessions;
  remaining int;
begin
  s := private.require_owner(p_session);
  if p_action = 'start' then
    if s.status <> 'lobby' then raise exception 'This game has already started.'; end if;
    if not exists (select 1 from public.session_players where session_id = p_session) then
      raise exception 'Nobody has joined yet.';
    end if;
    update private.session_state set last_error = null where session_id = p_session;
    perform private.call_engine(p_session, 'start');
  elsif p_action = 'pause' then
    if s.status <> 'running' then raise exception 'The game is not running.'; end if;
    remaining := case when s.stage_ends_at is null then null
                      else greatest(0, (extract(epoch from (s.stage_ends_at - now())) * 1000)::int) end;
    update public.sessions set status = 'paused', paused_remaining_ms = remaining, stage_ends_at = null, version = version + 1
     where id = p_session;
  elsif p_action = 'resume' then
    if s.status <> 'paused' then raise exception 'The game is not paused.'; end if;
    update public.sessions set status = 'running',
      stage_ends_at = case when paused_remaining_ms is null then null
                           else now() + make_interval(secs => greatest(paused_remaining_ms, 5000) / 1000.0) end,
      paused_remaining_ms = null, version = version + 1
     where id = p_session;
  elsif p_action = 'extend' then
    if s.status = 'paused' then
      update public.sessions set paused_remaining_ms = coalesce(paused_remaining_ms, 0) + coalesce(p_seconds, 30) * 1000,
                                 version = version + 1 where id = p_session;
    else
      update public.sessions set stage_ends_at = greatest(coalesce(stage_ends_at, now()), now()) + make_interval(secs => coalesce(p_seconds, 30)),
                                 version = version + 1 where id = p_session;
    end if;
  elsif p_action = 'end_stage' then
    if s.status not in ('running', 'paused') or s.stage is null then raise exception 'No round is open.'; end if;
    update public.sessions set status = 'running', stage_ends_at = now(), paused_remaining_ms = null, version = version + 1
     where id = p_session;
    update private.session_state set advancing_until = now() + interval '20 seconds', last_error = null where session_id = p_session;
    perform private.call_engine(p_session, 'advance');
  elsif p_action = 'finish' then
    if s.status = 'finished' then raise exception 'Already finished.'; end if;
    perform private.call_engine(p_session, 'finish');
  elsif p_action = 'retry' then
    update private.session_state set advancing_until = null, last_error = null where session_id = p_session;
    if s.status = 'lobby' then perform private.call_engine(p_session, 'start');
    else perform private.maybe_advance(p_session); end if;
  else
    raise exception 'Unknown action %', p_action;
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- The official tournament runs in the instructor's browser (sandboxed worker); results are saved here.
create or replace function public.instructor_save_tournament(p_session uuid, p_results jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.sessions; r jsonb;
begin
  s := private.require_owner(p_session);
  if s.game_type <> 'pd_tournament' then raise exception 'Not a strategy tournament.'; end if;
  insert into public.session_outputs(session_id, kind, visibility, payload)
  values (p_session, 'tournament', 'students', p_results)
  on conflict (session_id, kind) do update set payload = excluded.payload, created_at = now();
  -- earnings per team, for grading exports
  delete from public.results where session_id = p_session;
  for r in select * from jsonb_array_elements(coalesce(p_results->'ranking', '[]')) loop
    if exists (select 1 from public.teams where id = (r->>'team_id')::uuid and session_id = p_session) then
      insert into public.results(session_id, round_no, team_id, payload, earnings)
      values (p_session, 1, (r->>'team_id')::uuid, r, coalesce((r->>'total')::numeric, 0));
    end if;
  end loop;
  update public.sessions set status = 'finished', finished_at = now(), stage = null, stage_ends_at = null,
                             version = version + 1 where id = p_session;
end $$;

create or replace function public.instructor_reopen_tournament(p_session uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.sessions;
begin
  s := private.require_owner(p_session);
  if s.game_type <> 'pd_tournament' then raise exception 'Not a strategy tournament.'; end if;
  update public.sessions set status = 'running', finished_at = null, stage = 'writing', version = version + 1 where id = p_session;
end $$;

-- Everything needed for grading: one row per student per round
create or replace function public.export_session(p_session uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s public.sessions;
begin
  s := private.require_owner(p_session);
  return jsonb_build_object(
    'session', jsonb_build_object('title', s.title, 'game_type', s.game_type, 'config', s.config,
                                  'class_name', (select name from public.classes where id = s.class_id)),
    'final', (select payload from public.session_outputs where session_id = s.id and kind = 'final'),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'student_name', p.full_name, 'email', p.email, 'student_id', p.student_id, 'team', t.name,
        'round', r.round_no, 'earnings', r.earnings, 'payload', r.payload,
        'decision_by', (select string_agg(distinct coalesce(dp.full_name, dp.email), '; ')
                        from public.decisions d join public.profiles dp on dp.id = d.submitted_by
                        where d.session_id = s.id and d.round_no = r.round_no and d.team_id = r.team_id))
        order by p.full_name, r.round_no)
      from public.session_players sp
      join public.profiles p on p.id = sp.user_id
      join public.teams t on t.id = sp.team_id
      join public.results r on r.session_id = s.id and r.team_id = sp.team_id
      where sp.session_id = s.id), '[]'),
    'students', coalesce((
      select jsonb_agg(jsonb_build_object('student_name', p.full_name, 'email', p.email, 'student_id', p.student_id,
                                          'team', t.name, 'passed_check', sp.passed_check,
                                          'total', (select coalesce(sum(earnings), 0) from public.results r where r.session_id = s.id and r.team_id = sp.team_id),
                                          'rounds', (select count(*) from public.results r where r.session_id = s.id and r.team_id = sp.team_id))
                       order by p.full_name)
      from public.session_players sp join public.profiles p on p.id = sp.user_id
      left join public.teams t on t.id = sp.team_id where sp.session_id = s.id), '[]')
  );
end $$;

-- ---------------------------------------------------------------------------
-- Admin

create or replace function public.admin_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  return jsonb_build_object(
    'instructors', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', full_name, 'email', email,
        'status', instructor_status, 'is_admin', is_admin, 'created_at', created_at) order by instructor_status, email)
      from public.profiles where instructor_status <> 'none' or is_admin), '[]'),
    'gemini_key_set', private.cfg('gemini_api_key') is not null,
    'engine_url', private.cfg('engine_url'),
    'instructor_auto_domains', private.cfg('instructor_auto_domains'),
    'default_student_domains', private.cfg('default_student_domains'),
    'counts', jsonb_build_object(
      'users', (select count(*) from public.profiles),
      'classes', (select count(*) from public.classes),
      'sessions', (select count(*) from public.sessions))
  );
end $$;

create or replace function public.admin_set_instructor(p_user uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  if p_status not in ('none', 'pending', 'approved', 'rejected') then raise exception 'Bad status'; end if;
  update public.profiles set instructor_status = p_status where id = p_user;
end $$;

create or replace function public.admin_set_config(p_key text, p_value text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  if p_key not in ('gemini_api_key', 'instructor_auto_domains', 'default_student_domains', 'admin_emails', 'gemini_model') then
    raise exception 'That setting cannot be changed here.';
  end if;
  if coalesce(trim(p_value), '') = '' then
    delete from private.app_config where key = p_key;
  else
    insert into private.app_config(key, value) values (p_key, trim(p_value))
    on conflict (key) do update set value = excluded.value;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Engine-only functions (called by edge functions with the service role key)

create or replace function public.engine_secret_ok(p_secret text) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_secret is not null and p_secret = private.cfg('engine_secret')
$$;

create or replace function public.engine_get_config(p_key text) returns text
language sql stable security definer set search_path = '' as $$
  select private.cfg(p_key) where p_key in ('gemini_api_key', 'gemini_model')
$$;

-- Lock in teams before the first round: fill teams, drop empty ones.
create or replace function public.engine_prepare_start(p_session uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s public.sessions;
  r record;
  t uuid;
  cap int;
  n int;
begin
  select * into s from public.sessions where id = p_session for update;
  if s.status <> 'lobby' then raise exception 'Already started'; end if;
  cap := private.team_cap(s);
  if private.team_mode(s) = 'teams' then
    for r in select user_id from public.session_players where session_id = p_session and team_id is null order by joined_at loop
      select tm.id into t from public.teams tm
       where tm.session_id = p_session
         and (select count(*) from public.session_players x where x.team_id = tm.id) < cap
       order by (select count(*) from public.session_players x where x.team_id = tm.id), tm.created_at limit 1;
      if t is null then
        n := (select count(*) from public.teams where session_id = p_session) + 1;
        insert into public.teams(session_id, name) values (p_session, private.unique_team_name(p_session, 'Team ' || n)) returning id into t;
      end if;
      update public.session_players set team_id = t, team_joined_at = now() where session_id = p_session and user_id = r.user_id;
    end loop;
  end if;
  delete from public.teams tm where tm.session_id = p_session
    and not exists (select 1 from public.session_players x where x.team_id = tm.id);
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name) order by created_at)
                   from public.teams where session_id = p_session), '[]');
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
                           where d.session_id = s.id and d.round_no = s.round_no and d.stage = s.stage), '{}')
  );
end $$;

-- Apply one engine step atomically. Returns false if the game moved on in the meantime.
create or replace function public.engine_apply(p_session uuid, p_patch jsonb) returns boolean
language plpgsql security definer set search_path = '' as $$
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
  update public.sessions set version = version + 1 where id = p_session;
  return true;
end $$;

create or replace function public.engine_error(p_session uuid, p_message text) returns void
language sql security definer set search_path = '' as $$
  update private.session_state set last_error = left(p_message, 1000), last_error_at = now(), advancing_until = null
   where session_id = p_session;
  update public.sessions set version = version + 1 where id = p_session;
$$;

-- ---------------------------------------------------------------------------
-- Permissions: functions are callable by signed-in users unless engine/admin-only.

revoke execute on all functions in schema private from public;
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in (
             'get_me','complete_profile','request_instructor','join_class','class_sessions','join_session','pass_check',
             'create_team','join_team','leave_team','rename_team','submit_decision','get_state','save_strategy','consume_translation',
             'instructor_home','create_class','update_class','class_roster','remove_class_member','create_session','update_session',
             'delete_session','instructor_state','instructor_team_action','instructor_control','instructor_save_tournament',
             'instructor_reopen_tournament','export_session','admin_overview','admin_set_instructor','admin_set_config',
             'tick','engine_secret_ok','engine_get_config','engine_prepare_start','engine_load','engine_apply','engine_error',
             'handle_new_user','ping','is_admin','owns_session','can_see_session')
  loop
    execute format('revoke execute on function %s from public', f.sig);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke execute on function %s from anon', f.sig); end if;
    if f.proname in ('tick','engine_secret_ok','engine_get_config','engine_prepare_start','engine_load','engine_apply','engine_error','handle_new_user') then
      if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('revoke execute on function %s from authenticated', f.sig); end if;
      if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant execute on function %s to service_role', f.sig); end if;
    elsif f.proname = 'ping' then
      if exists (select 1 from pg_roles where rolname = 'anon') then execute format('grant execute on function %s to anon', f.sig); end if;
    else
      if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('grant execute on function %s to authenticated', f.sig); end if;
    end if;
  end loop;
end $$;
