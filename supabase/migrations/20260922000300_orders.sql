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
