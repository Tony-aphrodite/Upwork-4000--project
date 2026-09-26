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
