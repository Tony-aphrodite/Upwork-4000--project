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
