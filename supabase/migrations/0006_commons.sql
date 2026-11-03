-- Tragedy of the commons game + anonymous group chat.

alter table public.sessions drop constraint if exists sessions_game_type_check;
alter table public.sessions add constraint sessions_game_type_check check (game_type in
  ('competitive','monopolistic','oligopoly','monopoly','pd_live','pd_tournament','public_goods','ultimatum','commons'));

-- Messages are only reachable through the functions below. Classmates see a letter (Fisher A, B, C),
-- never a name; the instructor sees names.
create table if not exists public.chat_messages (
  id bigserial primary key,
  session_id uuid not null references public.sessions(id) on delete cascade,
  round_no int not null,
  group_key text not null,
  team_id uuid references public.teams(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  label text not null,
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists chat_messages_group_idx on public.chat_messages(session_id, group_key, id);
create index if not exists chat_messages_user_idx on public.chat_messages(session_id, user_id, created_at);
alter table public.chat_messages enable row level security;

-- The caller's current group (from this round's assignment)
create or replace function private.my_chat_group(p_session uuid)
returns table(team_id uuid, round_no int, group_key text, label text, chat boolean)
language sql stable security definer set search_path = '' as $$
  select sp.team_id, s.round_no, a.info->>'group_key', a.info->>'label', coalesce((a.info->>'chat')::boolean, false)
  from public.sessions s
  join public.session_players sp on sp.session_id = s.id and sp.user_id = auth.uid()
  join public.assignments a on a.session_id = s.id and a.round_no = s.round_no and a.team_id = sp.team_id
  where s.id = p_session
$$;

create or replace function public.get_messages(p_session uuid, p_after bigint default 0) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  g record;
begin
  perform private.me();
  select * into g from private.my_chat_group(p_session);
  if g.group_key is null then return jsonb_build_object('group_key', null, 'messages', '[]'::jsonb); end if;
  return jsonb_build_object('group_key', g.group_key, 'label', g.label, 'messages', coalesce((
    select jsonb_agg(jsonb_build_object('id', m.id, 'label', m.label, 'body', m.body, 'mine', m.user_id = auth.uid(),
                                        'round_no', m.round_no, 'at', m.created_at) order by m.id)
    from (select * from public.chat_messages
          where session_id = p_session and group_key = g.group_key and id > coalesce(p_after, 0)
          order by id desc limit 200) m), '[]'::jsonb));
end $$;

create or replace function public.send_message(p_session uuid, p_body text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s public.sessions;
  sp public.session_players;
  g record;
  v_body text := regexp_replace(trim(coalesce(p_body, '')), '\s+', ' ', 'g');
begin
  perform private.me();
  select * into s from public.sessions where id = p_session;
  select * into sp from public.session_players where session_id = p_session and user_id = auth.uid();
  if sp.user_id is null then raise exception 'Join the game first.'; end if;
  if s.game_type <> 'commons' then raise exception 'This game has no chat.'; end if;
  if s.status <> 'running' or s.stage is distinct from 'chat' then raise exception 'The chat is closed right now.'; end if;
  select * into g from private.my_chat_group(p_session);
  if g.group_key is null or not g.chat then raise exception 'The chat is closed right now.'; end if;
  if v_body = '' then raise exception 'Type a message first.'; end if;
  if length(v_body) > 200 then raise exception 'Messages can be at most 200 characters.'; end if;
  if (select count(*) from public.chat_messages where session_id = p_session and user_id = auth.uid()
      and created_at > now() - interval '5 seconds') >= 3 then
    raise exception 'Slow down a little.';
  end if;
  if (select count(*) from public.chat_messages where session_id = p_session and user_id = auth.uid()
      and round_no = s.round_no) >= 25 then
    raise exception 'That''s the message limit for this round.';
  end if;
  insert into public.chat_messages(session_id, round_no, group_key, team_id, user_id, label, body)
  values (p_session, s.round_no, g.group_key, g.team_id, auth.uid(), coalesce(g.label, '?'), v_body);
  return jsonb_build_object('ok', true);
end $$;

-- Instructor: every group's messages with names (for monitoring and the chat log download)
create or replace function public.instructor_messages(p_session uuid, p_after bigint default 0) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_owner(p_session);
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', m.id, 'round_no', m.round_no, 'group_key', m.group_key, 'label', m.label,
                                        'body', m.body, 'at', m.created_at, 'name', coalesce(p.full_name, p.email),
                                        'email', p.email, 'student_id', p.student_id) order by m.id)
    from public.chat_messages m left join public.profiles p on p.id = m.user_id
    where m.session_id = p_session and m.id > coalesce(p_after, 0)), '[]'::jsonb);
end $$;

revoke execute on function private.my_chat_group(uuid) from public;
do $$
declare f text;
begin
  foreach f in array array['public.get_messages(uuid, bigint)', 'public.send_message(uuid, text)', 'public.instructor_messages(uuid, bigint)'] loop
    execute format('revoke execute on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke execute on function %s from anon', f); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('grant execute on function %s to authenticated', f); end if;
  end loop;
end $$;
