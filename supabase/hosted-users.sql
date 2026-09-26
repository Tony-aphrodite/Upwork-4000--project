-- The six people in the demo, as sign-ins on a hosted project, with the ids the seed data uses.
create extension if not exists pgcrypto with schema extensions;

-- Password for all of them: qirsh-demo
-- Run this after the migrations and before hosted-seed.sql. The trigger on auth.users writes the
-- matching rows in public.profiles.
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
   raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change)
values
  ('00000000-0000-0000-0000-000000000000', '0e000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'hamid@nileray.example',
   extensions.crypt('qirsh-demo', extensions.gen_salt('bf')), now(), now(), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"Hamid Osman"}'::jsonb, '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '0e000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'amira@nileray.example',
   extensions.crypt('qirsh-demo', extensions.gen_salt('bf')), now(), now(), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"Amira Hassan"}'::jsonb, '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '0e000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'nusiba@nileray.example',
   extensions.crypt('qirsh-demo', extensions.gen_salt('bf')), now(), now(), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"Nusiba Ali"}'::jsonb, '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '0e000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'salma@nileray.example',
   extensions.crypt('qirsh-demo', extensions.gen_salt('bf')), now(), now(), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"Salma Idris"}'::jsonb, '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '0e000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'tarig@nileray.example',
   extensions.crypt('qirsh-demo', extensions.gen_salt('bf')), now(), now(), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"Tarig Musa"}'::jsonb, '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '0e000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'yasir@dongolapower.example',
   extensions.crypt('qirsh-demo', extensions.gen_salt('bf')), now(), now(), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"Yasir Babiker"}'::jsonb, '', '', '', '')
on conflict (id) do nothing;
