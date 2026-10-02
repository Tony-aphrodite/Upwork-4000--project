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
