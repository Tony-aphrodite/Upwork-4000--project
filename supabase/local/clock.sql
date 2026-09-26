-- Demo only: lets the seed replay three months of history with the real functions. When
-- app.clock is empty (always, outside the seed) this is exactly the production now().
create or replace function private.now() returns timestamptz language sql stable as $$
  select coalesce(nullif(current_setting('app.clock', true), '')::timestamptz, now())
$$;
