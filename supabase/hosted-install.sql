-- Qirsh on a hosted Supabase project: the whole schema, in order.
-- Run this first, then hosted-users.sql, then hosted-seed.sql.

-- ---------------------------------------------------------------- 20260922000100_foundation.sql
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

-- ---------------------------------------------------------------- 20260922000200_catalog_crm.sql
-- Step 1 base records (products, customers) plus Step 9 CRM fields, and the customer and message
-- model that the WhatsApp Business API (step 10) plugs into later without a rewrite.

create table public.products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  sku text not null,
  name text not null,
  category text not null check (category in ('inverter', 'battery', 'solar_ac', 'panel', 'bos', 'pump')),
  brand text,
  spec text,
  min_stock integer not null default 0 check (min_stock >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, sku)
);

-- Prices sit in their own table so row level security can keep them from the warehouse, which
-- reads products but "sees no financial data". Row security works on rows, not columns.
create table public.product_prices (
  product_id uuid primary key references public.products (id) on delete cascade,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  price_usd_minor bigint not null check (price_usd_minor > 0),
  updated_at timestamptz not null default now()
);

-- Price changes are kept; an order line copies the price it was sold at.
create table public.price_history (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  old_price_usd_minor bigint,
  new_price_usd_minor bigint not null,
  changed_at timestamptz not null,
  changed_by uuid
);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  code text not null,
  name text not null check (length(trim(name)) > 0),
  kind text not null default 'dealer' check (kind in ('dealer', 'installer')),
  city text not null,
  contact_name text,
  adviser_id uuid references public.profiles (id), -- "her own customers"
  segment text not null default 'C' check (segment in ('A+', 'A', 'B', 'C', 'D')),
  pipeline text not null default 'active' check (pipeline in ('lead', 'contacted', 'quoted', 'active', 'dormant', 'lost')),
  source text not null default 'referral' check (source in ('referral', 'walk_in', 'whatsapp', 'facebook', 'exhibition', 'field_visit', 'existing_network')),
  notes text,
  created_at timestamptz not null default now(),
  unique (tenant_id, code)
);
create index on public.customers (tenant_id, adviser_id);

-- Phone and WhatsApp numbers as their own rows: the WhatsApp inbox links messages to a contact.
create table public.customer_contacts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  customer_id uuid not null references public.customers (id) on delete cascade,
  channel text not null check (channel in ('whatsapp', 'phone', 'email')),
  value text not null,
  is_primary boolean not null default false,
  whatsapp_opt_in boolean not null default false
);
create index on public.customer_contacts (customer_id);

create table public.labels (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null,
  color text not null default 'slate',
  unique (tenant_id, name)
);

create table public.customer_labels (
  customer_id uuid not null references public.customers (id) on delete cascade,
  label_id uuid not null references public.labels (id) on delete cascade,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  primary key (customer_id, label_id)
);

-- Every conversation event with a customer. Today: share links opened from the app and notes.
-- Later: inbound and outbound WhatsApp Business API messages, with template and window fields.
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  customer_id uuid not null references public.customers (id) on delete cascade,
  contact_id uuid references public.customer_contacts (id),
  channel text not null check (channel in ('whatsapp_link', 'whatsapp_api', 'phone', 'note')),
  direction text not null check (direction in ('out', 'in', 'internal')),
  body text not null,
  template_name text, -- approved WhatsApp template, when sent through the API
  provider_message_id text, -- WhatsApp message id, for delivery status and replies
  related_order_id uuid,
  author_id uuid references public.profiles (id),
  created_at timestamptz not null default now()
);
create index on public.messages (customer_id, created_at desc);

-- ------------------------------------------------------------------ functions
create function public.save_customer(
  p_id uuid, p_name text, p_city text, p_kind text, p_contact_name text, p_phone text,
  p_segment text, p_pipeline text, p_source text, p_adviser_id uuid default null, p_notes text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  t uuid := private.require('owner', 'marketing', 'adviser');
  r public.app_role := private.role();
  existing public.customers;
  adviser uuid;
begin
  select * into existing from public.customers where id = p_id and tenant_id = t;
  if r = 'adviser' then
    if existing.id is not null and existing.adviser_id is distinct from auth.uid() then
      raise exception 'This customer belongs to another adviser.' using errcode = '42501';
    end if;
    adviser := auth.uid(); -- advisers only create and edit their own customers
  else
    adviser := coalesce(p_adviser_id, existing.adviser_id);
    if adviser is not null and not exists (select 1 from public.memberships where user_id = adviser and tenant_id = t and role = 'adviser') then
      raise exception 'That person is not an adviser here.';
    end if;
  end if;
  if existing.id is null then
    insert into public.customers (id, tenant_id, code, name, city, kind, contact_name, adviser_id, segment, pipeline, source, notes, created_at)
    values (coalesce(p_id, gen_random_uuid()), t, private.next_number(t, 'customer', 'C'), trim(p_name), trim(p_city), p_kind, p_contact_name, adviser,
            p_segment, p_pipeline, p_source, p_notes, private.now())
    returning id into p_id;
    if coalesce(trim(p_phone), '') <> '' then
      insert into public.customer_contacts (tenant_id, customer_id, channel, value, is_primary, whatsapp_opt_in)
      values (t, p_id, 'whatsapp', trim(p_phone), true, true);
    end if;
  else
    update public.customers set name = trim(p_name), city = trim(p_city), kind = p_kind, contact_name = p_contact_name,
      adviser_id = adviser, segment = p_segment, pipeline = p_pipeline, source = p_source, notes = p_notes
    where id = p_id;
    if coalesce(trim(p_phone), '') <> '' then
      update public.customer_contacts set value = trim(p_phone) where customer_id = p_id and is_primary;
      if not found then
        insert into public.customer_contacts (tenant_id, customer_id, channel, value, is_primary, whatsapp_opt_in)
        values (t, p_id, 'whatsapp', trim(p_phone), true, true);
      end if;
    end if;
  end if;
  return p_id;
end $$;

create function public.set_customer_labels(p_customer uuid, p_labels uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare t uuid := private.require('owner', 'marketing', 'adviser');
begin
  if not exists (select 1 from public.customers where id = p_customer and tenant_id = t
                 and (private.role() <> 'adviser' or adviser_id = auth.uid())) then
    raise exception 'Customer not found.' using errcode = '42501';
  end if;
  delete from public.customer_labels where customer_id = p_customer;
  insert into public.customer_labels (customer_id, label_id, tenant_id)
  select p_customer, l.id, t from public.labels l where l.id = any (p_labels) and l.tenant_id = t;
end $$;

create function public.log_message(p_customer uuid, p_channel text, p_body text, p_order uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare t uuid := private.require('owner', 'marketing', 'adviser'); v_id uuid;
begin
  if not exists (select 1 from public.customers c where c.id = p_customer and c.tenant_id = t
                 and (private.role() <> 'adviser' or c.adviser_id = auth.uid())) then
    raise exception 'Customer not found.' using errcode = '42501';
  end if;
  insert into public.messages (tenant_id, customer_id, channel, direction, body, related_order_id, author_id, created_at)
  values (t, p_customer, p_channel, case when p_channel = 'note' then 'internal' else 'out' end, p_body, p_order, auth.uid(), private.now())
  returning messages.id into v_id;
  return v_id;
end $$;

-- Only the owner sets prices.
create function public.set_price(p_product uuid, p_price_usd_minor bigint) returns void
language plpgsql security definer set search_path = public as $$
declare t uuid := private.require('owner'); v_old bigint;
begin
  if p_price_usd_minor is null or p_price_usd_minor <= 0 then raise exception 'A price must be above zero.'; end if;
  if not exists (select 1 from public.products where id = p_product and tenant_id = t) then raise exception 'Product not found.'; end if;
  select price_usd_minor into v_old from public.product_prices where product_id = p_product for update;
  insert into public.product_prices (product_id, tenant_id, price_usd_minor, updated_at) values (p_product, t, p_price_usd_minor, private.now())
  on conflict (product_id) do update set price_usd_minor = excluded.price_usd_minor, updated_at = excluded.updated_at;
  insert into public.price_history (tenant_id, product_id, old_price_usd_minor, new_price_usd_minor, changed_at, changed_by)
  values (t, p_product, v_old, p_price_usd_minor, private.now(), auth.uid());
end $$;

create function public.update_settings(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  t uuid := private.require('owner');
  before jsonb;
  after jsonb;
begin
  select to_jsonb(s) - 'tenant_id' - 'updated_at' - 'updated_by' into before from public.tenant_settings s where tenant_id = t;
  update public.tenant_settings set
    brand_name = coalesce(p ->> 'brand_name', brand_name),
    brand_color = coalesce(p ->> 'brand_color', brand_color),
    brand_accent = coalesce(p ->> 'brand_accent', brand_accent),
    logo_initials = coalesce(p ->> 'logo_initials', logo_initials),
    sand_max_bps = coalesce((p ->> 'sand_max_bps')::int, sand_max_bps),
    red_max_bps = coalesce((p ->> 'red_max_bps')::int, red_max_bps),
    min_rate_sdg = coalesce((p ->> 'min_rate_sdg')::int, min_rate_sdg),
    max_transfer_sdg_minor = coalesce((p ->> 'max_transfer_sdg_minor')::bigint, max_transfer_sdg_minor),
    default_daily_limit_sdg_minor = coalesce((p ->> 'default_daily_limit_sdg_minor')::bigint, default_daily_limit_sdg_minor),
    quote_validity_days = coalesce((p ->> 'quote_validity_days')::int, quote_validity_days),
    payment_terms = coalesce(p ->> 'payment_terms', payment_terms),
    landed_uplift_bps = coalesce((p ->> 'landed_uplift_bps')::int, landed_uplift_bps),
    forward_alert_hours = coalesce((p ->> 'forward_alert_hours')::int, forward_alert_hours),
    currencies = case when p ? 'currencies' then array(select jsonb_array_elements_text(p -> 'currencies')) else currencies end,
    updated_at = private.now(),
    updated_by = auth.uid()
  where tenant_id = t;
  select to_jsonb(s) - 'tenant_id' - 'updated_at' - 'updated_by' into after from public.tenant_settings s where tenant_id = t;
  if before is distinct from after then
    insert into public.settings_history (tenant_id, changed_at, changed_by, old_values, new_values)
    select t, private.now(), auth.uid(), jsonb_object_agg(k, before -> k), jsonb_object_agg(k, after -> k)
    from jsonb_object_keys(after) k where before -> k is distinct from after -> k;
  end if;
end $$;

create function public.set_reference_rate(p_currency text, p_day date, p_per_usd_ppm bigint) returns void
language plpgsql security definer set search_path = public as $$
declare t uuid := private.require('owner');
begin
  if p_per_usd_ppm is null or p_per_usd_ppm <= 0 then raise exception 'A rate must be above zero.'; end if;
  insert into public.reference_rates (tenant_id, rate_date, currency, per_usd_ppm, set_by, set_at)
  values (t, p_day, p_currency, p_per_usd_ppm, auth.uid(), private.now())
  on conflict (tenant_id, currency, rate_date) do update set per_usd_ppm = excluded.per_usd_ppm, set_by = excluded.set_by, set_at = excluded.set_at;
end $$;

create function public.add_holder_alias(p_holder uuid, p_alias text) returns void
language plpgsql security definer set search_path = public as $$
declare t uuid := private.require('owner', 'adviser');
begin
  if not exists (select 1 from public.account_holders where id = p_holder and tenant_id = t) then raise exception 'Holder not found.'; end if;
  insert into public.holder_aliases (tenant_id, holder_id, alias) values (t, p_holder, trim(p_alias))
  on conflict (tenant_id, alias_norm) do nothing;
end $$;

-- Finds the holder behind a name as it appears on a screenshot, whatever the spelling.
create function public.match_holder(p_name text) returns table (holder_id uuid, display_name text, matched_alias text)
language sql stable security definer set search_path = public as $$
  select h.id, h.display_name, a.alias
  from public.holder_aliases a join public.account_holders h on h.id = a.holder_id
  where a.tenant_id = private.tenant_id() and private.has_role('owner', 'adviser')
    and a.alias_norm = private.norm_name(p_name)
$$;

-- ---------------------------------------------------------------- 20260922000300_orders.sql
-- Step 2 · Orders (Finance), including quotes (step 8), which are orders that haven't been
-- confirmed yet and follow exactly the same price, discount and rate rules.
--
-- The rules the trial task names, and where each one is enforced:
--   1. Prices are fixed           -> save_order copies the product price; only the owner may override.
--   2. Discount per line          -> tier computed here with integers; above red_max_bps the line
--                                    needs an owner approval bound to that exact line.
--   3. One rate, never below min  -> save_order refuses a rate under tenant_settings.min_rate_sdg.
--   4. A saved order never changes-> amounts and rate are stored on the row; a trigger refuses
--                                    any later change to them, for every role including the owner.

create table public.discount_approvals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  draft_id uuid not null, -- the id the order will be saved under (generated on the phone)
  customer_id uuid not null references public.customers (id),
  product_id uuid not null references public.products (id),
  qty integer not null check (qty > 0),
  unit_price_usd_minor bigint not null,
  discount_usd_minor bigint not null check (discount_usd_minor > 0),
  value_usd_minor bigint not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_by uuid not null references public.profiles (id),
  requested_at timestamptz not null,
  decided_by uuid references public.profiles (id),
  decided_at timestamptz,
  note text,
  used_by_order uuid
);
create index on public.discount_approvals (tenant_id, status);
create index on public.discount_approvals (draft_id);

create table public.orders (
  id uuid primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  number text not null,
  kind text not null check (kind in ('quote', 'order')),
  status text not null check (status in ('quote', 'converted', 'expired', 'confirmed', 'cancelled')),
  customer_id uuid not null references public.customers (id),
  adviser_id uuid not null references public.profiles (id),
  rate_sdg integer not null check (rate_sdg > 0), -- pounds per dollar, as entered for this order
  eur_per_usd_ppm bigint not null check (eur_per_usd_ppm > 0), -- reference rate of the day, copied
  value_usd_minor bigint not null,
  discount_usd_minor bigint not null,
  total_usd_minor bigint not null,
  total_sdg_minor bigint not null,
  total_eur_minor bigint not null,
  paid_sdg_minor bigint not null default 0,
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid', 'partial', 'paid')),
  valid_until date,
  converted_from uuid references public.orders (id),
  converted_to uuid references public.orders (id),
  released_at timestamptz,
  released_by uuid references public.profiles (id),
  cancelled_at timestamptz,
  cancel_reason text,
  note text,
  payload_hash text not null, -- idempotency: the same save sent twice over a weak connection is one order
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null,
  unique (tenant_id, number),
  check (total_usd_minor = value_usd_minor - discount_usd_minor),
  check (total_sdg_minor = total_usd_minor * rate_sdg),
  check (paid_sdg_minor between 0 and total_sdg_minor)
);
create index on public.orders (tenant_id, created_at desc);
create index on public.orders (tenant_id, customer_id);
create index on public.orders (tenant_id, adviser_id);

create table public.order_lines (
  order_id uuid not null references public.orders (id) on delete cascade,
  line_no integer not null,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  product_id uuid not null references public.products (id),
  qty integer not null check (qty > 0),
  unit_price_usd_minor bigint not null check (unit_price_usd_minor > 0),
  price_overridden boolean not null default false,
  value_usd_minor bigint not null,
  discount_usd_minor bigint not null check (discount_usd_minor >= 0),
  total_usd_minor bigint not null,
  tier text not null check (tier in ('none', 'sand', 'red', 'approved')),
  approval_id uuid references public.discount_approvals (id),
  primary key (order_id, line_no),
  check (value_usd_minor = qty * unit_price_usd_minor),
  check (discount_usd_minor <= value_usd_minor),
  check (total_usd_minor = value_usd_minor - discount_usd_minor),
  check ((tier = 'approved') = (approval_id is not null))
);

create trigger order_lines_append_only before update or delete on public.order_lines
for each row execute function private.forbid_change();

-- On orders only the lifecycle columns may move; every amount, the rate and the parties are fixed.
-- The one exception is the creating transaction filling in its totals once.
create function private.guard_order() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Orders are never deleted; cancel them instead.' using errcode = 'P0001';
  end if;
  if current_setting('private.creating_order', true) = old.id::text and old.total_usd_minor = 0 and old.value_usd_minor = 0 then
    return new;
  end if;
  if (new.tenant_id, new.number, new.kind, new.customer_id, new.adviser_id, new.rate_sdg, new.eur_per_usd_ppm,
      new.value_usd_minor, new.discount_usd_minor, new.total_usd_minor, new.total_sdg_minor, new.total_eur_minor,
      new.created_by, new.created_at, new.payload_hash)
     is distinct from
     (old.tenant_id, old.number, old.kind, old.customer_id, old.adviser_id, old.rate_sdg, old.eur_per_usd_ppm,
      old.value_usd_minor, old.discount_usd_minor, old.total_usd_minor, old.total_sdg_minor, old.total_eur_minor,
      old.created_by, old.created_at, old.payload_hash) then
    raise exception 'A saved order never changes: its amounts, rate and customer are fixed.' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger orders_guard before update or delete on public.orders
for each row execute function private.guard_order();

-- ------------------------------------------------------------------ discount approvals
create function public.request_discount_approval(
  p_draft uuid, p_customer uuid, p_product uuid, p_qty integer, p_discount_usd_minor bigint, p_note text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  t uuid := private.require('owner', 'adviser');
  v_price bigint;
  v_id uuid;
begin
  if private.role() = 'adviser' and not exists (select 1 from public.customers c where c.id = p_customer and c.tenant_id = t and c.adviser_id = auth.uid()) then
    raise exception 'You can only ask for approvals on your own customers.' using errcode = '42501';
  end if;
  select pp.price_usd_minor into v_price from public.products p join public.product_prices pp on pp.product_id = p.id where p.id = p_product and p.tenant_id = t and p.active;
  if v_price is null then raise exception 'Product not found.'; end if;
  if p_qty is null or p_qty <= 0 or p_discount_usd_minor is null or p_discount_usd_minor <= 0 or p_discount_usd_minor > p_qty * v_price then
    raise exception 'Check the quantity and the discount.';
  end if;
  select a.id into v_id from public.discount_approvals a
  where a.draft_id = p_draft and a.product_id = p_product and a.qty = p_qty and a.discount_usd_minor = p_discount_usd_minor
    and a.status in ('pending', 'approved') and a.used_by_order is null;
  if v_id is not null then return v_id; end if;
  insert into public.discount_approvals (tenant_id, draft_id, customer_id, product_id, qty, unit_price_usd_minor, discount_usd_minor, value_usd_minor, requested_by, requested_at, note)
  values (t, p_draft, p_customer, p_product, p_qty, v_price, p_discount_usd_minor, p_qty * v_price, auth.uid(), private.now(), p_note)
  returning discount_approvals.id into v_id;
  return v_id;
end $$;

create function public.decide_discount_approval(p_id uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare t uuid := private.require('owner');
begin
  update public.discount_approvals
  set status = case when p_approve then 'approved' else 'rejected' end, decided_by = auth.uid(), decided_at = private.now(),
      note = coalesce(p_note, note)
  where id = p_id and tenant_id = t and status = 'pending';
  if not found then raise exception 'That request is no longer waiting for a decision.'; end if;
end $$;

-- ------------------------------------------------------------------ saving an order or a quote
create function private.order_json(p_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select to_jsonb(o) || jsonb_build_object(
    'customer_name', c.name, 'customer_city', c.city,
    'lines', (select jsonb_agg(to_jsonb(l) || jsonb_build_object('product_name', p.name, 'sku', p.sku) order by l.line_no)
              from public.order_lines l join public.products p on p.id = l.product_id where l.order_id = o.id))
  from public.orders o join public.customers c on c.id = o.customer_id where o.id = p_id
$$;

/*
  p_lines: [{ "product_id": uuid, "qty": int, "discount_usd_minor": int,
              "unit_price_usd_minor": int (owner only, to override the price),
              "approval_id": uuid (for a discount above the red threshold) }]
*/
create function public.save_order(
  p_id uuid, p_customer uuid, p_rate_sdg integer, p_lines jsonb, p_kind text default 'order', p_note text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  t uuid := private.require('owner', 'adviser');
  r public.app_role := private.role();
  s public.tenant_settings := private.settings(t);
  hash text := md5(jsonb_build_object('c', p_customer, 'r', p_rate_sdg, 'l', p_lines, 'k', p_kind, 'n', p_note)::text);
  existing public.orders;
  cust public.customers;
  line jsonb;
  n integer := 0;
  prod public.products;
  v_qty integer;
  v_price bigint;
  overridden boolean;
  v_line bigint;
  disc bigint;
  v_tier text;
  appr public.discount_approvals;
  eur_ppm bigint;
  v_value bigint := 0;
  v_disc bigint := 0;
begin
  if p_kind not in ('order', 'quote') then raise exception 'Unknown kind.'; end if;

  -- Idempotency: a retry after a dropped connection returns the order it already saved.
  select * into existing from public.orders where id = p_id;
  if existing.id is not null then
    if existing.tenant_id = t and existing.created_by = auth.uid() and existing.payload_hash = hash then
      return private.order_json(p_id);
    end if;
    raise exception 'This order was already saved and cannot be changed. Start a new one.' using errcode = 'P0001';
  end if;

  select * into cust from public.customers where id = p_customer and tenant_id = t;
  if cust.id is null then raise exception 'Customer not found.'; end if;
  if r = 'adviser' and cust.adviser_id is distinct from auth.uid() then
    raise exception 'You can only create orders for your own customers.' using errcode = '42501';
  end if;

  if p_rate_sdg is null or p_rate_sdg < s.min_rate_sdg then
    raise exception 'The rate cannot be below the minimum of % SDG per dollar.', to_char(s.min_rate_sdg, 'FM999,999,999')
      using errcode = 'P0001', hint = 'min_rate';
  end if;

  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Add at least one product.';
  end if;

  eur_ppm := private.ref_rate(t, 'EUR', private.today());
  if eur_ppm is null then raise exception 'The owner has not set a euro reference rate yet.'; end if;

  insert into public.orders (id, tenant_id, number, kind, status, customer_id, adviser_id, rate_sdg, eur_per_usd_ppm,
    value_usd_minor, discount_usd_minor, total_usd_minor, total_sdg_minor, total_eur_minor, valid_until, note, payload_hash, created_by, created_at)
  values (p_id, t, private.next_number(t, p_kind, case p_kind when 'quote' then 'Q' else 'SO' end), p_kind,
    case p_kind when 'quote' then 'quote' else 'confirmed' end, p_customer, coalesce(cust.adviser_id, auth.uid()), p_rate_sdg, eur_ppm,
    0, 0, 0, 0, 0, case p_kind when 'quote' then private.today() + s.quote_validity_days end, p_note, hash, auth.uid(), private.now());
  -- Totals are filled below, in the same transaction, before anyone can see the row. The guard
  -- trigger allows this one write because the row is still being created (see set_totals below).

  for line in select e.value from jsonb_array_elements(p_lines) e loop
    n := n + 1;
    select * into prod from public.products where id = (line ->> 'product_id')::uuid and tenant_id = t and active;
    if prod.id is null then raise exception 'Line %: product not found.', n; end if;
    select pp.price_usd_minor into v_price from public.product_prices pp where pp.product_id = prod.id;
    if v_price is null then raise exception 'Line %: % has no price yet.', n, prod.name; end if;
    v_qty := (line ->> 'qty')::int;
    if v_qty is null or v_qty <= 0 then raise exception 'Line %: quantity must be at least 1.', n; end if;

    overridden := false;
    if line ? 'unit_price_usd_minor' and (line ->> 'unit_price_usd_minor')::bigint <> v_price then
      if r <> 'owner' then
        raise exception 'Line %: prices are fixed. Only the owner can change a price.', n using errcode = '42501';
      end if;
      v_price := (line ->> 'unit_price_usd_minor')::bigint;
      if v_price <= 0 then raise exception 'Line %: a price must be above zero.', n; end if;
      overridden := true;
    end if;

    v_line := v_qty * v_price;
    disc := coalesce((line ->> 'discount_usd_minor')::bigint, 0);
    if disc < 0 then raise exception 'Line %: a discount cannot be negative.', n; end if;
    if disc > v_line then raise exception 'Line %: the discount is larger than the line.', n; end if;

    -- Integer comparison: disc / value <= bps / 10000  <=>  disc * 10000 <= value * bps
    v_tier := case
      when disc = 0 then 'none'
      when disc * 10000 <= v_line * s.sand_max_bps then 'sand'
      when disc * 10000 <= v_line * s.red_max_bps then 'red'
      else 'blocked' end;

    appr := null;
    if v_tier = 'blocked' then
      if r = 'owner' then
        -- The owner's own order: record the approval so the line still points at a decision.
        insert into public.discount_approvals (tenant_id, draft_id, customer_id, product_id, qty, unit_price_usd_minor, discount_usd_minor,
          value_usd_minor, status, requested_by, requested_at, decided_by, decided_at, note, used_by_order)
        values (t, p_id, p_customer, prod.id, v_qty, v_price, disc, v_line, 'approved', auth.uid(), private.now(), auth.uid(), private.now(), 'Owner''s own order', p_id)
        returning * into appr;
      else
        select * into appr from public.discount_approvals a
        where a.id = (line ->> 'approval_id')::uuid and a.tenant_id = t and a.status = 'approved' and a.used_by_order is null
          and a.draft_id = p_id and a.customer_id = p_customer and a.product_id = prod.id and a.qty = v_qty
          and a.unit_price_usd_minor = v_price and a.discount_usd_minor = disc
        for update;
        if appr.id is null then
          raise exception 'Line %: a discount of % is above % and needs the owner''s approval.', n,
            to_char(disc * 100.0 / v_line, 'FM990.00') || '%', to_char(s.red_max_bps / 100.0, 'FM990.##') || '%'
            using errcode = 'P0001', hint = 'approval_required';
        end if;
        update public.discount_approvals set used_by_order = p_id where id = appr.id;
      end if;
      v_tier := 'approved';
    end if;

    insert into public.order_lines (order_id, line_no, tenant_id, product_id, qty, unit_price_usd_minor, price_overridden,
      value_usd_minor, discount_usd_minor, total_usd_minor, tier, approval_id)
    values (p_id, n, t, prod.id, v_qty, v_price, overridden, v_line, disc, v_line - disc, v_tier, appr.id);
    v_value := v_value + v_line;
    v_disc := v_disc + disc;
  end loop;

  perform set_config('private.creating_order', p_id::text, true);
  update public.orders set value_usd_minor = v_value, discount_usd_minor = v_disc, total_usd_minor = v_value - v_disc,
    total_sdg_minor = (v_value - v_disc) * p_rate_sdg,
    total_eur_minor = round((v_value - v_disc)::numeric * eur_ppm / 1000000)
  where id = p_id;
  perform set_config('private.creating_order', '', true);

  return private.order_json(p_id);
end $$;

-- One click: a quote becomes an order with the same lines. Within its validity it keeps the
-- quote's rate; after that the adviser gives today's rate, which must respect the minimum.
create function public.convert_quote(p_quote uuid, p_new_id uuid, p_rate_sdg integer default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  t uuid := private.require('owner', 'adviser');
  q public.orders;
  lines jsonb;
  rate integer;
  result jsonb;
  hash text;
begin
  select * into q from public.orders where id = p_quote and tenant_id = t and kind = 'quote' for update;
  if q.id is null then raise exception 'Quote not found.'; end if;
  if private.role() = 'adviser' and q.adviser_id <> auth.uid() then raise exception 'Not your quote.' using errcode = '42501'; end if;
  if q.status = 'converted' then
    if q.converted_to = p_new_id then return private.order_json(p_new_id); end if; -- retry of the same click
    raise exception 'This quote is already an order.';
  end if;
  if q.status <> 'quote' then raise exception 'This quote is %.', q.status; end if;

  rate := coalesce(p_rate_sdg, case when private.today() <= q.valid_until then q.rate_sdg end);
  if rate is null then raise exception 'The quote has expired: enter today''s rate.' using hint = 'rate_needed'; end if;

  select jsonb_agg(jsonb_build_object('product_id', l.product_id, 'qty', l.qty, 'discount_usd_minor', l.discount_usd_minor,
                   'unit_price_usd_minor', l.unit_price_usd_minor) order by l.line_no)
  into lines from public.order_lines l where l.order_id = q.id;

  -- Lines the owner approved on the quote carry that approval into the order.
  insert into public.discount_approvals (tenant_id, draft_id, customer_id, product_id, qty, unit_price_usd_minor, discount_usd_minor,
    value_usd_minor, status, requested_by, requested_at, decided_by, decided_at, note)
  select t, p_new_id, q.customer_id, l.product_id, l.qty, l.unit_price_usd_minor, l.discount_usd_minor, l.value_usd_minor, 'approved',
    a.requested_by, private.now(), a.decided_by, a.decided_at, 'Carried over from quote ' || q.number
  from public.order_lines l join public.discount_approvals a on a.id = l.approval_id
  where l.order_id = q.id;

  select jsonb_agg(case when x.approval is null then x.line else x.line || jsonb_build_object('approval_id', x.approval) end order by x.ord)
  into lines
  from (
    select e.line, e.ord,
      (select a.id from public.discount_approvals a where a.draft_id = p_new_id and a.product_id = (e.line ->> 'product_id')::uuid
         and a.qty = (e.line ->> 'qty')::int and a.discount_usd_minor = (e.line ->> 'discount_usd_minor')::bigint limit 1) as approval
    from jsonb_array_elements(lines) with ordinality e(line, ord)
  ) x;

  -- Converting is allowed at the quoted price even if the catalogue price moved since.
  perform set_config('private.converting_quote', p_quote::text, true);
  result := private.save_converted(p_new_id, q, rate, lines);
  update public.orders set status = 'converted', converted_to = p_new_id where id = q.id;
  return result;
end $$;

-- Converts without re-checking price overrides (the quote already fixed the prices).
create function private.save_converted(p_id uuid, q public.orders, p_rate integer, p_lines jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s public.tenant_settings := private.settings(q.tenant_id);
  eur_ppm bigint := private.ref_rate(q.tenant_id, 'EUR', private.today());
  line jsonb; n integer := 0; v_line bigint; disc bigint; v_value bigint := 0; v_disc bigint := 0; appr uuid; tier text;
begin
  if p_rate < s.min_rate_sdg then
    raise exception 'The rate cannot be below the minimum of % SDG per dollar.', to_char(s.min_rate_sdg, 'FM999,999,999') using hint = 'min_rate';
  end if;
  insert into public.orders (id, tenant_id, number, kind, status, customer_id, adviser_id, rate_sdg, eur_per_usd_ppm,
    value_usd_minor, discount_usd_minor, total_usd_minor, total_sdg_minor, total_eur_minor, converted_from, payload_hash, created_by, created_at)
  values (p_id, q.tenant_id, private.next_number(q.tenant_id, 'order', 'SO'), 'order', 'confirmed', q.customer_id, q.adviser_id, p_rate, eur_ppm,
    0, 0, 0, 0, 0, q.id, md5('converted:' || q.id::text), auth.uid(), private.now());
  for line in select e.value from jsonb_array_elements(p_lines) e loop
    n := n + 1;
    v_line := (line ->> 'qty')::int * (line ->> 'unit_price_usd_minor')::bigint;
    disc := (line ->> 'discount_usd_minor')::bigint;
    appr := (line ->> 'approval_id')::uuid;
    tier := case when appr is not null then 'approved' when disc = 0 then 'none'
                 when disc * 10000 <= v_line * s.sand_max_bps then 'sand' when disc * 10000 <= v_line * s.red_max_bps then 'red' else null end;
    if tier is null then raise exception 'Line %: needs the owner''s approval.', n using hint = 'approval_required'; end if;
    if appr is not null then update public.discount_approvals set used_by_order = p_id where id = appr; end if;
    insert into public.order_lines (order_id, line_no, tenant_id, product_id, qty, unit_price_usd_minor, price_overridden, value_usd_minor,
      discount_usd_minor, total_usd_minor, tier, approval_id)
    select p_id, n, q.tenant_id, (line ->> 'product_id')::uuid, (line ->> 'qty')::int, (line ->> 'unit_price_usd_minor')::bigint,
      (line ->> 'unit_price_usd_minor')::bigint is distinct from pp.price_usd_minor, v_line, disc, v_line - disc, tier, appr
    from public.products p left join public.product_prices pp on pp.product_id = p.id where p.id = (line ->> 'product_id')::uuid;
    v_value := v_value + v_line;
    v_disc := v_disc + disc;
  end loop;
  perform set_config('private.creating_order', p_id::text, true);
  update public.orders set value_usd_minor = v_value, discount_usd_minor = v_disc, total_usd_minor = v_value - v_disc,
    total_sdg_minor = (v_value - v_disc) * p_rate, total_eur_minor = round((v_value - v_disc)::numeric * eur_ppm / 1000000)
  where id = p_id;
  perform set_config('private.creating_order', '', true);
  return private.order_json(p_id);
end $$;

create function public.cancel_order(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare t uuid := private.require('owner', 'adviser'); o public.orders;
begin
  select * into o from public.orders where id = p_id and tenant_id = t for update;
  if o.id is null then raise exception 'Order not found.'; end if;
  if private.role() = 'adviser' and o.adviser_id <> auth.uid() then raise exception 'Not your order.' using errcode = '42501'; end if;
  if o.released_at is not null then raise exception 'Goods have left the warehouse; record a return instead.'; end if;
  if o.paid_sdg_minor > 0 then raise exception 'Payments are matched to this order; move them first.'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Give a reason.'; end if;
  update public.orders set status = 'cancelled', cancelled_at = private.now(), cancel_reason = p_reason where id = p_id;
end $$;

-- ---------------------------------------------------------------- 20260922000400_receipts_ledger.sql
-- Steps 3 and 4 · Receipts with proof and status; accounts, limits and movements (Finance).
--
-- A receipt is one transfer, keyed on its bank transaction code. It pays one or more orders of
-- the same customer through allocations. Every allocation stores what that slice of pounds was
-- worth in dollars and euros *at the order's own rate*, so it never has to be recalculated.
--
-- The ledger has one line per movement of money, with an origin and a destination account. A
-- conversion (pounds paid out by an exchanger as euros) is one line with two amounts. Balances
-- are sums of lines; nothing is stored as a running total that could drift.

alter table public.reference_rates drop constraint reference_rates_currency_check;
alter table public.reference_rates add constraint reference_rates_currency_check check (currency in ('EUR', 'AED', 'SDG'));

create table public.receipts (
  id uuid primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  number text not null,
  txn_code text not null check (length(trim(txn_code)) >= 4),
  txn_code_norm text generated always as (upper(regexp_replace(txn_code, '[^0-9A-Za-z]', '', 'g'))) stored,
  amount_sdg_minor bigint not null check (amount_sdg_minor > 0),
  received_on date not null,
  customer_id uuid not null references public.customers (id),
  from_name text not null, -- the sender as it appears on the screenshot
  from_holder_id uuid references public.account_holders (id),
  to_account_id uuid not null references public.accounts (id),
  proof_path text not null, -- storage: proofs/<tenant>/<receipt>.jpg
  proof_sha256 text not null,
  status text not null default 'received' check (status in ('received', 'forwarded', 'confirmed')),
  forwarded_at timestamptz,
  forwarded_by uuid references public.profiles (id),
  confirmed_at timestamptz,
  confirmed_by uuid references public.profiles (id),
  flags text[] not null default '{}',
  allocated_sdg_minor bigint not null default 0,
  note text,
  recorded_by uuid not null references public.profiles (id),
  recorded_at timestamptz not null,
  unique (tenant_id, txn_code_norm),
  unique (tenant_id, number),
  check (allocated_sdg_minor between 0 and amount_sdg_minor)
);
create index on public.receipts (tenant_id, received_on);
create index on public.receipts (to_account_id, received_on);
create index on public.receipts (tenant_id, proof_sha256);

create function private.guard_receipt() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'Receipts are never deleted.' using errcode = 'P0001'; end if;
  if (new.txn_code, new.amount_sdg_minor, new.received_on, new.customer_id, new.to_account_id, new.proof_path, new.proof_sha256, new.recorded_by, new.recorded_at)
     is distinct from
     (old.txn_code, old.amount_sdg_minor, old.received_on, old.customer_id, old.to_account_id, old.proof_path, old.proof_sha256, old.recorded_by, old.recorded_at) then
    raise exception 'A recorded receipt never changes; record a correction instead.' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger receipts_guard before update or delete on public.receipts for each row execute function private.guard_receipt();

-- The same code again with a different amount is not silently refused: it is kept here, flagged,
-- until the owner resolves it.
create table public.receipt_conflicts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  receipt_id uuid not null references public.receipts (id),
  txn_code text not null,
  attempted_amount_sdg_minor bigint not null,
  attempted_on date not null,
  attempted_to_account_id uuid references public.accounts (id),
  proof_path text,
  raised_by uuid not null references public.profiles (id),
  raised_at timestamptz not null,
  resolved_at timestamptz,
  resolved_by uuid references public.profiles (id),
  resolution text
);

create table public.receipt_allocations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  receipt_id uuid not null references public.receipts (id),
  order_id uuid not null references public.orders (id),
  sdg_minor bigint not null check (sdg_minor > 0),
  booked_usd_minor bigint not null, -- this slice of pounds in dollars, at the order's rate
  booked_eur_minor bigint not null, -- and in euros, at the order's euro rate
  settled_sdg_minor bigint not null default 0, -- how much an exchanger has since paid out
  settled_booked_usd_minor bigint not null default 0,
  settled_booked_eur_minor bigint not null default 0,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null,
  check (settled_sdg_minor between 0 and sdg_minor)
);
create index on public.receipt_allocations (order_id);
create index on public.receipt_allocations (receipt_id);

create function private.guard_allocation() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'Allocations are never deleted.' using errcode = 'P0001'; end if;
  if (new.receipt_id, new.order_id, new.sdg_minor, new.booked_usd_minor, new.booked_eur_minor, new.created_at)
     is distinct from (old.receipt_id, old.order_id, old.sdg_minor, old.booked_usd_minor, old.booked_eur_minor, old.created_at)
     or new.settled_sdg_minor < old.settled_sdg_minor then
    raise exception 'An allocation never changes.' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger allocations_guard before update or delete on public.receipt_allocations for each row execute function private.guard_allocation();

-- ------------------------------------------------------------------ ledger
create table public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  occurred_on date not null,
  kind text not null check (kind in ('opening', 'receipt', 'transfer', 'payout', 'conversion', 'cash_withdrawal', 'expense', 'refund', 'supplier_payment', 'correction')),
  from_account_id uuid not null references public.accounts (id),
  from_amount_minor bigint not null check (from_amount_minor > 0),
  from_currency char(3) not null,
  to_account_id uuid not null references public.accounts (id),
  to_amount_minor bigint not null check (to_amount_minor > 0),
  to_currency char(3) not null,
  usd_minor bigint not null, -- the movement's value in dollars on its day, stored
  eur_minor bigint not null, -- and in euros
  eur_per_usd_ppm bigint not null,
  category text, -- expenses: rent, salaries, fuel, bank fees...
  memo text,
  receipt_id uuid references public.receipts (id),
  order_id uuid references public.orders (id),
  shipment_id uuid,
  reverses_id uuid references public.ledger_entries (id),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null,
  check (from_account_id <> to_account_id),
  check (from_currency <> to_currency or from_amount_minor = to_amount_minor)
);
create index on public.ledger_entries (tenant_id, occurred_on);
create index on public.ledger_entries (from_account_id);
create index on public.ledger_entries (to_account_id);
create trigger ledger_append_only before update or delete on public.ledger_entries for each row execute function private.forbid_change();

-- Actual balances as the bank or the exchanger reports them, to compare with the ledger.
create table public.account_statements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  account_id uuid not null references public.accounts (id),
  as_of date not null,
  balance_minor bigint not null,
  entered_by uuid references public.profiles (id),
  entered_at timestamptz not null,
  unique (account_id, as_of)
);

-- Currency result: one row per slice of pounds an exchanger paid out, or per conversion on the
-- UAE account. booked = what the order said those pounds were worth; realized = what arrived.
create table restricted.fx_facts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  occurred_on date not null,
  route text not null,
  ledger_entry_id uuid not null references public.ledger_entries (id),
  allocation_id uuid references public.receipt_allocations (id),
  order_id uuid references public.orders (id),
  customer_id uuid references public.customers (id),
  adviser_id uuid references public.profiles (id),
  sdg_minor bigint not null default 0,
  booked_usd_minor bigint not null,
  realized_usd_minor bigint not null,
  booked_eur_minor bigint not null,
  realized_eur_minor bigint not null
);
create index on restricted.fx_facts (tenant_id, occurred_on);
create trigger fx_facts_append_only before update or delete on restricted.fx_facts for each row execute function private.forbid_change();

-- ------------------------------------------------------------------ helpers
create function private.system_account(p_tenant uuid, p_kind text, p_currency text) returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.accounts where tenant_id = p_tenant and kind = p_kind and currency = p_currency order by created_at limit 1
$$;

-- Value of an amount in USD on a day, from the reference rates (for movements that aren't tied
-- to an order). Returned value is stored on the ledger line; it is never recomputed.
create function private.to_usd(p_tenant uuid, p_minor bigint, p_currency text, p_day date) returns bigint
language plpgsql stable security definer set search_path = public as $$
declare ppm bigint;
begin
  if p_currency = 'USD' then return p_minor; end if;
  ppm := private.ref_rate(p_tenant, p_currency, p_day);
  if ppm is null then raise exception 'No % reference rate on or before %.', p_currency, p_day; end if;
  return round(p_minor::numeric * 1000000 / ppm);
end $$;

create function private.ledger(
  p_tenant uuid, p_day date, p_kind text, p_from uuid, p_from_amount bigint, p_to uuid, p_to_amount bigint,
  p_usd bigint, p_memo text default null, p_receipt uuid default null, p_order uuid default null,
  p_shipment uuid default null, p_category text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  fa public.accounts; ta public.accounts; eur_ppm bigint := private.ref_rate(p_tenant, 'EUR', p_day); v_id uuid;
begin
  select * into fa from public.accounts a where a.id = p_from and a.tenant_id = p_tenant;
  select * into ta from public.accounts a where a.id = p_to and a.tenant_id = p_tenant;
  if fa.id is null or ta.id is null then raise exception 'Account not found.'; end if;
  if eur_ppm is null then raise exception 'No euro reference rate on or before %.', p_day; end if;
  insert into public.ledger_entries (tenant_id, occurred_on, kind, from_account_id, from_amount_minor, from_currency, to_account_id,
    to_amount_minor, to_currency, usd_minor, eur_minor, eur_per_usd_ppm, category, memo, receipt_id, order_id, shipment_id, created_by, created_at)
  values (p_tenant, p_day, p_kind, p_from, p_from_amount, fa.currency, p_to, p_to_amount, ta.currency, p_usd,
    round(p_usd::numeric * eur_ppm / 1000000), eur_ppm, p_category, p_memo, p_receipt, p_order, p_shipment, auth.uid(), private.now())
  returning ledger_entries.id into v_id;
  return v_id;
end $$;

create function private.intake(p_account uuid, p_day date) returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce(sum(amount_sdg_minor), 0)::bigint from public.receipts where to_account_id = p_account and received_on = p_day
$$;

-- ------------------------------------------------------------------ allocation
create function private.allocate(p_tenant uuid, p_receipt uuid, p_order uuid, p_sdg bigint) returns void
language plpgsql security definer set search_path = public as $$
declare
  rc public.receipts; o public.orders;
  before_paid bigint; after_paid bigint;
begin
  if p_sdg is null or p_sdg <= 0 then raise exception 'Allocate an amount above zero.'; end if;
  select * into rc from public.receipts where id = p_receipt and tenant_id = p_tenant for update;
  select * into o from public.orders where id = p_order and tenant_id = p_tenant for update;
  if rc.id is null or o.id is null then raise exception 'Receipt or order not found.'; end if;
  if o.kind <> 'order' or o.status <> 'confirmed' then raise exception 'Order % is not a confirmed order.', o.number; end if;
  if o.customer_id <> rc.customer_id then raise exception 'Order % belongs to another customer.', o.number; end if;
  if rc.allocated_sdg_minor + p_sdg > rc.amount_sdg_minor then
    raise exception 'Receipt % has only % SDG left to allocate.', rc.number, to_char((rc.amount_sdg_minor - rc.allocated_sdg_minor) / 100.0, 'FM999,999,999,990.##');
  end if;
  if o.paid_sdg_minor + p_sdg > o.total_sdg_minor then
    raise exception 'Order % has only % SDG outstanding.', o.number, to_char((o.total_sdg_minor - o.paid_sdg_minor) / 100.0, 'FM999,999,999,990.##');
  end if;
  before_paid := o.paid_sdg_minor;
  after_paid := o.paid_sdg_minor + p_sdg;
  -- Cumulative split: the dollar and euro values of all slices of an order add up exactly to the
  -- order's own totals, whatever the number of transfers.
  insert into public.receipt_allocations (tenant_id, receipt_id, order_id, sdg_minor, booked_usd_minor, booked_eur_minor, created_by, created_at)
  values (p_tenant, p_receipt, p_order, p_sdg,
    floor(o.total_usd_minor::numeric * after_paid / o.total_sdg_minor) - floor(o.total_usd_minor::numeric * before_paid / o.total_sdg_minor),
    floor(o.total_eur_minor::numeric * after_paid / o.total_sdg_minor) - floor(o.total_eur_minor::numeric * before_paid / o.total_sdg_minor),
    auth.uid(), private.now());
  update public.receipts set allocated_sdg_minor = allocated_sdg_minor + p_sdg where id = p_receipt;
  update public.orders set paid_sdg_minor = after_paid,
    payment_status = case when after_paid = total_sdg_minor then 'paid' else 'partial' end
  where id = p_order;
end $$;

create function public.allocate_receipt(p_receipt uuid, p_order uuid, p_sdg_minor bigint) returns void
language plpgsql security definer set search_path = public as $$
declare t uuid := private.require('owner', 'adviser');
begin
  if private.role() = 'adviser' and not exists (
    select 1 from public.receipts r join public.customers c on c.id = r.customer_id where r.id = p_receipt and c.adviser_id = auth.uid()) then
    raise exception 'Not your customer''s receipt.' using errcode = '42501';
  end if;
  perform private.allocate(t, p_receipt, p_order, p_sdg_minor);
end $$;

-- ------------------------------------------------------------------ recording a receipt
/*
  Returns { "outcome": "recorded" | "conflict", "receipt": {...}, "message": text }.
  A true duplicate (same code, same amount, or the same screenshot again) raises an error.
*/
create function public.record_receipt(
  p_id uuid, p_customer uuid, p_txn_code text, p_amount_sdg_minor bigint, p_received_on date, p_from_name text,
  p_to_account uuid, p_proof_path text, p_proof_sha256 text, p_allocations jsonb default '[]', p_note text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  t uuid := private.require('owner', 'adviser');
  s public.tenant_settings := private.settings(t);
  code_norm text := upper(regexp_replace(coalesce(p_txn_code, ''), '[^0-9A-Za-z]', '', 'g'));
  existing public.receipts;
  acc public.accounts;
  v_kind public.account_kinds;
  cust public.customers;
  v_flags text[] := '{}';
  a jsonb;
  holder uuid;
  v_number text;
begin
  -- A retry of the same save (weak connection) returns what was saved.
  select * into existing from public.receipts where id = p_id;
  if existing.id is not null then
    return jsonb_build_object('outcome', 'recorded', 'receipt', to_jsonb(existing), 'message', 'Already saved.');
  end if;

  select * into cust from public.customers where id = p_customer and tenant_id = t;
  if cust.id is null then raise exception 'Customer not found.'; end if;
  if private.role() = 'adviser' and cust.adviser_id is distinct from auth.uid() then
    raise exception 'You can only record receipts for your own customers.' using errcode = '42501';
  end if;
  if length(code_norm) < 4 then raise exception 'Enter the transaction code from the screenshot.'; end if;
  if p_amount_sdg_minor is null or p_amount_sdg_minor <= 0 then raise exception 'Enter the amount.'; end if;
  if p_amount_sdg_minor > s.max_transfer_sdg_minor then
    raise exception 'Transfers are capped at % SDG. Check the amount on the screenshot.', to_char(s.max_transfer_sdg_minor / 100, 'FM999,999,999');
  end if;
  if p_received_on is null or p_received_on > private.today() then raise exception 'The date cannot be in the future.'; end if;
  if coalesce(trim(p_proof_path), '') = '' or coalesce(p_proof_sha256, '') = '' then raise exception 'Attach the screenshot.'; end if;

  select * into existing from public.receipts where tenant_id = t and txn_code_norm = code_norm;
  if existing.id is not null then
    if existing.amount_sdg_minor = p_amount_sdg_minor then
      raise exception 'Already recorded: % on % (%). This is a duplicate and was not saved.', existing.number, to_char(existing.received_on, 'DD Mon'), existing.txn_code
        using hint = 'duplicate';
    end if;
    insert into public.receipt_conflicts (tenant_id, receipt_id, txn_code, attempted_amount_sdg_minor, attempted_on, attempted_to_account_id, proof_path, raised_by, raised_at)
    values (t, existing.id, p_txn_code, p_amount_sdg_minor, p_received_on, p_to_account, p_proof_path, auth.uid(), private.now());
    return jsonb_build_object('outcome', 'conflict', 'receipt', to_jsonb(existing),
      'message', format('Code %s is already on %s with a different amount. Flagged for the owner.', existing.txn_code, existing.number));
  end if;

  select * into existing from public.receipts where tenant_id = t and proof_sha256 = p_proof_sha256;
  if existing.id is not null then
    raise exception 'This screenshot is already attached to % (code %). It was not saved again.', existing.number, existing.txn_code using hint = 'duplicate';
  end if;

  select * into acc from public.accounts where id = p_to_account and tenant_id = t and active;
  select * into v_kind from public.account_kinds k where k.tenant_id = t and k.code = acc.kind;
  if acc.id is null or not v_kind.receives_customer_payments or acc.currency <> 'SDG' then
    raise exception 'Choose one of the accounts customers pay into.';
  end if;
  if acc.daily_limit_minor is not null and private.intake(acc.id, p_received_on) + p_amount_sdg_minor > acc.daily_limit_minor then
    v_flags := array_append(v_flags, 'over_daily_limit');
  end if;

  select h.holder_id into holder from public.match_holder(p_from_name) h limit 1;
  v_number := private.next_number(t, 'receipt', 'R');
  insert into public.receipts (id, tenant_id, number, txn_code, amount_sdg_minor, received_on, customer_id, from_name, from_holder_id, to_account_id,
    proof_path, proof_sha256, flags, note, recorded_by, recorded_at)
  values (p_id, t, v_number, trim(p_txn_code), p_amount_sdg_minor, p_received_on, p_customer, trim(p_from_name), holder, p_to_account,
    p_proof_path, p_proof_sha256, v_flags, p_note, auth.uid(), private.now());

  perform private.ledger(t, p_received_on, 'receipt', private.system_account(t, 'customers', 'SDG'), p_amount_sdg_minor, p_to_account,
    p_amount_sdg_minor, private.to_usd(t, p_amount_sdg_minor, 'SDG', p_received_on), 'Receipt ' || v_number || ' · ' || cust.name, p_id);

  for a in select e.value from jsonb_array_elements(coalesce(p_allocations, '[]')) e loop
    perform private.allocate(t, p_id, (a ->> 'order_id')::uuid, (a ->> 'sdg_minor')::bigint);
  end loop;

  return jsonb_build_object('outcome', 'recorded', 'receipt', (select to_jsonb(r) from public.receipts r where r.id = p_id),
    'message', case when 'over_daily_limit' = any (v_flags) then 'Saved, and flagged: this account is over its daily limit.' else 'Saved.' end);
end $$;

create function public.set_receipt_status(p_ids uuid[], p_status text) returns integer
language plpgsql security definer set search_path = public as $$
declare t uuid := private.require('owner', 'adviser'); n integer;
begin
  if p_status = 'forwarded' then
    update public.receipts r set status = 'forwarded', forwarded_at = private.now(), forwarded_by = auth.uid()
    where r.id = any (p_ids) and r.tenant_id = t and r.status = 'received'
      and (private.role() = 'owner' or exists (select 1 from public.customers c where c.id = r.customer_id and c.adviser_id = auth.uid()));
  elsif p_status = 'confirmed' then
    perform private.require('owner');
    update public.receipts r set status = 'confirmed', confirmed_at = private.now(), confirmed_by = auth.uid(),
      forwarded_at = coalesce(forwarded_at, private.now()), forwarded_by = coalesce(forwarded_by, auth.uid())
    where r.id = any (p_ids) and r.tenant_id = t and r.status in ('received', 'forwarded');
  else
    raise exception 'Unknown status.';
  end if;
  get diagnostics n = row_count;
  return n;
end $$;

create function public.resolve_conflict(p_id uuid, p_resolution text) returns void
language plpgsql security definer set search_path = public as $$
declare t uuid := private.require('owner');
begin
  if coalesce(trim(p_resolution), '') = '' then raise exception 'Say how it was resolved.'; end if;
  update public.receipt_conflicts set resolved_at = private.now(), resolved_by = auth.uid(), resolution = p_resolution
  where id = p_id and tenant_id = t and resolved_at is null;
  if not found then raise exception 'Already resolved.'; end if;
end $$;

-- ------------------------------------------------------------------ movements
/*
  Owner records transfers, cash taken by staff, expenses, refunds, supplier payments and
  conversions. Payouts by exchangers have their own function because they settle receipts.
*/
create function public.record_movement(
  p_kind text, p_day date, p_from uuid, p_from_amount bigint, p_to uuid, p_to_amount bigint default null,
  p_memo text default null, p_category text default null, p_order uuid default null, p_shipment uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  t uuid := private.require('owner');
  fa public.accounts; ta public.accounts;
  to_amount bigint := coalesce(p_to_amount, p_from_amount);
  usd bigint; v_id uuid; realized bigint;
begin
  if p_kind not in ('transfer', 'cash_withdrawal', 'expense', 'refund', 'supplier_payment', 'conversion', 'opening') then
    raise exception 'Use record_payout for exchanger payouts.';
  end if;
  select * into fa from public.accounts where id = p_from and tenant_id = t;
  select * into ta from public.accounts where id = p_to and tenant_id = t;
  if fa.id is null or ta.id is null then raise exception 'Account not found.'; end if;
  if p_kind = 'conversion' and fa.currency = ta.currency then raise exception 'A conversion changes currency.'; end if;
  if p_kind <> 'conversion' and fa.currency <> ta.currency then raise exception 'Use a conversion to change currency.'; end if;
  if p_kind = 'refund' and p_order is null then raise exception 'A refund belongs to an order.'; end if;
  if p_kind = 'expense' and coalesce(p_category, '') = '' then raise exception 'Give the expense a category.'; end if;
  if p_day > private.today() then raise exception 'The date cannot be in the future.'; end if;

  usd := private.to_usd(t, p_from_amount, fa.currency, p_day);
  v_id := private.ledger(t, p_day, p_kind, p_from, p_from_amount, p_to, to_amount, usd, p_memo, null, p_order, p_shipment, p_category);

  if p_kind = 'conversion' then
    -- Converting on the UAE account: the result is what arrived minus what went in, both valued
    -- in dollars at the day's reference rates. Reported under the account's route.
    realized := private.to_usd(t, to_amount, ta.currency, p_day);
    insert into restricted.fx_facts (tenant_id, occurred_on, route, ledger_entry_id, booked_usd_minor, realized_usd_minor, booked_eur_minor, realized_eur_minor)
    values (t, p_day, coalesce(fa.route_label, fa.name), v_id, usd, realized,
      round(usd::numeric * private.ref_rate(t, 'EUR', p_day) / 1000000), round(realized::numeric * private.ref_rate(t, 'EUR', p_day) / 1000000));
  end if;
  return v_id;
end $$;

/*
  An exchanger pays out pounds it holds for us, as euros (or AED/USD) to our UAE account or
  straight to a supplier. The pounds are settled first-in first-out against confirmed receipts
  on that account, slice by slice down to the orders they paid, so the currency result lands on
  the order, the customer, the adviser and the route.
*/
create function public.record_payout(
  p_day date, p_from_account uuid, p_sdg_minor bigint, p_to_account uuid, p_to_amount bigint, p_memo text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  t uuid := private.require('owner');
  fa public.accounts; ta public.accounts;
  realized_usd bigint; realized_eur bigint; eur_ppm bigint;
  entry uuid; route text;
  left_sdg bigint := p_sdg_minor; cum bigint := 0; prev_usd bigint := 0; prev_eur bigint := 0;
  take bigint; b_usd bigint; b_eur bigint; r_usd bigint; r_eur bigint; available bigint;
  al record;
begin
  select * into fa from public.accounts where id = p_from_account and tenant_id = t;
  select * into ta from public.accounts where id = p_to_account and tenant_id = t;
  if fa.id is null or ta.id is null then raise exception 'Account not found.'; end if;
  if fa.currency <> 'SDG' then raise exception 'A payout starts from a pounds account.'; end if;
  if ta.currency = 'SDG' then raise exception 'Use a transfer to move pounds.'; end if;
  if p_sdg_minor is null or p_sdg_minor <= 0 or p_to_amount is null or p_to_amount <= 0 then raise exception 'Enter both amounts.'; end if;

  -- Pounds on this account: paid straight in, or paid into a pass-through account that forwards here.
  select coalesce(sum(a.sdg_minor - a.settled_sdg_minor), 0) into available
  from public.receipt_allocations a join public.receipts r on r.id = a.receipt_id
  where r.status = 'confirmed' and (r.to_account_id = p_from_account
    or r.to_account_id in (select id from public.accounts where forwards_to = p_from_account));
  if available < p_sdg_minor then
    raise exception 'Only % SDG on this account is confirmed and matched to orders. Confirm or match the rest first.',
      to_char(available / 100.0, 'FM999,999,999,990.##') using hint = 'unsettled';
  end if;

  eur_ppm := private.ref_rate(t, 'EUR', p_day);
  realized_usd := private.to_usd(t, p_to_amount, ta.currency, p_day);
  realized_eur := case when ta.currency = 'EUR' then p_to_amount else round(realized_usd::numeric * eur_ppm / 1000000) end;
  route := coalesce(fa.route_label, (select display_name from public.account_holders where id = fa.holder_id), fa.name);

  entry := private.ledger(t, p_day, 'payout', p_from_account, p_sdg_minor, p_to_account, p_to_amount, realized_usd, p_memo);

  for al in
    select a.*, o.customer_id, o.adviser_id
    from public.receipt_allocations a
    join public.receipts r on r.id = a.receipt_id
    join public.orders o on o.id = a.order_id
    where r.status = 'confirmed' and a.settled_sdg_minor < a.sdg_minor
      and (r.to_account_id = p_from_account or r.to_account_id in (select id from public.accounts where forwards_to = p_from_account))
    order by r.received_on, r.recorded_at, a.created_at, a.id
    for update of a
  loop
    exit when left_sdg = 0;
    take := least(left_sdg, al.sdg_minor - al.settled_sdg_minor);
    -- booked value of this slice: cumulative split of the allocation's booked value
    b_usd := floor(al.booked_usd_minor::numeric * (al.settled_sdg_minor + take) / al.sdg_minor) - floor(al.booked_usd_minor::numeric * al.settled_sdg_minor / al.sdg_minor);
    b_eur := floor(al.booked_eur_minor::numeric * (al.settled_sdg_minor + take) / al.sdg_minor) - floor(al.booked_eur_minor::numeric * al.settled_sdg_minor / al.sdg_minor);
    -- realized value of this slice: cumulative split of what arrived
    cum := cum + take;
    r_usd := floor(realized_usd::numeric * cum / p_sdg_minor) - prev_usd;
    r_eur := floor(realized_eur::numeric * cum / p_sdg_minor) - prev_eur;
    prev_usd := prev_usd + r_usd;
    prev_eur := prev_eur + r_eur;
    insert into restricted.fx_facts (tenant_id, occurred_on, route, ledger_entry_id, allocation_id, order_id, customer_id, adviser_id,
      sdg_minor, booked_usd_minor, realized_usd_minor, booked_eur_minor, realized_eur_minor)
    values (t, p_day, route, entry, al.id, al.order_id, al.customer_id, al.adviser_id, take, b_usd, r_usd, b_eur, r_eur);
    update public.receipt_allocations set settled_sdg_minor = settled_sdg_minor + take,
      settled_booked_usd_minor = settled_booked_usd_minor + b_usd, settled_booked_eur_minor = settled_booked_eur_minor + b_eur
    where id = al.id;
    left_sdg := left_sdg - take;
  end loop;
  return entry;
end $$;

create function public.record_statement(p_account uuid, p_as_of date, p_balance_minor bigint) returns void
language plpgsql security definer set search_path = public as $$
declare t uuid := private.require('owner');
begin
  if not exists (select 1 from public.accounts where id = p_account and tenant_id = t) then raise exception 'Account not found.'; end if;
  insert into public.account_statements (tenant_id, account_id, as_of, balance_minor, entered_by, entered_at)
  values (t, p_account, p_as_of, p_balance_minor, auth.uid(), private.now())
  on conflict (account_id, as_of) do update set balance_minor = excluded.balance_minor, entered_by = excluded.entered_by, entered_at = excluded.entered_at;
end $$;

-- ---------------------------------------------------------------- 20260922000500_stock.sql
-- Steps 5 and 6 · Release against paid orders; purchasing, landed cost and stock (Stock).
--
-- Quantities and money live in different tables on purpose. The warehouse reads shipments, lines
-- and lots (quantities only). Purchase prices, costs and landed cost are in `restricted`, which
-- only the owner can read. The cost of goods sold is fixed at release, first-in first-out by
-- lot, and written once to restricted.sale_facts: every margin report sums those rows.

create table public.shipments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  ref text not null,
  supplier text not null,
  origin text,
  status text not null default 'ordered' check (status in ('ordered', 'in_transit', 'arrived', 'received')),
  ordered_on date not null,
  eta date,
  arrived_on date,
  received_on date,
  costs_final boolean not null default false,
  note text,
  created_at timestamptz not null default now(),
  unique (tenant_id, ref)
);

create table public.shipment_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  shipment_id uuid not null references public.shipments (id) on delete cascade,
  product_id uuid not null references public.products (id),
  qty integer not null check (qty > 0)
);
create index on public.shipment_lines (shipment_id);

-- The money side of a shipment: invoice currency, the rate paid for euros and the bank's
-- commission, the uplift used. Owner only.
create table restricted.shipment_finance (
  shipment_id uuid primary key references public.shipments (id) on delete cascade,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  invoice_currency char(3) not null check (invoice_currency in ('USD', 'EUR')),
  usd_per_eur_ppm bigint, -- dollars paid per euro, x 1,000,000, when the invoice is in euros
  commission_bps integer not null default 0 check (commission_bps between 0 and 2000),
  uplift_bps integer not null default 2000,
  eur_per_usd_ppm bigint not null, -- euro reference rate of the shipment date, for euro reporting
  purchase_usd_minor bigint not null default 0,
  indirect_usd_minor bigint not null default 0,
  uplifted_indirect_usd_minor bigint not null default 0,
  finalised_at timestamptz
);

create table restricted.shipment_line_costs (
  line_id uuid primary key references public.shipment_lines (id) on delete cascade,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  unit_price_minor bigint not null check (unit_price_minor > 0), -- in the invoice currency
  purchase_usd_minor bigint, -- the line in dollars, after conversion and commission
  indirect_share_usd_minor bigint,
  landed_usd_minor bigint, -- the whole line; unit cost = landed / qty, split exactly per unit sold
  landed_unit_usd_minor bigint -- rounded, for display
);

create table restricted.shipment_costs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  shipment_id uuid not null references public.shipments (id) on delete cascade,
  kind text not null check (kind in ('freight', 'insurance', 'customs', 'clearance', 'port', 'transport', 'other')),
  amount_minor bigint not null check (amount_minor > 0),
  currency char(3) not null check (currency in ('USD', 'EUR', 'AED', 'SDG')),
  usd_minor bigint not null, -- converted on the day it was paid, stored
  rate_note text, -- the rate used, as text for the dossier
  incurred_on date not null,
  note text
);
create index on restricted.shipment_costs (shipment_id);

create table public.stock_lots (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  product_id uuid not null references public.products (id),
  shipment_line_id uuid not null references public.shipment_lines (id),
  qty_in integer not null check (qty_in > 0),
  qty_out integer not null default 0,
  received_on date not null,
  check (qty_out between 0 and qty_in)
);
create index on public.stock_lots (tenant_id, product_id, received_on);

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  product_id uuid not null references public.products (id),
  lot_id uuid references public.stock_lots (id),
  qty integer not null check (qty <> 0),
  kind text not null check (kind in ('receive', 'release', 'adjust')),
  order_id uuid references public.orders (id),
  shipment_id uuid references public.shipments (id),
  note text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null
);
create index on public.stock_movements (tenant_id, product_id, created_at desc);
create trigger stock_movements_append_only before update or delete on public.stock_movements for each row execute function private.forbid_change();

-- One row per order line per lot it came from. Written once, at release.
create table restricted.sale_facts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  released_on date not null,
  order_id uuid not null references public.orders (id),
  line_no integer not null,
  product_id uuid not null references public.products (id),
  customer_id uuid not null references public.customers (id),
  adviser_id uuid not null references public.profiles (id),
  shipment_id uuid not null references public.shipments (id),
  lot_id uuid not null references public.stock_lots (id),
  qty integer not null,
  revenue_usd_minor bigint not null,
  revenue_eur_minor bigint not null,
  cost_usd_minor bigint not null,
  cost_eur_minor bigint not null
);
create index on restricted.sale_facts (tenant_id, released_on);
create trigger sale_facts_append_only before update or delete on restricted.sale_facts for each row execute function private.forbid_change();

-- ------------------------------------------------------------------ purchasing
/*
  p_lines: [{ "product_id": uuid, "qty": int, "unit_price_minor": int }]  (invoice currency)
*/
create function public.create_shipment(
  p_ref text, p_supplier text, p_origin text, p_ordered_on date, p_eta date, p_invoice_currency text,
  p_usd_per_eur_ppm bigint, p_commission_bps integer, p_lines jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  t uuid := private.require('owner');
  s public.tenant_settings := private.settings(t);
  v_id uuid; l jsonb; line_id uuid;
begin
  if p_invoice_currency = 'EUR' and coalesce(p_usd_per_eur_ppm, 0) <= 0 then raise exception 'Give the dollar rate paid for euros.'; end if;
  insert into public.shipments (tenant_id, ref, supplier, origin, status, ordered_on, eta)
  values (t, p_ref, p_supplier, p_origin, 'ordered', p_ordered_on, p_eta) returning id into v_id;
  insert into restricted.shipment_finance (shipment_id, tenant_id, invoice_currency, usd_per_eur_ppm, commission_bps, uplift_bps, eur_per_usd_ppm)
  values (v_id, t, p_invoice_currency, p_usd_per_eur_ppm, coalesce(p_commission_bps, 0), s.landed_uplift_bps, private.ref_rate(t, 'EUR', p_ordered_on));
  for l in select e.value from jsonb_array_elements(p_lines) e loop
    insert into public.shipment_lines (tenant_id, shipment_id, product_id, qty)
    values (t, v_id, (l ->> 'product_id')::uuid, (l ->> 'qty')::int) returning id into line_id;
    insert into restricted.shipment_line_costs (line_id, tenant_id, unit_price_minor) values (line_id, t, (l ->> 'unit_price_minor')::bigint);
  end loop;
  return v_id;
end $$;

create function public.set_shipment_status(p_shipment uuid, p_status text, p_day date) returns void
language plpgsql security definer set search_path = public as $$
declare t uuid := private.require('owner', 'warehouse');
begin
  if p_status not in ('in_transit', 'arrived') then raise exception 'Use receive_shipment to put goods into stock.'; end if;
  update public.shipments set status = p_status, arrived_on = case when p_status = 'arrived' then p_day else arrived_on end
  where id = p_shipment and tenant_id = t and status <> 'received';
  if not found then raise exception 'Shipment not found or already received.'; end if;
end $$;

-- A cost in any currency, converted to dollars at the rate of the day it was paid.
create function public.add_shipment_cost(
  p_shipment uuid, p_kind text, p_amount_minor bigint, p_currency text, p_incurred_on date, p_note text default null,
  p_rate_ppm bigint default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare t uuid := private.require('owner'); usd bigint; ppm bigint; v_id uuid;
begin
  if exists (select 1 from public.shipments where id = p_shipment and tenant_id = t and costs_final) then
    raise exception 'Landed cost is final for this shipment.';
  end if;
  ppm := case when p_currency = 'USD' then 1000000 else coalesce(p_rate_ppm, private.ref_rate(t, p_currency, p_incurred_on)) end;
  if ppm is null then raise exception 'No % rate for %.', p_currency, p_incurred_on; end if;
  usd := round(p_amount_minor::numeric * 1000000 / ppm);
  insert into restricted.shipment_costs (tenant_id, shipment_id, kind, amount_minor, currency, usd_minor, rate_note, incurred_on, note)
  values (t, p_shipment, p_kind, p_amount_minor, p_currency, usd,
    case when p_currency = 'USD' then null else format('%s %s per USD', trim(to_char(ppm / 1000000.0, 'FM999,999,990.0000')), p_currency) end,
    p_incurred_on, p_note)
  returning id into v_id;
  return v_id;
end $$;

/*
  Landed cost. For each line: invoice price x qty, converted to dollars (euros at the rate paid,
  plus the bank's commission). Indirect costs are summed, raised by the safety uplift, and spread
  pro rata to purchase value with a cumulative split so the shares add up to the cent.
*/
create function public.finalise_landed_cost(p_shipment uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  t uuid := private.require('owner');
  f restricted.shipment_finance;
  purchase bigint; indirect bigint; uplifted bigint; cum bigint := 0; prev bigint := 0; share bigint;
  l record;
begin
  select * into f from restricted.shipment_finance where shipment_id = p_shipment and tenant_id = t for update;
  if f.shipment_id is null then raise exception 'Shipment not found.'; end if;
  if exists (select 1 from public.shipments where id = p_shipment and costs_final) then raise exception 'Already final.'; end if;

  update restricted.shipment_line_costs c set purchase_usd_minor = case f.invoice_currency
      when 'USD' then c.unit_price_minor * sl.qty
      else round(c.unit_price_minor::numeric * sl.qty * f.usd_per_eur_ppm / 1000000 * (10000 + f.commission_bps) / 10000) end
  from public.shipment_lines sl where sl.id = c.line_id and sl.shipment_id = p_shipment;

  select sum(c.purchase_usd_minor) into purchase
  from restricted.shipment_line_costs c join public.shipment_lines sl on sl.id = c.line_id where sl.shipment_id = p_shipment;
  select coalesce(sum(usd_minor), 0) into indirect from restricted.shipment_costs where shipment_id = p_shipment;
  uplifted := round(indirect::numeric * (10000 + f.uplift_bps) / 10000);

  for l in
    select c.line_id, c.purchase_usd_minor, sl.qty from restricted.shipment_line_costs c
    join public.shipment_lines sl on sl.id = c.line_id where sl.shipment_id = p_shipment order by sl.id
  loop
    cum := cum + l.purchase_usd_minor;
    share := floor(uplifted::numeric * cum / purchase) - prev;
    prev := prev + share;
    update restricted.shipment_line_costs set indirect_share_usd_minor = share, landed_usd_minor = l.purchase_usd_minor + share,
      landed_unit_usd_minor = round((l.purchase_usd_minor + share)::numeric / l.qty)
    where line_id = l.line_id;
  end loop;

  update restricted.shipment_finance set purchase_usd_minor = purchase, indirect_usd_minor = indirect, uplifted_indirect_usd_minor = uplifted,
    finalised_at = private.now() where shipment_id = p_shipment;
  update public.shipments set costs_final = true where id = p_shipment;
  return jsonb_build_object('purchase_usd_minor', purchase, 'indirect_usd_minor', indirect, 'uplifted_indirect_usd_minor', uplifted);
end $$;

-- The warehouse puts an arrived shipment into stock once its landed cost is final, so that every
-- unit that can be sold already has a cost.
create function public.receive_shipment(p_shipment uuid, p_day date) returns void
language plpgsql security definer set search_path = public as $$
declare t uuid := private.require('owner', 'warehouse'); sh public.shipments; l record; lot uuid;
begin
  select * into sh from public.shipments where id = p_shipment and tenant_id = t for update;
  if sh.id is null then raise exception 'Shipment not found.'; end if;
  if sh.status = 'received' then raise exception 'Already in stock.'; end if;
  if not sh.costs_final then raise exception 'The owner has not finalised the landed cost of % yet.', sh.ref using hint = 'costs_not_final'; end if;
  for l in select * from public.shipment_lines where shipment_id = p_shipment loop
    insert into public.stock_lots (tenant_id, product_id, shipment_line_id, qty_in, received_on)
    values (t, l.product_id, l.id, l.qty, p_day) returning id into lot;
    insert into public.stock_movements (tenant_id, product_id, lot_id, qty, kind, shipment_id, created_by, created_at)
    values (t, l.product_id, lot, l.qty, 'receive', p_shipment, auth.uid(), private.now());
  end loop;
  update public.shipments set status = 'received', received_on = p_day, arrived_on = coalesce(arrived_on, p_day) where id = p_shipment;
end $$;

-- Counting differences such as breakage or loss. Takes from the oldest lots.
create function public.adjust_stock(p_product uuid, p_qty integer, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare t uuid := private.require('owner', 'warehouse'); left_qty integer := -p_qty; lot record; take integer;
begin
  if p_qty = 0 or coalesce(trim(p_note), '') = '' then raise exception 'Give a quantity and a reason.'; end if;
  if p_qty > 0 then
    -- Every unit in stock has a landed cost; stock only comes in through a shipment.
    raise exception 'Stock only comes in through a shipment, so every unit has a cost. Record it there.';
  end if;
  for lot in select * from public.stock_lots where tenant_id = t and product_id = p_product and qty_out < qty_in order by received_on, id for update loop
    exit when left_qty = 0;
    take := least(left_qty, lot.qty_in - lot.qty_out);
    update public.stock_lots set qty_out = qty_out + take where id = lot.id;
    insert into public.stock_movements (tenant_id, product_id, lot_id, qty, kind, note, created_by, created_at)
    values (t, p_product, lot.id, -take, 'adjust', p_note, auth.uid(), private.now());
    left_qty := left_qty - take;
  end loop;
  if left_qty > 0 then raise exception 'Only % in stock.', -p_qty - left_qty; end if;
end $$;

-- ------------------------------------------------------------------ release (step 5)
/*
  Only a confirmed, fully paid order leaves the warehouse. Each line takes from the oldest lots
  first. Revenue, cost and their euro values are split per lot with cumulative splits, so the
  facts of an order add up exactly to the order.
*/
create function public.release_order(p_order uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  t uuid := private.require('owner', 'warehouse');
  o public.orders;
  l record; lot record; lc restricted.shipment_line_costs; sf restricted.shipment_finance;
  need integer; take integer; done integer;
  rev_prev bigint; rev_eur_prev bigint; cost_part bigint; order_cum bigint := 0; order_eur_prev bigint := 0;
  rev bigint; rev_eur bigint; cost_eur bigint; day date := private.today();
begin
  select * into o from public.orders where id = p_order and tenant_id = t for update;
  if o.id is null or o.kind <> 'order' then raise exception 'Order not found.'; end if;
  if o.status <> 'confirmed' then raise exception 'Order % is %.', o.number, o.status; end if;
  if o.released_at is not null then raise exception 'Order % has already left the warehouse.', o.number; end if;
  if o.payment_status <> 'paid' then
    raise exception 'Order % is not fully paid. Goods can only be released against a fully paid order.', o.number using hint = 'not_paid';
  end if;

  for l in select * from public.order_lines where order_id = p_order order by line_no loop
    need := l.qty; done := 0; rev_prev := 0; rev_eur_prev := 0;
    for lot in
      select * from public.stock_lots where tenant_id = t and product_id = l.product_id and qty_out < qty_in
      order by received_on, id for update
    loop
      exit when need = 0;
      take := least(need, lot.qty_in - lot.qty_out);
      select c.* into lc from restricted.shipment_line_costs c where c.line_id = lot.shipment_line_id;
      select f.* into sf from restricted.shipment_finance f join public.shipment_lines sl on sl.shipment_id = f.shipment_id where sl.id = lot.shipment_line_id;
      -- cost of `take` units from this lot: units already sold from the lot are qty_out
      cost_part := floor(lc.landed_usd_minor::numeric * (lot.qty_out + take) / lot.qty_in) - floor(lc.landed_usd_minor::numeric * lot.qty_out / lot.qty_in);
      cost_eur := round(cost_part::numeric * sf.eur_per_usd_ppm / 1000000);
      -- revenue of `take` units of this line, and its euro value split over the whole order
      rev := floor(l.total_usd_minor::numeric * (done + take) / l.qty) - rev_prev;
      rev_prev := rev_prev + rev;
      order_cum := order_cum + rev;
      rev_eur := coalesce(floor(o.total_eur_minor::numeric * order_cum / nullif(o.total_usd_minor, 0)), 0) - order_eur_prev;
      order_eur_prev := order_eur_prev + rev_eur;
      update public.stock_lots set qty_out = qty_out + take where id = lot.id;
      insert into public.stock_movements (tenant_id, product_id, lot_id, qty, kind, order_id, created_by, created_at)
      values (t, l.product_id, lot.id, -take, 'release', p_order, auth.uid(), private.now());
      insert into restricted.sale_facts (tenant_id, released_on, order_id, line_no, product_id, customer_id, adviser_id, shipment_id, lot_id, qty,
        revenue_usd_minor, revenue_eur_minor, cost_usd_minor, cost_eur_minor)
      select t, day, p_order, l.line_no, l.product_id, o.customer_id, o.adviser_id, sl.shipment_id, lot.id, take, rev, rev_eur, cost_part, cost_eur
      from public.shipment_lines sl where sl.id = lot.shipment_line_id;
      need := need - take; done := done + take;
    end loop;
    if need > 0 then
      raise exception 'Not enough %: % short.', (select name from public.products where id = l.product_id), need using hint = 'short';
    end if;
  end loop;
  update public.orders set released_at = private.now(), released_by = auth.uid() where id = p_order;
end $$;

-- ---------------------------------------------------------------- 20260922000600_reporting.sql
-- Step 7 · Margin, profit and closing checks (Finance). Owner only.
--
-- Reports only ever add up stored integers: restricted.sale_facts (revenue and cost, fixed at
-- release), restricted.fx_facts (currency result, fixed at payout or conversion) and ledger
-- lines (expenses and refunds, fixed when recorded). No rate is looked up while reporting, so a
-- report on a closed period gives the same numbers today, next week and in six months.
--
-- Dates: gross profit counts on the release date, the currency result on the payout date, and
-- expenses and refunds on the date they were paid.
--
-- Results that can't be tied to a row of the chosen dimension (rent is not per product) appear
-- on one "not assigned" row, so every dimension adds up to the same total as the month view.

create function public.profit_report(p_from date, p_to date, p_by text) returns jsonb
language plpgsql stable security definer set search_path = public, restricted as $$
declare t uuid := private.require('owner'); result jsonb;
begin
  if p_by not in ('product', 'order', 'customer', 'adviser', 'shipment', 'month', 'route') then raise exception 'Unknown grouping.'; end if;
  with
  sales as (
    select case p_by
        when 'product' then sf.product_id::text when 'order' then sf.order_id::text when 'customer' then sf.customer_id::text
        when 'adviser' then sf.adviser_id::text when 'shipment' then sf.shipment_id::text when 'month' then to_char(sf.released_on, 'YYYY-MM')
        else '~sales' end as key,
      sf.qty, sf.revenue_usd_minor as rev_usd, sf.revenue_eur_minor as rev_eur, sf.cost_usd_minor as cost_usd, sf.cost_eur_minor as cost_eur
    from sale_facts sf where sf.tenant_id = t and sf.released_on between p_from and p_to and p_by <> 'route'
  ),
  spend as (
    select case
        when p_by = 'month' then to_char(le.occurred_on, 'YYYY-MM')
        when p_by in ('order', 'customer', 'adviser') and le.order_id is not null then
          case p_by when 'order' then o.id::text when 'customer' then o.customer_id::text else o.adviser_id::text end
        when p_by = 'shipment' and le.shipment_id is not null then le.shipment_id::text
        else '~unassigned' end as key,
      le.usd_minor as usd, le.eur_minor as eur
    from ledger_entries le left join orders o on o.id = le.order_id
    where le.tenant_id = t and le.kind in ('expense', 'refund') and le.occurred_on between p_from and p_to and p_by <> 'route'
  ),
  fx as (
    select f.*, f.realized_usd_minor - f.booked_usd_minor as res_usd, f.realized_eur_minor - f.booked_eur_minor as res_eur
    from fx_facts f where f.tenant_id = t and f.occurred_on between p_from and p_to
  ),
  -- The currency result of an order, spread over its lines (for products) by line total.
  fx_lines as (
    select fx.id, l.product_id,
      floor(fx.res_usd::numeric * sum(l.total_usd_minor) over w / sum(l.total_usd_minor) over (partition by fx.id))
        - floor(fx.res_usd::numeric * (sum(l.total_usd_minor) over w - l.total_usd_minor) / sum(l.total_usd_minor) over (partition by fx.id)) as usd,
      floor(fx.res_eur::numeric * sum(l.total_usd_minor) over w / sum(l.total_usd_minor) over (partition by fx.id))
        - floor(fx.res_eur::numeric * (sum(l.total_usd_minor) over w - l.total_usd_minor) / sum(l.total_usd_minor) over (partition by fx.id)) as eur
    from fx join order_lines l on l.order_id = fx.order_id
    where p_by = 'product' and l.total_usd_minor > 0
    window w as (partition by fx.id order by l.line_no)
  ),
  -- ...and over the shipments its goods came from, if they had left the warehouse by the payout.
  fx_ships as (
    select fx.id, x.shipment_id,
      floor(fx.res_usd::numeric * sum(x.rev) over w / sum(x.rev) over (partition by fx.id))
        - floor(fx.res_usd::numeric * (sum(x.rev) over w - x.rev) / sum(x.rev) over (partition by fx.id)) as usd,
      floor(fx.res_eur::numeric * sum(x.rev) over w / sum(x.rev) over (partition by fx.id))
        - floor(fx.res_eur::numeric * (sum(x.rev) over w - x.rev) / sum(x.rev) over (partition by fx.id)) as eur
    from fx
    join (select order_id, shipment_id, min(released_on) as released_on, sum(revenue_usd_minor) as rev
          from sale_facts where tenant_id = t group by order_id, shipment_id) x on x.order_id = fx.order_id and x.released_on <= fx.occurred_on
    where p_by = 'shipment' and x.rev > 0
    window w as (partition by fx.id order by x.shipment_id)
  ),
  fxk as (
    select case p_by
        when 'order' then coalesce(fx.order_id::text, '~unassigned') when 'customer' then coalesce(fx.customer_id::text, '~unassigned')
        when 'adviser' then coalesce(fx.adviser_id::text, '~unassigned') when 'month' then to_char(fx.occurred_on, 'YYYY-MM')
        when 'route' then fx.route end as key, fx.res_usd as usd, fx.res_eur as eur
    from fx where p_by in ('order', 'customer', 'adviser', 'month', 'route')
    union all select fl.product_id::text, fl.usd, fl.eur from fx_lines fl
    union all select '~unassigned', fx.res_usd, fx.res_eur from fx where p_by = 'product' and fx.order_id is null
    union all select fs.shipment_id::text, fs.usd, fs.eur from fx_ships fs
    union all select case when fx.order_id is null then '~unassigned' else '~unreleased' end, fx.res_usd, fx.res_eur from fx
      where p_by = 'shipment' and not exists (select 1 from fx_ships fs where fs.id = fx.id)
  ),
  keys as (select key from sales union select key from spend union select key from fxk),
  agg as (
    select k.key,
      coalesce((select sum(qty) from sales s where s.key = k.key), 0)::bigint as units,
      coalesce((select sum(rev_usd) from sales s where s.key = k.key), 0)::bigint as revenue_usd,
      coalesce((select sum(rev_eur) from sales s where s.key = k.key), 0)::bigint as revenue_eur,
      coalesce((select sum(cost_usd) from sales s where s.key = k.key), 0)::bigint as cost_usd,
      coalesce((select sum(cost_eur) from sales s where s.key = k.key), 0)::bigint as cost_eur,
      coalesce((select sum(usd) from spend s where s.key = k.key), 0)::bigint as expenses_usd,
      coalesce((select sum(eur) from spend s where s.key = k.key), 0)::bigint as expenses_eur,
      coalesce((select sum(usd) from fxk f where f.key = k.key), 0)::bigint as fx_usd,
      coalesce((select sum(eur) from fxk f where f.key = k.key), 0)::bigint as fx_eur
    from keys k
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'key', a.key,
      'label', case
        when a.key = '~unassigned' then 'Not assigned'
        when a.key = '~unreleased' then 'Paid out before release'
        when p_by = 'product' then (select name from products where id::text = a.key)
        when p_by = 'order' then (select number || ' · ' || c.name from orders o join customers c on c.id = o.customer_id where o.id::text = a.key)
        when p_by = 'customer' then (select name from customers where id::text = a.key)
        when p_by = 'adviser' then (select full_name from profiles where id::text = a.key)
        when p_by = 'shipment' then (select ref || ' · ' || supplier from shipments where id::text = a.key)
        else a.key end,
      'units', a.units,
      'revenue_usd', a.revenue_usd, 'revenue_eur', a.revenue_eur,
      'cost_usd', a.cost_usd, 'cost_eur', a.cost_eur,
      'gross_usd', a.revenue_usd - a.cost_usd, 'gross_eur', a.revenue_eur - a.cost_eur,
      'expenses_usd', a.expenses_usd, 'expenses_eur', a.expenses_eur,
      'net_before_usd', a.revenue_usd - a.cost_usd - a.expenses_usd, 'net_before_eur', a.revenue_eur - a.cost_eur - a.expenses_eur,
      'fx_usd', a.fx_usd, 'fx_eur', a.fx_eur,
      'net_after_usd', a.revenue_usd - a.cost_usd - a.expenses_usd + a.fx_usd,
      'net_after_eur', a.revenue_eur - a.cost_eur - a.expenses_eur + a.fx_eur)
    order by case when a.key like '~%' then 1 else 0 end, a.revenue_usd desc, a.key), '[]')
  into result from agg a;
  return result;
end $$;

-- ------------------------------------------------------------------ balances
create function private.balance(p_account uuid, p_as_of date default null) returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce((select sum(to_amount_minor) from public.ledger_entries where to_account_id = p_account and (p_as_of is null or occurred_on <= p_as_of)), 0)::bigint
       - coalesce((select sum(from_amount_minor) from public.ledger_entries where from_account_id = p_account and (p_as_of is null or occurred_on <= p_as_of)), 0)::bigint
$$;

-- Owner: every account with its live balance, today's intake against its limit, and the last
-- statement next to the ledger balance on that date.
create function public.accounts_overview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t uuid := private.require('owner'); d date := private.today();
begin
  return (select coalesce(jsonb_agg(x order by x ->> 'sort', x ->> 'name'), '[]') from (
    select jsonb_build_object(
      'id', a.id, 'name', a.name, 'kind', a.kind, 'kind_label', k.label, 'bank', a.bank, 'number_masked', a.number_masked,
      'currency', a.currency, 'holder', h.display_name, 'holder_id', h.id, 'route', a.route_label, 'pass_through', k.pass_through,
      'external', k.is_external, 'sort', lpad(k.sort::text, 3, '0'),
      'balance_minor', private.balance(a.id),
      'daily_limit_minor', a.daily_limit_minor,
      'intake_today_minor', case when k.receives_customer_payments then private.intake(a.id, d) end,
      'statement', (select jsonb_build_object('as_of', st.as_of, 'balance_minor', st.balance_minor, 'ledger_minor', private.balance(a.id, st.as_of))
                    from public.account_statements st where st.account_id = a.id order by st.as_of desc limit 1),
      'unconfirmed_minor', (select coalesce(sum(r.amount_sdg_minor), 0) from public.receipts r where r.to_account_id = a.id and r.status <> 'confirmed')
    ) as x
    from public.accounts a join public.account_kinds k on k.tenant_id = a.tenant_id and k.code = a.kind
    left join public.account_holders h on h.id = a.holder_id
    where a.tenant_id = t and a.active) s);
end $$;

-- Owner and advisers: where a customer can pay today, and how much room each account has left.
create function public.accounts_today() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t uuid := private.require('owner', 'adviser'); d date := private.today(); s public.tenant_settings := private.settings(t);
begin
  return jsonb_build_object('max_transfer_minor', s.max_transfer_sdg_minor, 'today', d, 'accounts', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', a.id, 'name', a.name, 'kind', a.kind, 'bank', a.bank, 'number_masked', a.number_masked, 'holder', h.display_name,
      'daily_limit_minor', a.daily_limit_minor, 'intake_today_minor', private.intake(a.id, d),
      'remaining_minor', greatest(coalesce(a.daily_limit_minor, s.default_daily_limit_sdg_minor) - private.intake(a.id, d), 0))
      order by h.display_name, a.name), '[]')
    from public.accounts a join public.account_kinds k on k.tenant_id = a.tenant_id and k.code = a.kind
    left join public.account_holders h on h.id = a.holder_id
    where a.tenant_id = t and a.active and k.receives_customer_payments and a.currency = 'SDG'));
end $$;

create function public.ledger_lines(p_account uuid default null, p_limit integer default 200) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t uuid := private.require('owner');
begin
  return (select coalesce(jsonb_agg(x), '[]') from (
    select jsonb_build_object('id', le.id, 'occurred_on', le.occurred_on, 'kind', le.kind, 'memo', le.memo, 'category', le.category,
      'from_account', fa.name, 'from_amount_minor', le.from_amount_minor, 'from_currency', le.from_currency,
      'to_account', ta.name, 'to_amount_minor', le.to_amount_minor, 'to_currency', le.to_currency,
      'usd_minor', le.usd_minor, 'eur_minor', le.eur_minor) as x
    from public.ledger_entries le join public.accounts fa on fa.id = le.from_account_id join public.accounts ta on ta.id = le.to_account_id
    where le.tenant_id = t and (p_account is null or p_account in (le.from_account_id, le.to_account_id))
    order by le.occurred_on desc, le.created_at desc limit p_limit) s);
end $$;

-- ------------------------------------------------------------------ closing checks
-- Each check proves one thing about the books. A failed check lists what's wrong; nothing is
-- smoothed over.
create function public.closing_checks() returns jsonb
language plpgsql stable security definer set search_path = public, restricted as $$
declare t uuid := private.require('owner'); s public.tenant_settings := private.settings(t); out jsonb := '[]'; items jsonb;
begin
  -- 1. Pass-through accounts net to zero
  select coalesce(jsonb_agg(jsonb_build_object('label', a.name, 'value', private.balance(a.id), 'currency', a.currency)), '[]') into items
  from accounts a join account_kinds k on k.tenant_id = a.tenant_id and k.code = a.kind
  where a.tenant_id = t and k.pass_through and private.balance(a.id) <> 0;
  out := out || jsonb_build_object('code', 'pass_through_zero', 'status', case when jsonb_array_length(items) = 0 then 'ok' else 'fail' end, 'items', items);

  -- 2. Ledger balance equals the last actual balance entered for each account
  select coalesce(jsonb_agg(jsonb_build_object('label', a.name, 'as_of', st.as_of, 'actual', st.balance_minor, 'ledger', private.balance(a.id, st.as_of),
    'value', st.balance_minor - private.balance(a.id, st.as_of), 'currency', a.currency)), '[]') into items
  from accounts a join lateral (select * from account_statements st where st.account_id = a.id order by as_of desc limit 1) st on true
  where a.tenant_id = t and st.balance_minor <> private.balance(a.id, st.as_of);
  out := out || jsonb_build_object('code', 'statements_match', 'status', case when jsonb_array_length(items) = 0 then 'ok' else 'fail' end, 'items', items);

  -- 3. Receipts not yet forwarded to the exchanger after the alert window
  select coalesce(jsonb_agg(jsonb_build_object('label', r.number || ' · ' || r.txn_code, 'value', r.amount_sdg_minor, 'currency', 'SDG',
    'since', r.recorded_at) order by r.recorded_at), '[]') into items
  from receipts r where r.tenant_id = t and r.status = 'received' and r.recorded_at < private.now() - make_interval(hours => s.forward_alert_hours);
  out := out || jsonb_build_object('code', 'forwarded', 'status', case when jsonb_array_length(items) = 0 then 'ok' else 'warn' end, 'items', items);

  -- 4. Same code, different amount: unresolved
  select coalesce(jsonb_agg(jsonb_build_object('label', c.txn_code, 'value', c.attempted_amount_sdg_minor, 'currency', 'SDG')), '[]') into items
  from receipt_conflicts c where c.tenant_id = t and c.resolved_at is null;
  out := out || jsonb_build_object('code', 'conflicts', 'status', case when jsonb_array_length(items) = 0 then 'ok' else 'fail' end, 'items', items);

  -- 5. Receipts not fully matched to orders
  select coalesce(jsonb_agg(jsonb_build_object('label', r.number || ' · ' || c.name, 'value', r.amount_sdg_minor - r.allocated_sdg_minor, 'currency', 'SDG')), '[]') into items
  from receipts r join customers c on c.id = r.customer_id where r.tenant_id = t and r.allocated_sdg_minor < r.amount_sdg_minor;
  out := out || jsonb_build_object('code', 'unmatched', 'status', case when jsonb_array_length(items) = 0 then 'ok' else 'warn' end, 'items', items);

  -- 6. Paid on each order = sum of its allocations; allocated on each receipt = sum of its allocations
  select coalesce(jsonb_agg(jsonb_build_object('label', x.label)), '[]') into items from (
    select o.number as label from orders o where o.tenant_id = t
      and o.paid_sdg_minor <> coalesce((select sum(sdg_minor) from receipt_allocations a where a.order_id = o.id), 0)
    union all
    select r.number from receipts r where r.tenant_id = t
      and r.allocated_sdg_minor <> coalesce((select sum(sdg_minor) from receipt_allocations a where a.receipt_id = r.id), 0)) x;
  out := out || jsonb_build_object('code', 'allocations_add_up', 'status', case when jsonb_array_length(items) = 0 then 'ok' else 'fail' end, 'items', items);

  -- 7. A fully paid order's slices add up to its dollar and euro totals exactly
  select coalesce(jsonb_agg(jsonb_build_object('label', o.number)), '[]') into items
  from orders o where o.tenant_id = t and o.payment_status = 'paid' and (
    o.total_usd_minor <> (select sum(booked_usd_minor) from receipt_allocations a where a.order_id = o.id) or
    o.total_eur_minor <> (select sum(booked_eur_minor) from receipt_allocations a where a.order_id = o.id));
  out := out || jsonb_build_object('code', 'booked_add_up', 'status', case when jsonb_array_length(items) = 0 then 'ok' else 'fail' end, 'items', items);

  -- 8. Every released order has sale facts that add up to it, in units, dollars and euros
  select coalesce(jsonb_agg(jsonb_build_object('label', o.number)), '[]') into items
  from orders o where o.tenant_id = t and o.released_at is not null and (
    o.total_usd_minor <> coalesce((select sum(revenue_usd_minor) from sale_facts f where f.order_id = o.id), 0) or
    o.total_eur_minor <> coalesce((select sum(revenue_eur_minor) from sale_facts f where f.order_id = o.id), 0) or
    (select sum(qty) from order_lines l where l.order_id = o.id) <> coalesce((select sum(qty) from sale_facts f where f.order_id = o.id), 0));
  out := out || jsonb_build_object('code', 'released_add_up', 'status', case when jsonb_array_length(items) = 0 then 'ok' else 'fail' end, 'items', items);

  -- 9. Stock: each lot's balance equals its movements, and nothing released unpaid
  select coalesce(jsonb_agg(jsonb_build_object('label', p.name)), '[]') into items
  from stock_lots l join products p on p.id = l.product_id where l.tenant_id = t
    and l.qty_in - l.qty_out <> (select sum(qty) from stock_movements m where m.lot_id = l.id);
  out := out || jsonb_build_object('code', 'stock_add_up', 'status', case when jsonb_array_length(items) = 0 then 'ok' else 'fail' end, 'items', items);

  select coalesce(jsonb_agg(jsonb_build_object('label', o.number)), '[]') into items
  from orders o where o.tenant_id = t and o.released_at is not null and o.payment_status <> 'paid';
  out := out || jsonb_build_object('code', 'released_paid', 'status', case when jsonb_array_length(items) = 0 then 'ok' else 'fail' end, 'items', items);

  -- 10. Landed cost: every finalised shipment's line costs add up to purchase plus uplifted costs
  select coalesce(jsonb_agg(jsonb_build_object('label', sh.ref)), '[]') into items
  from shipments sh join shipment_finance f on f.shipment_id = sh.id where sh.tenant_id = t and sh.costs_final
    and f.purchase_usd_minor + f.uplifted_indirect_usd_minor <> (select sum(c.landed_usd_minor) from shipment_line_costs c join shipment_lines l on l.id = c.line_id where l.shipment_id = sh.id);
  out := out || jsonb_build_object('code', 'landed_add_up', 'status', case when jsonb_array_length(items) = 0 then 'ok' else 'fail' end, 'items', items);

  -- 11. Receipts over an account's daily limit
  select coalesce(jsonb_agg(jsonb_build_object('label', r.number || ' · ' || a.name, 'value', r.amount_sdg_minor, 'currency', 'SDG', 'on', r.received_on)), '[]') into items
  from receipts r join accounts a on a.id = r.to_account_id where r.tenant_id = t and 'over_daily_limit' = any (r.flags);
  out := out || jsonb_build_object('code', 'daily_limits', 'status', case when jsonb_array_length(items) = 0 then 'ok' else 'warn' end, 'items', items);

  return out;
end $$;

-- ------------------------------------------------------------------ shipment dossier (owner)
create function public.shipment_dossier(p_shipment uuid) returns jsonb
language plpgsql stable security definer set search_path = public, restricted as $$
declare t uuid := private.require('owner');
begin
  return (select to_jsonb(sh) || jsonb_build_object(
    'finance', (select to_jsonb(f) from shipment_finance f where f.shipment_id = sh.id),
    'costs', (select coalesce(jsonb_agg(to_jsonb(c) order by c.incurred_on, c.kind), '[]') from shipment_costs c where c.shipment_id = sh.id),
    'lines', (select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'product', p.name, 'sku', p.sku, 'qty', l.qty) || to_jsonb(c) order by c.purchase_usd_minor desc nulls last, p.name), '[]')
              from shipment_lines l join products p on p.id = l.product_id join shipment_line_costs c on c.line_id = l.id where l.shipment_id = sh.id))
    from shipments sh where sh.id = p_shipment and sh.tenant_id = t);
end $$;

-- ---------------------------------------------------------------- 20260922000700_policies.sql
-- Permissions, in the database. Read access is row level security; write access is only through
-- the functions above, each of which checks the caller's role.
--
--   owner      everything
--   marketing  reads customers, orders and stock; edits customers. No cost prices, no margins,
--              no receipts or accounts.
--   adviser    her own customers, their orders and receipts; the accounts customers pay into.
--              No cost prices, no margins.
--   warehouse  products, shipments and stock quantities; paid orders to release through
--              pick_list(). No prices, no amounts, no customers' money.
--
-- Cost prices and margins live in the `restricted` schema. No API role has any privilege on it:
-- an adviser who queries it directly gets "permission denied", and RLS stays on as a second lock
-- should a grant ever be added by mistake.

-- ------------------------------------------------------------------ grants
-- Also for everything created by later migrations: new functions are not executable by PUBLIC,
-- new tables are readable (through RLS) by signed-in users only.
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public grant execute on functions to authenticated;
alter default privileges in schema public grant select on tables to authenticated;
alter default privileges in schema private revoke execute on functions from public;
alter default privileges in schema restricted revoke all on tables from public;

revoke all on all tables in schema public from anon, authenticated;
grant select on all tables in schema public to authenticated;
revoke all on all tables in schema restricted from anon, authenticated, public;
revoke all on schema restricted from anon, authenticated, public;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.tenant_id(), private.role(), private.has_role(public.app_role[]), private.now(), private.today() to authenticated;

-- ------------------------------------------------------------------ helpers for policies
create function private.sees_customer(p_customer uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.customers c
    where c.id = p_customer and c.tenant_id = private.tenant_id()
      and (private.has_role('owner', 'marketing') or (private.has_role('adviser') and c.adviser_id = auth.uid())))
$$;
grant execute on function private.sees_customer(uuid) to authenticated;

-- ------------------------------------------------------------------ policies
do $$
declare tbl text;
begin
  foreach tbl in array array[
    'tenants', 'tenant_settings', 'settings_history', 'profiles', 'memberships', 'account_kinds', 'account_holders', 'holder_aliases',
    'accounts', 'reference_rates', 'counters', 'products', 'product_prices', 'price_history', 'customers', 'customer_contacts', 'labels',
    'customer_labels', 'messages', 'discount_approvals', 'orders', 'order_lines', 'receipts', 'receipt_conflicts', 'receipt_allocations',
    'ledger_entries', 'account_statements', 'shipments', 'shipment_lines', 'stock_lots', 'stock_movements']
  loop
    execute format('alter table public.%I enable row level security', tbl);
  end loop;
  foreach tbl in array array['fx_facts', 'shipment_finance', 'shipment_line_costs', 'shipment_costs', 'sale_facts'] loop
    execute format('alter table restricted.%I enable row level security', tbl);
    execute format('create policy owner_only on restricted.%I for select using (tenant_id = (select private.tenant_id()) and (select private.has_role(''owner'')))', tbl);
  end loop;
end $$;

-- The security definer functions run as the table owner (the migration role, which bypasses RLS
-- on Supabase), so they see every row and do their own tenant and role checks.

create policy member_read on public.tenants for select to authenticated using (id = (select private.tenant_id()));
create policy member_read on public.tenant_settings for select to authenticated using (tenant_id = (select private.tenant_id()));
create policy owner_read on public.settings_history for select to authenticated using (tenant_id = (select private.tenant_id()) and (select private.has_role('owner')));
create policy colleague_read on public.profiles for select to authenticated
  using (exists (select 1 from public.memberships m where m.user_id = profiles.id and m.tenant_id = (select private.tenant_id())));
create policy member_read on public.memberships for select to authenticated using (tenant_id = (select private.tenant_id()));
create policy member_read on public.account_kinds for select to authenticated using (tenant_id = (select private.tenant_id()));

create policy money_read on public.account_holders for select to authenticated
  using (tenant_id = (select private.tenant_id()) and (select private.has_role('owner', 'adviser')));
create policy money_read on public.holder_aliases for select to authenticated
  using (tenant_id = (select private.tenant_id()) and (select private.has_role('owner', 'adviser')));
create policy money_read on public.accounts for select to authenticated
  using (tenant_id = (select private.tenant_id()) and (select private.has_role('owner', 'adviser')));
create policy money_read on public.reference_rates for select to authenticated
  using (tenant_id = (select private.tenant_id()) and (select private.has_role('owner', 'marketing', 'adviser')));
-- counters: no policy for API roles, so no rows.

create policy member_read on public.products for select to authenticated using (tenant_id = (select private.tenant_id()));
create policy price_read on public.product_prices for select to authenticated
  using (tenant_id = (select private.tenant_id()) and (select private.has_role('owner', 'marketing', 'adviser')));
create policy owner_read on public.price_history for select to authenticated using (tenant_id = (select private.tenant_id()) and (select private.has_role('owner')));

create policy customer_read on public.customers for select to authenticated
  using (tenant_id = (select private.tenant_id())
    and ((select private.has_role('owner', 'marketing')) or ((select private.has_role('adviser')) and adviser_id = (select auth.uid()))));
create policy customer_read on public.customer_contacts for select to authenticated using (private.sees_customer(customer_id));
create policy customer_read on public.customer_labels for select to authenticated using (private.sees_customer(customer_id));
create policy customer_read on public.messages for select to authenticated using (private.sees_customer(customer_id));
create policy crm_read on public.labels for select to authenticated
  using (tenant_id = (select private.tenant_id()) and (select private.has_role('owner', 'marketing', 'adviser')));

create policy approval_read on public.discount_approvals for select to authenticated
  using (tenant_id = (select private.tenant_id()) and ((select private.has_role('owner')) or requested_by = (select auth.uid())));
create policy order_read on public.orders for select to authenticated
  using (tenant_id = (select private.tenant_id())
    and ((select private.has_role('owner', 'marketing')) or ((select private.has_role('adviser')) and adviser_id = (select auth.uid()))));
create policy order_read on public.order_lines for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_lines.order_id));

create policy receipt_read on public.receipts for select to authenticated
  using (tenant_id = (select private.tenant_id())
    and ((select private.has_role('owner')) or ((select private.has_role('adviser')) and private.sees_customer(customer_id))));
create policy receipt_read on public.receipt_conflicts for select to authenticated
  using (tenant_id = (select private.tenant_id()) and ((select private.has_role('owner')) or raised_by = (select auth.uid())));
create policy receipt_read on public.receipt_allocations for select to authenticated
  using (exists (select 1 from public.receipts r where r.id = receipt_allocations.receipt_id));

create policy owner_read on public.ledger_entries for select to authenticated using (tenant_id = (select private.tenant_id()) and (select private.has_role('owner')));
create policy owner_read on public.account_statements for select to authenticated using (tenant_id = (select private.tenant_id()) and (select private.has_role('owner')));

create policy member_read on public.shipments for select to authenticated using (tenant_id = (select private.tenant_id()));
create policy member_read on public.shipment_lines for select to authenticated using (tenant_id = (select private.tenant_id()));
create policy member_read on public.stock_lots for select to authenticated using (tenant_id = (select private.tenant_id()));
create policy member_read on public.stock_movements for select to authenticated using (tenant_id = (select private.tenant_id()));

-- ---------------------------------------------------------------- 20260922000800_reads.sql
-- Read functions for the screens. Where a function is `security invoker`, row level security
-- decides what comes back; where it is `security definer`, it checks the role itself and returns
-- only what that role may see (the warehouse's pick list has no amounts, for example).

create function public.me() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'user_id', p.id, 'full_name', p.full_name, 'email', p.email, 'role', m.role,
    'tenant', jsonb_build_object('id', t.id, 'name', t.name, 'slug', t.slug, 'kind', t.kind),
    'today', private.today(),
    'settings', jsonb_build_object(
      'brand_name', s.brand_name, 'brand_color', s.brand_color, 'brand_accent', s.brand_accent, 'logo_initials', s.logo_initials,
      'sand_max_bps', s.sand_max_bps, 'red_max_bps', s.red_max_bps, 'min_rate_sdg', s.min_rate_sdg,
      'max_transfer_sdg_minor', s.max_transfer_sdg_minor, 'quote_validity_days', s.quote_validity_days,
      'payment_terms', s.payment_terms, 'currencies', s.currencies, 'default_locale', s.default_locale,
      'price_currency', s.price_currency, 'payment_currency', s.payment_currency, 'report_currency', s.report_currency))
  from public.profiles p
  join public.memberships m on m.user_id = p.id and m.active
  join public.tenants t on t.id = m.tenant_id
  join public.tenant_settings s on s.tenant_id = t.id
  where p.id = auth.uid()
$$;

-- Products with stock. Prices only for roles that may see them.
create function public.catalogue() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t uuid := private.require('owner', 'marketing', 'adviser', 'warehouse'); priced boolean := private.has_role('owner', 'marketing', 'adviser');
begin
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id, 'sku', p.sku, 'name', p.name, 'category', p.category, 'brand', p.brand, 'spec', p.spec, 'min_stock', p.min_stock,
      'price_usd_minor', case when priced then pp.price_usd_minor end,
      'on_hand', coalesce(st.on_hand, 0), 'in_transit', coalesce(tr.qty, 0), 'committed', coalesce(cm.qty, 0))
      order by array_position(array['inverter','battery','panel','solar_ac','pump','bos'], p.category), pp.price_usd_minor desc nulls last), '[]')
    from public.products p
    left join public.product_prices pp on pp.product_id = p.id
    left join (select product_id, sum(qty_in - qty_out) as on_hand from public.stock_lots where tenant_id = t group by product_id) st on st.product_id = p.id
    left join (select l.product_id, sum(l.qty) as qty from public.shipment_lines l join public.shipments s on s.id = l.shipment_id
               where s.tenant_id = t and s.status in ('ordered', 'in_transit', 'arrived') group by l.product_id) tr on tr.product_id = p.id
    left join (select l.product_id, sum(l.qty) as qty from public.order_lines l join public.orders o on o.id = l.order_id
               where o.tenant_id = t and o.kind = 'order' and o.status = 'confirmed' and o.released_at is null group by l.product_id) cm on cm.product_id = p.id
    where p.tenant_id = t and p.active);
end $$;

create function public.customers_list(p_search text default null, p_segment text default null, p_label uuid default null, p_limit integer default 60, p_offset integer default 0)
returns jsonb
language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'total', (select count(*) from public.customers c where (p_search is null or c.name ilike '%' || p_search || '%' or c.city ilike '%' || p_search || '%' or c.code ilike '%' || p_search || '%')
                and (p_segment is null or c.segment = p_segment) and (p_label is null or exists (select 1 from public.customer_labels cl where cl.customer_id = c.id and cl.label_id = p_label))),
    'rows', coalesce((select jsonb_agg(x) from (
      select jsonb_build_object('id', c.id, 'code', c.code, 'name', c.name, 'city', c.city, 'kind', c.kind, 'segment', c.segment, 'pipeline', c.pipeline,
        'source', c.source, 'adviser', (select full_name from public.profiles where id = c.adviser_id),
        'phone', (select value from public.customer_contacts cc where cc.customer_id = c.id and cc.is_primary limit 1),
        'labels', (select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name, 'color', l.color)), '[]') from public.customer_labels cl join public.labels l on l.id = cl.label_id where cl.customer_id = c.id),
        'revenue_90d_usd_minor', (select coalesce(sum(o.total_usd_minor), 0) from public.orders o where o.customer_id = c.id and o.kind = 'order' and o.status = 'confirmed' and o.created_at >= private.today() - 90),
        'last_order_at', (select max(o.created_at) from public.orders o where o.customer_id = c.id and o.kind = 'order')) as x
      from public.customers c
      where (p_search is null or c.name ilike '%' || p_search || '%' or c.city ilike '%' || p_search || '%' or c.code ilike '%' || p_search || '%')
        and (p_segment is null or c.segment = p_segment) and (p_label is null or exists (select 1 from public.customer_labels cl where cl.customer_id = c.id and cl.label_id = p_label))
      order by case c.segment when 'A+' then 0 when 'A' then 1 when 'B' then 2 when 'C' then 3 else 4 end, c.name
      limit p_limit offset p_offset) s), '[]'))
$$;

create function public.customer_detail(p_id uuid) returns jsonb
language sql stable security invoker set search_path = public as $$
  select to_jsonb(c) || jsonb_build_object(
    'adviser', (select full_name from public.profiles where id = c.adviser_id),
    'contacts', (select coalesce(jsonb_agg(to_jsonb(cc)), '[]') from public.customer_contacts cc where cc.customer_id = c.id),
    'labels', (select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name, 'color', l.color)), '[]') from public.customer_labels cl join public.labels l on l.id = cl.label_id where cl.customer_id = c.id),
    'orders', (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'number', o.number, 'kind', o.kind, 'status', o.status, 'created_at', o.created_at,
                 'total_usd_minor', o.total_usd_minor, 'total_sdg_minor', o.total_sdg_minor, 'paid_sdg_minor', o.paid_sdg_minor, 'payment_status', o.payment_status,
                 'rate_sdg', o.rate_sdg, 'released_at', o.released_at) order by o.created_at desc), '[]') from public.orders o where o.customer_id = c.id),
    'receipts', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'number', r.number, 'txn_code', r.txn_code, 'amount_sdg_minor', r.amount_sdg_minor,
                 'received_on', r.received_on, 'status', r.status, 'allocated_sdg_minor', r.allocated_sdg_minor) order by r.received_on desc, r.recorded_at desc), '[]')
                 from public.receipts r where r.customer_id = c.id),
    'messages', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'channel', m.channel, 'direction', m.direction, 'body', m.body, 'created_at', m.created_at,
                 'author', (select full_name from public.profiles where id = m.author_id)) order by m.created_at desc), '[]') from public.messages m where m.customer_id = c.id),
    'outstanding_sdg_minor', (select coalesce(sum(o.total_sdg_minor - o.paid_sdg_minor), 0) from public.orders o where o.customer_id = c.id and o.kind = 'order' and o.status = 'confirmed'),
    'revenue_usd_minor', (select coalesce(sum(o.total_usd_minor), 0) from public.orders o where o.customer_id = c.id and o.kind = 'order' and o.status = 'confirmed'))
  from public.customers c where c.id = p_id
$$;

create function public.labels_list() returns jsonb
language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name, 'color', l.color,
    'count', (select count(*) from public.customer_labels cl where cl.label_id = l.id)) order by l.name), '[]') from public.labels l
$$;

create function public.orders_list(p_filter text default 'all', p_search text default null, p_limit integer default 80) returns jsonb
language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_agg(x), '[]') from (
    select jsonb_build_object('id', o.id, 'number', o.number, 'kind', o.kind, 'status', o.status, 'created_at', o.created_at,
      'customer_id', o.customer_id, 'customer', c.name, 'city', c.city, 'adviser', pr.full_name, 'rate_sdg', o.rate_sdg,
      'total_usd_minor', o.total_usd_minor, 'total_sdg_minor', o.total_sdg_minor, 'paid_sdg_minor', o.paid_sdg_minor,
      'payment_status', o.payment_status, 'released_at', o.released_at, 'valid_until', o.valid_until,
      'lines', (select count(*) from public.order_lines l where l.order_id = o.id)) as x
    from public.orders o join public.customers c on c.id = o.customer_id left join public.profiles pr on pr.id = o.adviser_id
    where (p_search is null or o.number ilike '%' || p_search || '%' or c.name ilike '%' || p_search || '%')
      and case p_filter
        when 'quotes' then o.kind = 'quote' and o.status = 'quote'
        when 'open' then o.kind = 'order' and o.status = 'confirmed' and o.payment_status <> 'paid'
        when 'to_release' then o.kind = 'order' and o.status = 'confirmed' and o.payment_status = 'paid' and o.released_at is null
        when 'released' then o.released_at is not null
        else true end
    order by o.created_at desc limit p_limit) s
$$;

-- An order with its lines and payments; row level security decides whether the caller sees it.
create function public.order_detail(p_id uuid) returns jsonb
language sql stable security invoker set search_path = public as $$
  select to_jsonb(o) || jsonb_build_object(
    'customer', (select jsonb_build_object('id', c.id, 'name', c.name, 'city', c.city, 'code', c.code,
                   'phone', (select value from public.customer_contacts cc where cc.customer_id = c.id and cc.is_primary limit 1))
                 from public.customers c where c.id = o.customer_id),
    'adviser_name', (select full_name from public.profiles where id = o.adviser_id),
    'lines', (select coalesce(jsonb_agg(to_jsonb(l) || jsonb_build_object('product_name', p.name, 'sku', p.sku,
                'approved_by', (select pr.full_name from public.discount_approvals a join public.profiles pr on pr.id = a.decided_by where a.id = l.approval_id))
              order by l.line_no), '[]') from public.order_lines l join public.products p on p.id = l.product_id where l.order_id = o.id),
    'payments', (select coalesce(jsonb_agg(jsonb_build_object('receipt_id', r.id, 'number', r.number, 'txn_code', r.txn_code, 'received_on', r.received_on,
                   'status', r.status, 'sdg_minor', a.sdg_minor, 'booked_usd_minor', a.booked_usd_minor) order by r.received_on, a.created_at), '[]')
                 from public.receipt_allocations a join public.receipts r on r.id = a.receipt_id where a.order_id = o.id),
    'converted_from_number', (select number from public.orders q where q.id = o.converted_from),
    'converted_to_number', (select number from public.orders q where q.id = o.converted_to))
  from public.orders o where o.id = p_id
$$;

create function public.approvals_list(p_status text default 'pending') returns jsonb
language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'draft_id', a.draft_id, 'status', a.status, 'qty', a.qty,
      'unit_price_usd_minor', a.unit_price_usd_minor, 'value_usd_minor', a.value_usd_minor, 'discount_usd_minor', a.discount_usd_minor,
      'customer', c.name, 'city', c.city, 'product', p.name, 'requested_by', rq.full_name, 'requested_at', a.requested_at,
      'decided_by', dc.full_name, 'decided_at', a.decided_at, 'note', a.note, 'used_by_order', a.used_by_order) order by a.requested_at desc), '[]')
  from public.discount_approvals a
  join public.customers c on c.id = a.customer_id join public.products p on p.id = a.product_id
  join public.profiles rq on rq.id = a.requested_by left join public.profiles dc on dc.id = a.decided_by
  where (p_status = 'all' or a.status = p_status) and a.requested_at > private.now() - interval '30 days'
$$;

create function public.draft_approvals(p_draft uuid) returns jsonb
language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'product_id', a.product_id, 'qty', a.qty, 'discount_usd_minor', a.discount_usd_minor,
    'status', a.status, 'decided_by', (select full_name from public.profiles where id = a.decided_by), 'decided_at', a.decided_at)), '[]')
  from public.discount_approvals a where a.draft_id = p_draft
$$;

create function public.receipts_list(p_filter text default 'all', p_search text default null, p_limit integer default 100) returns jsonb
language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_agg(x), '[]') from (
    select jsonb_build_object('id', r.id, 'number', r.number, 'txn_code', r.txn_code, 'amount_sdg_minor', r.amount_sdg_minor, 'received_on', r.received_on,
      'customer_id', r.customer_id, 'customer', c.name, 'from_name', r.from_name, 'from_holder', fh.display_name,
      'to_account', a.name, 'to_holder', h.display_name, 'status', r.status, 'flags', r.flags, 'allocated_sdg_minor', r.allocated_sdg_minor,
      'recorded_by', pr.full_name, 'recorded_at', r.recorded_at, 'proof_path', r.proof_path,
      'orders', (select coalesce(jsonb_agg(jsonb_build_object('number', o.number, 'sdg_minor', al.sdg_minor)), '[]')
                 from public.receipt_allocations al join public.orders o on o.id = al.order_id where al.receipt_id = r.id)) as x
    from public.receipts r join public.customers c on c.id = r.customer_id
    left join public.accounts a on a.id = r.to_account_id left join public.account_holders h on h.id = a.holder_id
    left join public.account_holders fh on fh.id = r.from_holder_id
    left join public.profiles pr on pr.id = r.recorded_by
    where (p_search is null or r.txn_code ilike '%' || p_search || '%' or c.name ilike '%' || p_search || '%' or r.number ilike '%' || p_search || '%')
      and case p_filter when 'to_forward' then r.status = 'received' when 'to_confirm' then r.status = 'forwarded'
                        when 'unmatched' then r.allocated_sdg_minor < r.amount_sdg_minor when 'flagged' then cardinality(r.flags) > 0 else true end
    order by r.received_on desc, r.recorded_at desc limit p_limit) s
$$;

create function public.conflicts_list() returns jsonb
language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', k.id, 'txn_code', k.txn_code, 'attempted_amount_sdg_minor', k.attempted_amount_sdg_minor,
    'attempted_on', k.attempted_on, 'receipt_number', r.number, 'receipt_amount_sdg_minor', r.amount_sdg_minor, 'raised_by', pr.full_name,
    'raised_at', k.raised_at, 'resolved_at', k.resolved_at, 'resolution', k.resolution) order by k.raised_at desc), '[]')
  from public.receipt_conflicts k join public.receipts r on r.id = k.receipt_id left join public.profiles pr on pr.id = k.raised_by
$$;

create function public.open_orders(p_customer uuid) returns jsonb
language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'number', o.number, 'created_at', o.created_at, 'total_sdg_minor', o.total_sdg_minor,
    'paid_sdg_minor', o.paid_sdg_minor, 'outstanding_sdg_minor', o.total_sdg_minor - o.paid_sdg_minor, 'rate_sdg', o.rate_sdg) order by o.created_at), '[]')
  from public.orders o where o.customer_id = p_customer and o.kind = 'order' and o.status = 'confirmed' and o.paid_sdg_minor < o.total_sdg_minor
$$;

-- The warehouse's view of orders: what to pick and whether it may leave. No amounts.
create function public.pick_list() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t uuid := private.require('owner', 'warehouse');
begin
  return (select coalesce(jsonb_agg(x order by x ->> 'sort', x ->> 'created_at'), '[]') from (
    select jsonb_build_object('id', o.id, 'number', o.number, 'customer', c.name, 'city', c.city, 'created_at', o.created_at,
      'payment_status', o.payment_status, 'released_at', o.released_at,
      'state', case when o.released_at is not null then 'released' when o.payment_status = 'paid' then 'ready' else 'waiting' end,
      'sort', case when o.released_at is not null then '2' when o.payment_status = 'paid' then '0' else '1' end,
      'lines', (select jsonb_agg(jsonb_build_object('product', p.name, 'sku', p.sku, 'qty', l.qty,
                  'on_hand', (select coalesce(sum(qty_in - qty_out), 0) from public.stock_lots s where s.product_id = l.product_id)) order by l.line_no)
                from public.order_lines l join public.products p on p.id = l.product_id where l.order_id = o.id)) as x
    from public.orders o join public.customers c on c.id = o.customer_id
    where o.tenant_id = t and o.kind = 'order' and o.status = 'confirmed'
      and (o.released_at is null or o.released_at > private.now() - interval '7 days')) s);
end $$;

create function public.shipments_list() returns jsonb
language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'ref', s.ref, 'supplier', s.supplier, 'origin', s.origin, 'status', s.status,
    'ordered_on', s.ordered_on, 'eta', s.eta, 'arrived_on', s.arrived_on, 'received_on', s.received_on, 'costs_final', s.costs_final,
    'units', (select sum(qty) from public.shipment_lines l where l.shipment_id = s.id),
    'lines', (select jsonb_agg(jsonb_build_object('product', p.name, 'qty', l.qty) order by l.qty desc) from public.shipment_lines l join public.products p on p.id = l.product_id where l.shipment_id = s.id))
    order by coalesce(s.received_on, s.eta, s.ordered_on) desc), '[]')
  from public.shipments s
$$;

create function public.movements_list(p_product uuid default null, p_limit integer default 100) returns jsonb
language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_agg(x), '[]') from (
    select jsonb_build_object('id', m.id, 'kind', m.kind, 'qty', m.qty, 'product', p.name, 'created_at', m.created_at, 'note', m.note,
      'shipment', sh.ref, 'order_number', (select number from public.orders o where o.id = m.order_id), 'by', pr.full_name) as x
    from public.stock_movements m join public.products p on p.id = m.product_id
    left join public.shipments sh on sh.id = m.shipment_id left join public.profiles pr on pr.id = m.created_by
    where p_product is null or m.product_id = p_product
    order by m.created_at desc limit p_limit) s
$$;

create function public.rates_history(p_days integer default 120) returns jsonb
language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'reference', (select coalesce(jsonb_agg(jsonb_build_object('date', rate_date, 'currency', currency, 'per_usd_ppm', per_usd_ppm) order by rate_date), '[]')
                  from public.reference_rates where rate_date > private.today() - p_days),
    'orders', (select coalesce(jsonb_agg(jsonb_build_object('date', d, 'min', mn, 'max', mx, 'avg', av) order by d), '[]') from (
                 select (o.created_at at time zone 'Africa/Khartoum')::date as d, min(o.rate_sdg) as mn, max(o.rate_sdg) as mx, round(avg(o.rate_sdg)) as av
                 from public.orders o where o.created_at > private.now() - make_interval(days => p_days) group by 1) x),
    'minimum_history', (select coalesce(jsonb_agg(jsonb_build_object('changed_at', h.changed_at, 'old', h.old_values -> 'min_rate_sdg', 'new', h.new_values -> 'min_rate_sdg') order by h.changed_at), '[]')
                 from public.settings_history h where h.new_values ? 'min_rate_sdg'))
$$;

-- CRM: revenue per active dealer, segments and pipeline. Sales only; no costs.
create function public.crm_overview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t uuid := private.require('owner', 'marketing', 'adviser'); mine boolean := private.has_role('adviser'); d date := private.today();
begin
  return (with cust as (
      select c.* from public.customers c where c.tenant_id = t and (not mine or c.adviser_id = auth.uid())),
    rev as (
      select o.customer_id, sum(o.total_usd_minor) as usd, count(*) as n from public.orders o
      where o.tenant_id = t and o.kind = 'order' and o.status = 'confirmed' and o.created_at >= d - 90 group by o.customer_id)
    select jsonb_build_object(
      'customers', (select count(*) from cust),
      'active_dealers', (select count(*) from cust c join rev r on r.customer_id = c.id),
      'revenue_90d_usd_minor', (select coalesce(sum(r.usd), 0) from cust c join rev r on r.customer_id = c.id),
      'segments', (select jsonb_agg(jsonb_build_object('segment', s.seg, 'customers', (select count(*) from cust c where c.segment = s.seg),
          'active', (select count(*) from cust c join rev r on r.customer_id = c.id where c.segment = s.seg),
          'revenue_usd_minor', (select coalesce(sum(r.usd), 0) from cust c join rev r on r.customer_id = c.id where c.segment = s.seg)) order by s.ord)
        from unnest(array['A+', 'A', 'B', 'C', 'D']) with ordinality s(seg, ord)),
      'pipeline', (select jsonb_object_agg(pipeline, n) from (select pipeline, count(*) as n from cust group by pipeline) x),
      'sources', (select jsonb_agg(jsonb_build_object('source', source, 'customers', n, 'revenue_usd_minor', usd) order by usd desc) from (
          select c.source, count(*) as n, coalesce(sum(r.usd), 0) as usd from cust c left join rev r on r.customer_id = c.id group by c.source) x),
      'top', (select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'city', c.city, 'segment', c.segment, 'orders', r.n, 'revenue_usd_minor', r.usd) order by r.usd desc)
              from (select * from rev order by usd desc limit 10) r join cust c on c.id = r.customer_id)));
end $$;

create function public.price_list() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t uuid := private.require('owner', 'marketing', 'adviser');
begin
  return (select coalesce(jsonb_agg(jsonb_build_object('sku', p.sku, 'name', p.name, 'category', p.category, 'brand', p.brand, 'spec', p.spec,
      'price_usd_minor', pp.price_usd_minor) order by array_position(array['inverter','battery','panel','solar_ac','pump','bos'], p.category), pp.price_usd_minor desc), '[]')
    from public.products p join public.product_prices pp on pp.product_id = p.id where p.tenant_id = t and p.active);
end $$;

create function public.settings_full() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t uuid := private.require('owner');
begin
  return jsonb_build_object(
    'settings', (select to_jsonb(s) from public.tenant_settings s where s.tenant_id = t),
    'account_kinds', (select jsonb_agg(to_jsonb(k) order by k.sort) from public.account_kinds k where k.tenant_id = t),
    'history', (select coalesce(jsonb_agg(jsonb_build_object('changed_at', h.changed_at, 'by', pr.full_name, 'old', h.old_values, 'new', h.new_values) order by h.changed_at desc), '[]')
                from (select * from public.settings_history where tenant_id = t order by changed_at desc limit 20) h left join public.profiles pr on pr.id = h.changed_by),
    'users', (select jsonb_agg(jsonb_build_object('id', p.id, 'full_name', p.full_name, 'email', p.email, 'role', m.role, 'active', m.active) order by m.role, p.full_name)
              from public.memberships m join public.profiles p on p.id = m.user_id where m.tenant_id = t),
    'holders', (select jsonb_agg(jsonb_build_object('id', h.id, 'name', h.display_name, 'kind', h.kind,
                  'aliases', (select jsonb_agg(a.alias order by a.alias) from public.holder_aliases a where a.holder_id = h.id)) order by h.kind, h.display_name)
                from public.account_holders h where h.tenant_id = t));
end $$;

-- ------------------------------------------------------------------ dashboard
-- One call, and each role gets only its own panels.
create function public.dashboard() returns jsonb
language plpgsql stable security definer set search_path = public, restricted as $$
declare
  t uuid := private.require('owner', 'marketing', 'adviser', 'warehouse');
  r public.app_role := private.role();
  d date := private.today();
  month_start date := date_trunc('month', private.today())::date;
  out jsonb := jsonb_build_object('role', r, 'today', d);
  mine boolean := r = 'adviser';
begin
  -- stock below minimum: every role
  out := out || jsonb_build_object('low_stock', (select coalesce(jsonb_agg(jsonb_build_object('product', p.name, 'on_hand', coalesce(s.q, 0), 'min', p.min_stock) order by coalesce(s.q, 0) - p.min_stock), '[]')
    from public.products p left join (select product_id, sum(qty_in - qty_out) q from public.stock_lots where tenant_id = t group by product_id) s on s.product_id = p.id
    where p.tenant_id = t and p.active and coalesce(s.q, 0) < p.min_stock));

  if r in ('owner', 'adviser') then
    out := out || jsonb_build_object(
      'open_payments', (select jsonb_build_object('orders', count(*), 'outstanding_sdg_minor', coalesce(sum(o.total_sdg_minor - o.paid_sdg_minor), 0))
         from public.orders o where o.tenant_id = t and o.kind = 'order' and o.status = 'confirmed' and o.payment_status <> 'paid' and (not mine or o.adviser_id = auth.uid())),
      'to_forward', (select jsonb_build_object('receipts', count(*), 'sdg_minor', coalesce(sum(amount_sdg_minor), 0))
         from public.receipts rc where rc.tenant_id = t and rc.status = 'received' and (not mine or exists (select 1 from public.customers c where c.id = rc.customer_id and c.adviser_id = auth.uid()))),
      'accounts', (select coalesce(jsonb_agg(jsonb_build_object('name', a.name, 'holder', h.display_name, 'limit', a.daily_limit_minor, 'intake', private.intake(a.id, d)) order by private.intake(a.id, d)::numeric / nullif(a.daily_limit_minor, 0) desc nulls last), '[]')
         from public.accounts a join public.account_kinds k on k.tenant_id = a.tenant_id and k.code = a.kind left join public.account_holders h on h.id = a.holder_id
         where a.tenant_id = t and a.active and k.receives_customer_payments),
      'approvals', (select count(*) from public.discount_approvals a where a.tenant_id = t and a.status = 'pending' and (not mine or a.requested_by = auth.uid())),
      'sales_14d', (select coalesce(jsonb_agg(jsonb_build_object('date', g.day, 'usd_minor', coalesce(x.usd, 0), 'orders', coalesce(x.n, 0)) order by g.day), '[]')
         from generate_series(d - 13, d, interval '1 day') g(day)
         left join (select (o.created_at at time zone 'Africa/Khartoum')::date as day, sum(o.total_usd_minor) as usd, count(*) as n from public.orders o
                    where o.tenant_id = t and o.kind = 'order' and o.status = 'confirmed' and o.created_at >= d - 14 and (not mine or o.adviser_id = auth.uid()) group by 1) x on x.day = g.day::date),
      'month_sales_usd_minor', (select coalesce(sum(o.total_usd_minor), 0) from public.orders o where o.tenant_id = t and o.kind = 'order' and o.status = 'confirmed'
         and o.created_at >= month_start and (not mine or o.adviser_id = auth.uid())));
  end if;

  if r = 'owner' then
    out := out || jsonb_build_object(
      'cash', (select coalesce(jsonb_agg(jsonb_build_object('currency', x.currency, 'minor', x.bal, 'accounts', x.n)), '[]') from (
          select a.currency, sum(private.balance(a.id)) as bal, count(*) as n from public.accounts a join public.account_kinds k on k.tenant_id = a.tenant_id and k.code = a.kind
          where a.tenant_id = t and a.active and not k.is_external group by a.currency order by a.currency) x),
      'exchangers', (select coalesce(jsonb_agg(jsonb_build_object('holder', h.display_name, 'sdg_minor', x.bal) order by x.bal desc), '[]') from (
          select a.holder_id, sum(private.balance(a.id)) as bal from public.accounts a where a.tenant_id = t and a.kind = 'exchanger' group by a.holder_id) x
          join public.account_holders h on h.id = x.holder_id),
      'conflicts', (select count(*) from public.receipt_conflicts c where c.tenant_id = t and c.resolved_at is null),
      'profit_month', (select jsonb_build_object(
          'revenue_usd', coalesce(sum(revenue_usd_minor), 0), 'gross_usd', coalesce(sum(revenue_usd_minor - cost_usd_minor), 0),
          'fx_usd', (select coalesce(sum(realized_usd_minor - booked_usd_minor), 0) from fx_facts f where f.tenant_id = t and f.occurred_on >= month_start),
          'expenses_usd', (select coalesce(sum(usd_minor), 0) from public.ledger_entries le where le.tenant_id = t and le.kind in ('expense', 'refund') and le.occurred_on >= month_start))
        from sale_facts sf where sf.tenant_id = t and sf.released_on >= month_start),
      'checks', (select jsonb_agg(jsonb_build_object('code', c ->> 'code', 'status', c ->> 'status', 'count', jsonb_array_length(c -> 'items'))) from jsonb_array_elements(public.closing_checks()) c));
  end if;

  if r in ('owner', 'warehouse') then
    out := out || jsonb_build_object(
      'ready_to_release', (select count(*) from public.orders o where o.tenant_id = t and o.kind = 'order' and o.status = 'confirmed' and o.payment_status = 'paid' and o.released_at is null),
      'waiting_payment', (select count(*) from public.orders o where o.tenant_id = t and o.kind = 'order' and o.status = 'confirmed' and o.payment_status <> 'paid'),
      'incoming', (select coalesce(jsonb_agg(jsonb_build_object('ref', s.ref, 'status', s.status, 'eta', s.eta, 'units', (select sum(qty) from public.shipment_lines l where l.shipment_id = s.id)) order by s.eta), '[]')
         from public.shipments s where s.tenant_id = t and s.status <> 'received'));
  end if;

  if r = 'marketing' then
    out := out || jsonb_build_object('crm', public.crm_overview(),
      'top_products', (select coalesce(jsonb_agg(jsonb_build_object('product', p.name, 'units', x.u) order by x.u desc), '[]') from (
         select l.product_id, sum(l.qty) as u from public.order_lines l join public.orders o on o.id = l.order_id
         where o.tenant_id = t and o.kind = 'order' and o.status = 'confirmed' and o.created_at >= d - 30 group by l.product_id order by u desc limit 6) x
         join public.products p on p.id = x.product_id));
  end if;
  return out;
end $$;

-- ---------------------------------------------------------------- 20260922000900_period_close.sql
-- Closing a period. Saved rows never change (triggers), but that alone doesn't keep last month's
-- report still: a receipt or an expense recorded late and dated last month would change it.
-- Once the owner closes a month, nothing can be dated into it any more; late items are recorded
-- in the open period, with a note. This is what makes "the same numbers in six months" true.

create table public.period_locks (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  closed_through date not null,
  closed_by uuid references public.profiles (id),
  closed_at timestamptz not null
);
alter table public.period_locks enable row level security;
create policy member_read on public.period_locks for select to authenticated using (tenant_id = (select private.tenant_id()));

create function private.assert_open(p_tenant uuid, p_day date) returns void
language plpgsql stable security definer set search_path = public as $$
declare through date;
begin
  select closed_through into through from public.period_locks where tenant_id = p_tenant;
  if through is not null and p_day <= through then
    raise exception 'The books are closed up to %. Record this in the open period, with a note.', to_char(through, 'DD Mon YYYY')
      using errcode = 'P0001', hint = 'period_closed';
  end if;
end $$;

-- The owner closes through the end of a month; closing only ever moves forward.
create function public.close_period(p_through date) returns void
language plpgsql security definer set search_path = public as $$
declare t uuid := private.require('owner'); current date;
begin
  if p_through >= private.today() then raise exception 'Only past days can be closed.'; end if;
  select closed_through into current from public.period_locks where tenant_id = t;
  if current is not null and p_through <= current then raise exception 'Already closed up to %.', current; end if;
  insert into public.period_locks (tenant_id, closed_through, closed_by, closed_at) values (t, p_through, auth.uid(), private.now())
  on conflict (tenant_id) do update set closed_through = excluded.closed_through, closed_by = excluded.closed_by, closed_at = excluded.closed_at;
end $$;

-- Every dated write checks the lock. The trigger argument names the row's date column.
create function private.guard_period() returns trigger language plpgsql as $$
declare v text := to_jsonb(new) ->> tg_argv[0];
begin
  perform private.assert_open(new.tenant_id, case when length(v) > 10 then (v::timestamptz at time zone 'Africa/Khartoum')::date else v::date end);
  return new;
end $$;

create trigger receipts_period before insert on public.receipts for each row execute function private.guard_period('received_on');
create trigger ledger_period before insert on public.ledger_entries for each row execute function private.guard_period('occurred_on');
create trigger orders_period before insert on public.orders for each row execute function private.guard_period('created_at');
create trigger allocations_period before insert on public.receipt_allocations for each row execute function private.guard_period('created_at');
create trigger shipment_costs_period before insert on restricted.shipment_costs for each row execute function private.guard_period('incurred_on');
create trigger sale_facts_period before insert on restricted.sale_facts for each row execute function private.guard_period('released_on');
create trigger fx_facts_period before insert on restricted.fx_facts for each row execute function private.guard_period('occurred_on');

grant execute on function public.close_period(date) to authenticated;

create function public.period_lock() returns jsonb
language sql stable security invoker set search_path = public as $$
  select jsonb_build_object('closed_through', l.closed_through, 'closed_at', l.closed_at, 'by', (select full_name from public.profiles where id = l.closed_by))
  from public.period_locks l
$$;
grant execute on function public.period_lock() to authenticated;

-- ---------------------------------------------------------------- production/storage.sql
-- Storage for payment screenshots and branding, applied to the hosted project with the
-- migrations. Private buckets; the path starts with the tenant id, and the policies mirror the
-- receipts table: the owner sees all of their environment's proofs, an adviser only her own
-- customers' proofs, nobody else anything.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('proofs', 'proofs', false, 5242880, array['image/jpeg', 'image/png', 'image/webp']),
       ('branding', 'branding', false, 2097152, array['image/png', 'image/svg+xml', 'image/jpeg'])
on conflict (id) do nothing;

-- proofs/<tenant_id>/<receipt_id>.jpg
create policy "proofs: upload into own environment" on storage.objects for insert to authenticated
with check (
  bucket_id = 'proofs'
  and (storage.foldername(name))[1] = private.tenant_id()::text
  and private.has_role('owner', 'adviser')
);

create policy "proofs: read what the receipt allows" on storage.objects for select to authenticated
using (
  bucket_id = 'proofs'
  and (storage.foldername(name))[1] = private.tenant_id()::text
  and (
    private.has_role('owner')
    or exists (select 1 from public.receipts r where r.proof_path = storage.objects.name and private.sees_customer(r.customer_id))
    -- an adviser may read back what she just uploaded, before the receipt row exists
    or (private.has_role('adviser') and owner = auth.uid())
  )
);
-- No update or delete policy: a proof, like the receipt it belongs to, is never replaced.

create policy "branding: read own environment" on storage.objects for select to authenticated
using (bucket_id = 'branding' and (storage.foldername(name))[1] = private.tenant_id()::text);
create policy "branding: owner writes" on storage.objects for insert to authenticated
with check (bucket_id = 'branding' and (storage.foldername(name))[1] = private.tenant_id()::text and private.has_role('owner'));
