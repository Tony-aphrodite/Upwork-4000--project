-- Demo only: the demo has no passwords, so choosing a person on the sign-in screen stands in for
-- Supabase Auth. It exists in the in-browser database only and is never applied to a project.
create or replace function public.demo_users() returns table (id uuid, full_name text, email text, role public.app_role, tenant_name text, tenant_kind text)
language sql security definer set search_path = public as $$
  select p.id, p.full_name, p.email, m.role, t.name, t.kind
  from public.profiles p join public.memberships m on m.user_id = p.id join public.tenants t on t.id = m.tenant_id
  order by t.kind, array_position(array['owner','adviser','marketing','warehouse']::text[], m.role::text), p.full_name
$$;
grant execute on function public.demo_users() to anon, authenticated;
