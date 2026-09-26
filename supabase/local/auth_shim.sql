-- Local stand-in for what Supabase provides out of the box (auth schema, auth.uid(),
-- the anon/authenticated roles). Loaded by PGlite in the demo and in tests only;
-- never applied to a real Supabase project.
create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  encrypted_password text,
  raw_user_meta_data jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

do $$
begin
  create role anon nologin;
exception when duplicate_object then null;
end $$;
do $$
begin
  create role authenticated nologin;
exception when duplicate_object then null;
end $$;

grant usage on schema auth to anon, authenticated;
grant usage on schema public to anon, authenticated;

-- Supabase creates the service_role too; the demo never uses it from the browser.
do $$
begin
  create role service_role nologin bypassrls;
exception when duplicate_object then null;
end $$;
