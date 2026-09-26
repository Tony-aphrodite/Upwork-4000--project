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
