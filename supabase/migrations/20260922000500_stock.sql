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
