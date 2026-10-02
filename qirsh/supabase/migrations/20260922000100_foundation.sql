-- Step 1 · Foundation: environments (tenants), users and roles, settings, account kinds.
--
-- Every table below carries tenant_id, and every policy asks two questions: is this row in my
-- environment, and does my role allow it. The distributor is one environment today; each dealer
-- becomes another environment later, so dealer access is data, not a rewrite.
--
-- Conventions used in every migration:
--   * money is bigint in the smallest unit of its currency (cents; piastres for SDG), column
--     names end in _minor and say the currency: total_usd_minor, amount_sdg_minor.
--   * a conversion stores its rate next to the result. Rates are integers too: pounds per dollar
--     as a whole number, other rates in parts per million (_ppm).
--   * tables are read through RLS; every write goes through a function in this schema that
--     checks the caller's role. authenticated users get SELECT only.

create schema if not exists private;
create schema if not exists restricted; -- cost prices and margins: owner only, not exposed by the API
revoke all on schema private from public;
revoke all on schema restricted from public;

create type public.app_role as enum ('owner', 'marketing', 'adviser', 'warehouse');

-- ------------------------------------------------------------------ clock
-- One place that says what "now" is. The local demo overrides this to replay history.
create function private.now() returns timestamptz language sql stable as $$ select now() $$;
create function private.today() returns date language sql stable as $$ select (private.now() at time zone 'Africa/Khartoum')::date $$;

-- ------------------------------------------------------------------ environments
create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  name text not null check (length(trim(name)) > 0),
  kind text not null default 'distributor' check (kind in ('distributor', 'dealer')),
  parent_id uuid references public.tenants (id),
  created_at timestamptz not null default now()
);

create table public.tenant_settings (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  brand_name text not null,
  brand_color text not null default '#1E4D3B' check (brand_color ~ '^#[0-9A-Fa-f]{6}$'),
  brand_accent text not null default '#D9A441' check (brand_accent ~ '^#[0-9A-Fa-f]{6}$'),
  logo_initials text not null default 'S' check (length(logo_initials) between 1 and 3),
  logo_path text, -- storage: branding/<tenant>/logo.png
  sand_max_bps integer not null default 300 check (sand_max_bps between 0 and 10000),
  red_max_bps integer not null default 500 check (red_max_bps between 0 and 10000),
  min_rate_sdg integer not null default 8000 check (min_rate_sdg > 0),
  price_currency char(3) not null default 'USD',
  payment_currency char(3) not null default 'SDG',
  report_currency char(3) not null default 'EUR',
  currencies text[] not null default '{USD,SDG,EUR,AED}',
  max_transfer_sdg_minor bigint not null default 300000000 check (max_transfer_sdg_minor > 0), -- 3,000,000.00
  default_daily_limit_sdg_minor bigint not null default 1500000000, -- 15,000,000.00
  quote_validity_days integer not null default 2 check (quote_validity_days between 0 and 60),
  payment_terms text not null default 'Full payment in Sudanese pounds before goods are released. Transfers of at most 3,000,000 SDG.',
  landed_uplift_bps integer not null default 2000 check (landed_uplift_bps between 0 and 10000),
  forward_alert_hours integer not null default 24 check (forward_alert_hours > 0),
  default_locale text not null default 'en',
  updated_at timestamptz not null default now(),
  updated_by uuid,
  check (red_max_bps >= sand_max_bps)
);

-- Every settings change is kept: when the owner raises the minimum rate, the old value and the
-- moment it changed stay on record.
create table public.settings_history (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  changed_at timestamptz not null,
  changed_by uuid,
  old_values jsonb not null,
  new_values jsonb not null
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null check (length(trim(full_name)) > 0),
  email text not null,
  created_at timestamptz not null default now()
);

create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)), new.email);
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
for each row execute function private.handle_new_user();

-- One membership per person: a personal login in exactly one environment, with one role.
create table public.memberships (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  role public.app_role not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index on public.memberships (tenant_id);

-- ------------------------------------------------------------------ who is asking
create function private.tenant_id() returns uuid
language sql stable security definer set search_path = public as $$
  select tenant_id from public.memberships where user_id = auth.uid() and active
$$;

create function private.role() returns public.app_role
language sql stable security definer set search_path = public as $$
  select role from public.memberships where user_id = auth.uid() and active
$$;

create function private.has_role(variadic roles public.app_role[]) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = any (roles) from public.memberships where user_id = auth.uid() and active), false)
$$;

-- Raises "permission denied" (42501) unless the caller has one of the roles; returns the tenant.
create function private.require(variadic roles public.app_role[]) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare t uuid; r public.app_role;
begin
  select tenant_id, role into t, r from public.memberships where user_id = auth.uid() and active;
  if t is null then raise exception 'Please sign in.' using errcode = '42501'; end if;
  if not r = any (roles) then
    raise exception 'Your role (%) cannot do this.', r using errcode = '42501';
  end if;
  return t;
end $$;

create function private.settings(p_tenant uuid) returns public.tenant_settings
language sql stable security definer set search_path = public as $$
  select * from public.tenant_settings where tenant_id = p_tenant
$$;

-- ------------------------------------------------------------------ account kinds (configurable)
create table public.account_kinds (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  code text not null check (code ~ '^[a-z_]{2,30}$'),
  label text not null,
  receives_customer_payments boolean not null default false,
  pass_through boolean not null default false, -- must net to zero
  is_external boolean not null default false, -- customers, suppliers, expenses: the other side of a movement
  sort integer not null default 0,
  primary key (tenant_id, code)
);

-- ------------------------------------------------------------------ account holders and names
-- The same exchanger appears as "Mogtaba", "Mujtaba" and "Motgaba" on screenshots. One holder,
-- many spellings; matching uses a normalised form.
create table public.account_holders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  display_name text not null,
  kind text not null check (kind in ('exchanger', 'company', 'staff', 'relative', 'supplier', 'other')),
  phone text,
  note text,
  created_at timestamptz not null default now()
);
create index on public.account_holders (tenant_id);

create function private.norm_name(p text) returns text
language sql immutable as $$
  select regexp_replace(lower(coalesce(p, '')), '[^a-z0-9؀-ۿ]+', '', 'g')
$$;

create table public.holder_aliases (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  holder_id uuid not null references public.account_holders (id) on delete cascade,
  alias text not null,
  alias_norm text generated always as (private.norm_name(alias)) stored,
  unique (tenant_id, alias_norm)
);

-- ------------------------------------------------------------------ accounts
create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  kind text not null,
  holder_id uuid references public.account_holders (id),
  name text not null,
  bank text,
  number_masked text,
  currency char(3) not null,
  daily_limit_minor bigint check (daily_limit_minor is null or daily_limit_minor > 0),
  route_label text, -- where currency is converted: used to report the currency result per route
  forwards_to uuid references public.accounts (id), -- pass-through: the exchanger account it passes money on to
  active boolean not null default true,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, kind) references public.account_kinds (tenant_id, code)
);
create index on public.accounts (tenant_id);

-- ------------------------------------------------------------------ reference rates for reporting
-- Rates of the day for EUR and AED against the dollar, set by the owner. Rows that use a rate
-- copy it at that moment, so editing this table can never move a historical amount.
create table public.reference_rates (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  rate_date date not null,
  currency char(3) not null check (currency in ('EUR', 'AED')),
  per_usd_ppm bigint not null check (per_usd_ppm > 0), -- units of currency per 1 USD, x 1,000,000
  set_by uuid,
  set_at timestamptz not null default now(),
  primary key (tenant_id, currency, rate_date)
);

create function private.ref_rate(p_tenant uuid, p_currency text, p_day date) returns bigint
language sql stable security definer set search_path = public as $$
  select per_usd_ppm from public.reference_rates
  where tenant_id = p_tenant and currency = p_currency and rate_date <= p_day
  order by rate_date desc limit 1
$$;

-- ------------------------------------------------------------------ numbering
create table public.counters (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null,
  value bigint not null default 0,
  primary key (tenant_id, name)
);

create function private.next_number(p_tenant uuid, p_name text, p_prefix text) returns text
language plpgsql security definer set search_path = public as $$
declare v bigint;
begin
  insert into public.counters (tenant_id, name, value) values (p_tenant, p_name, 1)
  on conflict (tenant_id, name) do update set value = counters.value + 1
  returning value into v;
  return p_prefix || '-' || lpad(v::text, 5, '0');
end $$;

-- ------------------------------------------------------------------ append-only guard
-- Attached to every table that holds history. Nothing, not even the owner, edits or deletes a
-- saved amount: corrections are new rows that reverse old ones.
create function private.forbid_change() returns trigger language plpgsql as $$
begin
  raise exception '% rows are never changed or deleted; record a correction instead.', tg_table_name
    using errcode = 'P0001';
end $$;
