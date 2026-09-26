/**
 * A small, fixed world for the checks: the trial task's four products and three dealers, the
 * two accounts of the trial (an adviser and an owner) plus the other roles, two exchanger
 * accounts, a pass-through account, the UAE account, and a second environment (a dealer) to
 * prove isolation. Built fresh for every run, so the checks never touch the demo data.
 */
import type { Database } from "./client";

export const F = {
  tenant: "f0000000-0000-4000-8000-000000000001",
  dealerTenant: "f0000000-0000-4000-8000-000000000002",
  owner: "f1000000-0000-4000-8000-000000000001",
  adviser: "f1000000-0000-4000-8000-000000000002",
  adviser2: "f1000000-0000-4000-8000-000000000003",
  marketing: "f1000000-0000-4000-8000-000000000004",
  warehouse: "f1000000-0000-4000-8000-000000000005",
  dealerOwner: "f1000000-0000-4000-8000-000000000006",
  products: {
    spf6000: "f2000000-0000-4000-8000-000000000001",
    spe12000: "f2000000-0000-4000-8000-000000000002",
    hope5: "f2000000-0000-4000-8000-000000000003",
    hope16: "f2000000-0000-4000-8000-000000000004",
    spf3500: "f2000000-0000-4000-8000-000000000005",
  },
  customers: {
    ahmed: "f3000000-0000-4000-8000-000000000001",
    nile: "f3000000-0000-4000-8000-000000000002",
    dongola: "f3000000-0000-4000-8000-000000000003",
    other: "f3000000-0000-4000-8000-000000000004", // belongs to the second adviser
    dealersOwn: "f3000000-0000-4000-8000-000000000005", // in the dealer environment
  },
  accounts: {
    mogtaba: "f4000000-0000-4000-8000-000000000001",
    hashim: "f4000000-0000-4000-8000-000000000002",
    khalid: "f4000000-0000-4000-8000-000000000003",
    awxEur: "f4000000-0000-4000-8000-000000000004",
    customers: "f4000000-0000-4000-8000-000000000005",
    dealerOwn: "f4000000-0000-4000-8000-000000000006",
  },
  holders: { mogtaba: "f5000000-0000-4000-8000-000000000001", hashim: "f5000000-0000-4000-8000-000000000002" },
  shipment: "S-TRIAL-01",
};

export async function buildFixture(db: Database) {
  const t = F.tenant;
  const people: [string, string, string, string, string][] = [
    [F.owner, "Owner Olivia", "owner@trial.example", "owner", t],
    [F.adviser, "Adviser Amira", "amira@trial.example", "adviser", t],
    [F.adviser2, "Adviser Nusiba", "nusiba@trial.example", "adviser", t],
    [F.marketing, "Marketing Salma", "salma@trial.example", "marketing", t],
    [F.warehouse, "Warehouse Tarig", "tarig@trial.example", "warehouse", t],
    [F.dealerOwner, "Dealer Yasir", "yasir@dealer.example", "owner", F.dealerTenant],
  ];
  const P = F.products;
  const C = F.customers;
  const A = F.accounts;
  await db.service.exec(`
    set timezone = 'UTC';
    insert into public.tenants (id, slug, name, kind) values ('${t}', 'trial', 'Trial Distributor', 'distributor'), ('${F.dealerTenant}', 'trial-dealer', 'Trial Dealer', 'dealer');
    insert into public.tenant_settings (tenant_id, brand_name, min_rate_sdg) values ('${t}', 'Trial', 8000), ('${F.dealerTenant}', 'Trial Dealer', 8000);
    ${people.map(([id, name, email]) => `insert into auth.users (id, email, raw_user_meta_data) values ('${id}', '${email}', '{"full_name": "${name}"}');`).join("\n")}
    ${people.map(([id, , , role, tenant]) => `insert into public.memberships (user_id, tenant_id, role) values ('${id}', '${tenant}', '${role}');`).join("\n")}
    insert into public.account_kinds (tenant_id, code, label, receives_customer_payments, pass_through, is_external, sort) values
      ('${t}', 'exchanger', 'Exchanger', true, false, false, 1), ('${t}', 'pass_through', 'Pass-through', true, true, false, 2),
      ('${t}', 'foreign', 'Foreign', false, false, false, 3), ('${t}', 'customers', 'Customers', false, false, true, 9),
      ('${F.dealerTenant}', 'own', 'Own', true, false, false, 1), ('${F.dealerTenant}', 'customers', 'Customers', false, false, true, 9);
    insert into public.account_holders (id, tenant_id, display_name, kind) values ('${F.holders.mogtaba}', '${t}', 'Mogtaba Elsir', 'exchanger'), ('${F.holders.hashim}', '${t}', 'Hashim Elnour', 'exchanger');
    insert into public.holder_aliases (tenant_id, holder_id, alias) values ('${t}', '${F.holders.mogtaba}', 'Mogtaba'), ('${t}', '${F.holders.mogtaba}', 'Mujtaba'),
      ('${t}', '${F.holders.mogtaba}', 'Motgaba'), ('${t}', '${F.holders.hashim}', 'Hashim');
    insert into public.accounts (id, tenant_id, kind, holder_id, name, currency, daily_limit_minor, route_label) values
      ('${A.mogtaba}', '${t}', 'exchanger', '${F.holders.mogtaba}', 'Mogtaba BOK', 'SDG', 1500000000, 'Mogtaba Elsir'),
      ('${A.hashim}', '${t}', 'exchanger', '${F.holders.hashim}', 'Hashim ONB', 'SDG', 1500000000, 'Hashim Elnour'),
      ('${A.khalid}', '${t}', 'pass_through', null, 'Khalid (pass-through)', 'SDG', 1500000000, null),
      ('${A.awxEur}', '${t}', 'foreign', null, 'Airwallex EUR', 'EUR', null, 'Airwallex (UAE)'),
      ('${A.customers}', '${t}', 'customers', null, 'Customers', 'SDG', null, null),
      ('${A.dealerOwn}', '${F.dealerTenant}', 'own', null, 'Dealer own', 'SDG', 1500000000, null),
      ('f4000000-0000-4000-8000-000000000007', '${F.dealerTenant}', 'customers', null, 'Customers', 'SDG', null, null);
    update public.accounts set forwards_to = '${A.mogtaba}' where id = '${A.khalid}';
    insert into public.products (id, tenant_id, sku, name, category) values
      ('${P.spf6000}', '${t}', 'SPF-6000-ESP', 'SPF 6000 ES Plus', 'inverter'), ('${P.spe12000}', '${t}', 'SPE-12000-ES', 'SPE 12000 ES', 'inverter'),
      ('${P.hope5}', '${t}', 'HOPE-5.0L-B1', 'Hope 5.0L-B1', 'battery'), ('${P.hope16}', '${t}', 'HOPE-16.0LM-A1', 'Hope 16.0LM-A1', 'battery'),
      ('${P.spf3500}', '${t}', 'SPF-3500-ES', 'SPF 3500 ES', 'inverter');
    insert into public.product_prices (product_id, tenant_id, price_usd_minor) values
      ('${P.spf6000}', '${t}', 51500), ('${P.spe12000}', '${t}', 97500), ('${P.hope5}', '${t}', 81000), ('${P.hope16}', '${t}', 207000), ('${P.spf3500}', '${t}', 39500);
    insert into public.customers (id, tenant_id, code, name, city, adviser_id) values
      ('${C.ahmed}', '${t}', 'C-1', 'Ahmed Trading', 'Khartoum', '${F.adviser}'), ('${C.nile}', '${t}', 'C-2', 'Nile Solar', 'Omdurman', '${F.adviser}'),
      ('${C.dongola}', '${t}', 'C-3', 'Dongola Power', 'Dongola', '${F.adviser}'), ('${C.other}', '${t}', 'C-4', 'Someone Else''s Dealer', 'Atbara', '${F.adviser2}'),
      ('${C.dealersOwn}', '${F.dealerTenant}', 'C-1', 'A dealer''s customer', 'Dongola', null);
    insert into public.reference_rates (tenant_id, rate_date, currency, per_usd_ppm)
      select '${t}', d::date, c, case c when 'EUR' then 862000 when 'AED' then 3672500 else 8100000000 end
      from generate_series(current_date - 90, current_date, interval '1 day') d, unnest(array['EUR', 'AED', 'SDG']) c;
    insert into public.reference_rates (tenant_id, rate_date, currency, per_usd_ppm) values ('${F.dealerTenant}', current_date - 90, 'EUR', 862000);
  `);

  // A shipment: 200 inverters at $270 and $166,000 of other goods, $22,801.23 of costs in four
  // currencies, 20% uplift. The brief's example: the $270 inverter lands at $303.58.
  const owner = db.as(F.owner);
  const sid = await owner.rpc<string>("create_shipment", {
    p_ref: F.shipment, p_supplier: "Supplier", p_origin: "Ningbo", p_ordered_on: iso(-80), p_eta: iso(-40), p_invoice_currency: "USD",
    p_usd_per_eur_ppm: null, p_commission_bps: 0,
    p_lines: [
      { product_id: P.spf3500, qty: 200, unit_price_minor: 27000 },
      { product_id: P.spf6000, qty: 160, unit_price_minor: 34500 },
      { product_id: P.spe12000, qty: 60, unit_price_minor: 65000 },
      { product_id: P.hope5, qty: 80, unit_price_minor: 55000 },
      { product_id: P.hope16, qty: 20, unit_price_minor: 139000 },
    ],
  });
  // Purchase: 54,000 + 55,200 + 39,000 + 44,000 + 27,800 = $220,000.
  await owner.rpc("add_shipment_cost", { p_shipment: sid, p_kind: "freight", p_amount_minor: 1240000, p_currency: "USD", p_incurred_on: iso(-50) });
  await owner.rpc("add_shipment_cost", { p_shipment: sid, p_kind: "insurance", p_amount_minor: 66000, p_currency: "USD", p_incurred_on: iso(-60) });
  await owner.rpc("add_shipment_cost", { p_shipment: sid, p_kind: "customs", p_amount_minor: 4498000000, p_currency: "SDG", p_incurred_on: iso(-34), p_rate_ppm: 7700000000 });
  await owner.rpc("add_shipment_cost", { p_shipment: sid, p_kind: "clearance", p_amount_minor: 918000, p_currency: "AED", p_incurred_on: iso(-33) });
  await owner.rpc("add_shipment_cost", { p_shipment: sid, p_kind: "transport", p_amount_minor: 1080000000, p_currency: "SDG", p_incurred_on: iso(-31), p_rate_ppm: 7700000000 });
  return sid;
}

export function iso(offsetDays: number) {
  return new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
}
