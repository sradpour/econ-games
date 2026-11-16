-- Teachers can delete their own classes (with every game and result in them),
-- and download the grades for every game in a class at once.

create or replace function public.delete_class(p_class uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.profiles;
begin
  v := private.require_instructor();
  if not exists (select 1 from public.classes where id = p_class and (instructor_id = v.id or v.is_admin)) then
    raise exception 'Not your class.';
  end if;
  delete from public.classes where id = p_class;
end $$;

-- Every game in a class with each student's total, for one gradebook file.
-- A student who never joined a game has no entry for it (blank), unlike one who joined and scored 0.
create or replace function public.export_class(p_class uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v public.profiles; c public.classes;
begin
  v := private.require_instructor();
  select * into c from public.classes where id = p_class;
  if c.id is null or not (c.instructor_id = v.id or v.is_admin) then raise exception 'Not your class.'; end if;
  return jsonb_build_object(
    'class_name', c.name,
    'games', coalesce((select jsonb_agg(jsonb_build_object(
        'id', s.id, 'title', s.title, 'game_type', s.game_type, 'status', s.status, 'created_at', s.created_at,
        'ranked_by', (select o.payload->>'ranked_by' from public.session_outputs o where o.session_id = s.id and o.kind = 'final'))
        order by s.created_at)
      from public.sessions s where s.class_id = c.id and s.status <> 'lobby'), '[]'),
    -- Class members (not the teacher), plus anyone who played a game here and has since left the class
    'students', coalesce((select jsonb_agg(jsonb_build_object('user_id', p.id, 'name', p.full_name, 'student_id', p.student_id,
        'email', p.email, 'in_class', exists (select 1 from public.class_members m where m.class_id = c.id and m.user_id = p.id))
        order by p.full_name, p.email)
      from public.profiles p
      where p.id <> c.instructor_id and (
        exists (select 1 from public.class_members m where m.class_id = c.id and m.user_id = p.id)
        or exists (select 1 from public.session_players sp join public.sessions s on s.id = sp.session_id
                   where s.class_id = c.id and sp.user_id = p.id))), '[]'),
    'scores', coalesce((select jsonb_agg(jsonb_build_object('user_id', sp.user_id, 'session_id', sp.session_id,
        'total', (select coalesce(sum(r.earnings), 0) from public.results r where r.session_id = sp.session_id and r.team_id = sp.team_id),
        'rounds', (select count(*) from public.results r where r.session_id = sp.session_id and r.team_id = sp.team_id)))
      from public.session_players sp join public.sessions s on s.id = sp.session_id
      where s.class_id = c.id and s.status <> 'lobby'), '[]')
  );
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.delete_class(uuid)', 'public.export_class(uuid)'] loop
    execute format('revoke execute on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke execute on function %s from anon', f); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('grant execute on function %s to authenticated', f); end if;
  end loop;
end $$;
