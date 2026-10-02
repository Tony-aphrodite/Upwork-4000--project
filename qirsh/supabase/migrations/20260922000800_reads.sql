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
