-- Admin tools: browse and delete users and classes from the site's Admin page.

create or replace function public.admin_list_users(p_search text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  return coalesce((
    select jsonb_agg(row_to_json(x) order by x.created_at desc)
    from (
      select p.id, p.email, p.full_name as name, p.student_id, p.is_admin, p.instructor_status, p.created_at,
             u.last_sign_in_at,
             (select count(*) from public.class_members m where m.user_id = p.id) as classes,
             (select count(*) from public.session_players sp where sp.user_id = p.id) as games
      from public.profiles p left join auth.users u on u.id = p.id
      where p_search is null or trim(p_search) = ''
         or p.email ilike '%' || trim(p_search) || '%'
         or coalesce(p.full_name, '') ilike '%' || trim(p_search) || '%'
         or coalesce(p.student_id, '') ilike '%' || trim(p_search) || '%'
      order by p.created_at desc
      limit 300
    ) x), '[]');
end $$;

create or replace function public.admin_delete_user(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.profiles;
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  if p_user = auth.uid() then raise exception 'You cannot delete your own account here.'; end if;
  select * into v from public.profiles where id = p_user;
  if v.id is null then raise exception 'User not found.'; end if;
  if v.is_admin then raise exception 'Admins cannot be deleted here.'; end if;
  -- Classes they teach go with them (and all games in those classes).
  delete from auth.users where id = p_user;
  delete from public.profiles where id = p_user;
end $$;

create or replace function public.admin_list_classes() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'name', c.name, 'join_code', c.join_code, 'archived', c.archived, 'created_at', c.created_at,
      'instructor', coalesce(p.full_name, p.email), 'instructor_email', p.email,
      'students', (select count(*) from public.class_members m where m.class_id = c.id and m.user_id <> c.instructor_id),
      'games', (select count(*) from public.sessions s where s.class_id = c.id))
      order by c.created_at desc)
    from public.classes c join public.profiles p on p.id = c.instructor_id), '[]');
end $$;

create or replace function public.admin_delete_class(p_class uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  delete from public.classes where id = p_class;
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.admin_list_users(text)', 'public.admin_delete_user(uuid)', 'public.admin_list_classes()', 'public.admin_delete_class(uuid)'] loop
    execute format('revoke execute on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke execute on function %s from anon', f); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('grant execute on function %s to authenticated', f); end if;
  end loop;
end $$;
