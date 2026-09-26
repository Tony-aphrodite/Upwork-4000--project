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
  proof_path text not null, -- the object in the "proofs" bucket: <tenant>/<receipt>.jpg
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
