/**
 * Demo data: about a hundred days of a solar distributor's business, replayed through the same
 * database functions the screens use, each call made as the right person at the right moment
 * (the local clock override sets "now"). Nothing is inserted behind the functions' backs except
 * the base records a go-live import would load: people, accounts, products, customers and rates.
 *
 * The business, names, codes and amounts are invented. All phone numbers are 0123456788.
 */
import { lineOf, totalsOf, type LineResult } from "@qirsh/money";
import type { Database } from "./client";

// ------------------------------------------------------------------ deterministic randomness
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260922);
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
const between = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
const chance = (p: number) => rnd() < p;
function weighted<T>(items: readonly (readonly [T, number])[]): T {
  const total = items.reduce((s, [, w]) => s + w, 0);
  let x = rnd() * total;
  for (const [v, w] of items) {
    x -= w;
    if (x <= 0) return v;
  }
  return items[items.length - 1]![0];
}
function uuid() {
  const h = Array.from({ length: 32 }, () => Math.floor(rnd() * 16).toString(16));
  h[12] = "4";
  h[16] = ((parseInt(h[16]!, 16) & 3) | 8).toString(16);
  const s = h.join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}
const hex = (n: number) => Array.from({ length: n }, () => Math.floor(rnd() * 16).toString(16)).join("");

// ------------------------------------------------------------------ SQL literals
type Lit = string & { __lit: true };
const lit = (s: string) => s as Lit;
const T = (s: string | null | undefined): Lit => lit(s == null ? "null" : `'${s.replace(/'/g, "''")}'`);
const U = (s: string | null | undefined): Lit => lit(s == null ? "null" : `'${s}'::uuid`);
const D = (s: string): Lit => lit(`'${s}'::date`);
const B = (n: number): Lit => lit(`${Math.trunc(n)}::bigint`);
const I = (n: number): Lit => lit(`${Math.trunc(n)}::int`);
const J = (v: unknown): Lit => lit(`${T(JSON.stringify(v))}::jsonb`);
const BOOL = (v: boolean): Lit => lit(v ? "true" : "false");

// ------------------------------------------------------------------ calendar (Khartoum, UTC+2, no DST)
const DAY_MS = 86400000;
function khartoumToday(now: Date) {
  const d = new Date(now.getTime() + 2 * 3600000);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export interface SeedOptions {
  now?: Date;
}

// ------------------------------------------------------------------ the business
const TENANT = "5a1e0000-0000-4000-8000-000000000001";
const DEALER_TENANT = "5a1e0000-0000-4000-8000-000000000002";
export const PEOPLE = {
  owner: { id: "0e000000-0000-4000-8000-000000000001", name: "Hamid Osman", email: "hamid@nileray.example", role: "owner" },
  amira: { id: "0e000000-0000-4000-8000-000000000002", name: "Amira Hassan", email: "amira@nileray.example", role: "adviser" },
  nusiba: { id: "0e000000-0000-4000-8000-000000000003", name: "Nusiba Ali", email: "nusiba@nileray.example", role: "adviser" },
  salma: { id: "0e000000-0000-4000-8000-000000000004", name: "Salma Idris", email: "salma@nileray.example", role: "marketing" },
  tarig: { id: "0e000000-0000-4000-8000-000000000005", name: "Tarig Musa", email: "tarig@nileray.example", role: "warehouse" },
  dealer: { id: "0e000000-0000-4000-8000-000000000006", name: "Yasir Babiker", email: "yasir@dongolapower.example", role: "owner" },
} as const;
export const DEMO_TENANT_ID = TENANT;
export const DEALER_TENANT_ID = DEALER_TENANT;
const PHONE = "0123456788";

interface Product {
  id: string;
  sku: string;
  name: string;
  category: "inverter" | "battery" | "solar_ac" | "panel" | "bos" | "pump";
  brand: string;
  spec: string;
  price: number; // cents
  min: number;
}
const P = (sku: string, name: string, category: Product["category"], brand: string, spec: string, priceUsd: number, min: number): Product => ({
  id: uuid(),
  sku,
  name,
  category,
  brand,
  spec,
  price: Math.round(priceUsd * 100),
  min,
});
// The four products and prices of the trial task come first.
const PRODUCTS = [
  P("SPF-6000-ESP", "SPF 6000 ES Plus 6 kW inverter", "inverter", "Growatt", "6 kW off-grid hybrid, 48 V, dual MPPT", 515, 20),
  P("SPE-12000-ES", "SPE 12000 ES 12 kW inverter", "inverter", "Growatt", "12 kW off-grid hybrid, 48 V", 975, 8),
  P("HOPE-5.0L-B1", "Hope 5.0L-B1 5 kWh battery", "battery", "Hope", "5.12 kWh LiFePO4, 48 V, wall/rack", 810, 25),
  P("HOPE-16.0LM-A1", "Hope 16.0LM-A1 16 kWh battery", "battery", "Hope", "16 kWh LiFePO4, 48 V, floor-standing", 2070, 8),
  P("SPF-3500-ES", "SPF 3500 ES 3.5 kW inverter", "inverter", "Growatt", "3.5 kW off-grid, 24 V", 395, 20),
  P("SPF-5000-ES", "SPF 5000 ES 5 kW inverter", "inverter", "Growatt", "5 kW off-grid hybrid, 48 V", 450, 20),
  P("SPH-10K-TL3", "SPH 10000TL3 10 kW three-phase inverter", "inverter", "Growatt", "10 kW three-phase hybrid", 1520, 4),
  P("HOPE-10.0L-C1", "Hope 10.0L-C1 10 kWh battery", "battery", "Hope", "10.24 kWh LiFePO4, 48 V", 1390, 8),
  P("GEL-200-12", "Gel battery 200 Ah 12 V", "battery", "Sunlite", "Deep-cycle gel, 12 V 200 Ah", 225, 40),
  P("PNL-550-MONO", "Mono 550 W panel", "panel", "Longray", "Monocrystalline PERC, 144 half-cell", 78, 200),
  P("PNL-585-NBF", "N-type 585 W bifacial panel", "panel", "Longray", "N-type TOPCon, bifacial, 144 half-cell", 92, 150),
  P("PNL-450-MONO", "Mono 450 W panel", "panel", "Longray", "Monocrystalline PERC, 120 half-cell", 64, 100),
  P("AC-12K-DC", "Solar DC air conditioner 12,000 BTU", "solar_ac", "Coolsun", "48 V DC, runs directly on panels and battery", 760, 8),
  P("AC-18K-HYB", "Hybrid solar air conditioner 18,000 BTU", "solar_ac", "Coolsun", "AC/DC hybrid, panel priority", 1040, 6),
  P("PMP-1.5HP-SF", "Solar surface pump kit 1.5 hp", "pump", "Aquasol", "Surface pump with controller, up to 40 m head", 640, 6),
  P("PMP-3HP-SUB", "Solar submersible pump 3 hp", "pump", "Aquasol", "4-inch submersible, MPPT controller", 1240, 6),
  P("PMP-7.5HP-SUB", "Solar submersible pump 7.5 hp", "pump", "Aquasol", "6-inch submersible, VFD controller", 2450, 3),
  P("BOS-MNT-4", "Mounting kit for 4 panels", "bos", "Railfix", "Aluminium rails, clamps, roof hooks", 38, 60),
  P("BOS-PV-6MM", "PV cable 6 mm², 100 m", "bos", "Railfix", "Solar DC cable, UV-resistant, red/black", 92, 40),
  P("BOS-CMB-BOX", "DC combiner box with breaker and SPD", "bos", "Railfix", "2 strings, 1000 V DC", 45, 40),
  P("BOS-MC4-20", "MC4 connectors, 20 pairs", "bos", "Railfix", "IP68, 30 A", 14, 80),
] as const;
const bySku = Object.fromEntries(PRODUCTS.map((p) => [p.sku, p])) as Record<string, Product>;

const CITIES_AMIRA = ["Khartoum", "Khartoum", "Omdurman", "Omdurman", "Bahri", "Port Sudan", "Port Sudan", "Kassala", "Gedaref", "Wad Madani", "Kosti", "Sennar", "El Obeid", "Rabak"];
const CITIES_NUSIBA = ["Dongola", "Dongola", "Atbara", "Shendi", "Karima", "Merowe", "Ed Damer", "Wadi Halfa", "Berber", "Abu Hamad"];
const NAME_A = ["Al Noor", "Al Amal", "Dar Al Salam", "Al Baraka", "Al Fajr", "Al Shams", "Al Nasr", "Al Rahma", "Al Wafa", "Al Hilal", "Al Manar", "Sunrise", "Green Power", "Blue Nile", "White Nile", "Nuba", "Butana", "Jebel", "Tuti", "Sahel", "Al Ikhlas", "Al Tayseer", "Al Rayan", "Al Sultan", "Al Watan", "Al Mustaqbal", "Al Jazeera", "Nile Delta", "Al Safa", "Al Marwa", "Al Diyar", "Al Neel", "Al Sharq", "Al Shamal", "Northern Star", "Desert Light", "Al Kawthar", "Al Faisal", "Al Huda", "Al Karama"];
const NAME_B = ["Solar", "Energy", "Power", "Trading", "Electric", "Solar Systems", "Engineering", "Installations", "Electronics", "Pumps & Solar", "Solar Co.", "Power Solutions"];
const FIRST = ["Ahmed", "Mohamed", "Osman", "Ibrahim", "Hassan", "Yousif", "Abdelrahman", "Khalid", "Omer", "Mustafa", "Hamza", "Babiker", "Elfatih", "Mutasim", "Tarig", "Hisham", "Awad", "Siddig", "Salah", "Kamal", "Fatima", "Mona", "Sara", "Hiba", "Rania", "Samah"];
const LAST = ["Abdalla", "Elhassan", "Mohamed Ali", "Osman", "Ibrahim", "Ahmed", "Elamin", "Musa", "Adam", "Ismail", "Idris", "Elsheikh", "Hamad", "Salih", "Taha", "Bashir", "Nour", "Karrar"];

interface Customer {
  id: string;
  name: string;
  city: string;
  adviser: string;
  segment: "A+" | "A" | "B" | "C" | "D";
  contact: string;
}

// ------------------------------------------------------------------ seed
export async function seed(db: Database, opts: SeedOptions = {}) {
  const now = opts.now ?? new Date();
  const today = khartoumToday(now);
  const dayMs = (i: number) => today + i * DAY_MS; // i <= 0
  const day = (i: number) => iso(dayMs(i));
  const isWorkday = (i: number) => {
    const wd = new Date(dayMs(i)).getUTCDay();
    return wd !== 5 && wd !== 6; // Friday and Saturday off
  };
  // Timestamps. Past days: office hours. Today: spread over the last few hours before now.
  const nowMs = now.getTime();
  const todayStartUtc = today - 2 * 3600000;
  const ts = (i: number, minutes: number) => {
    if (i < 0) return new Date(today + i * DAY_MS - 2 * 3600000 + (8 * 60 + minutes) * 60000).toISOString();
    const span = Math.max(20, Math.min(10 * 60, (nowMs - todayStartUtc) / 60000 - 10));
    const start = nowMs - span * 60000 - 5 * 60000;
    return new Date(start + (Math.min(minutes, 600) / 600) * span * 60000).toISOString();
  };

  // Market rate: 6,050 a hundred and ten days ago to 8,200 today, with some day-to-day noise.
  const START = -110;
  const market: Record<number, number> = {};
  let noise = 0;
  for (let i = START; i <= 0; i++) {
    const base = 6050 * Math.pow(8200 / 6050, (i - START) / -START);
    noise = noise * 0.6 + (rnd() - 0.5) * 0.006;
    market[i] = i === 0 ? 8200 : Math.round((base * (1 + noise)) / 5) * 5;
  }
  const eurPpm = (i: number) => 862000 + Math.round(4200 * Math.sin(i / 13)) + Math.round(1200 * Math.sin(i / 3.7));
  const AED_PPM = 3672500;

  const out: string[] = [];
  const sql = (s: string) => out.push(s);
  let lastWho = "";
  let lastClock = "";
  const setWho = (who: string, clock: string) => {
    if (who !== lastWho || clock !== lastClock) {
      sql(`select set_config('request.jwt.claim.sub', '${who}', false), set_config('app.clock', '${clock}', false);`);
      lastWho = who;
      lastClock = clock;
    }
  };
  const call = (who: string, clock: string, fn: string, args: Record<string, Lit>) => {
    setWho(who, clock);
    sql(`select public.${fn}(${Object.entries(args).map(([k, v]) => `${k} => ${v}`).join(", ")});`);
  };

  // ---------------------------------------------------------------- base records (the go-live import)
  const people = Object.values(PEOPLE);
  sql(`insert into public.tenants (id, slug, name, kind, created_at) values
    (${U(TENANT)}, 'nileray', 'Nileray Solar Trading', 'distributor', '${ts(START, 0)}'),
    (${U(DEALER_TENANT)}, 'dongola-power', 'Dongola Power', 'dealer', '${ts(-20, 0)}');`);
  sql(`update public.tenants set parent_id = ${U(TENANT)} where id = ${U(DEALER_TENANT)};`);
  sql(`insert into public.tenant_settings (tenant_id, brand_name, brand_color, brand_accent, logo_initials, min_rate_sdg) values
    (${U(TENANT)}, 'Nileray Solar', '#1E4D3B', '#D9A441', 'NS', 5900),
    (${U(DEALER_TENANT)}, 'Dongola Power', '#7C2D12', '#E9B949', 'DP', 8000);`);
  for (const p of people) {
    sql(`insert into auth.users (id, email, raw_user_meta_data) values (${U(p.id)}, ${T(p.email)}, ${J({ full_name: p.name })});`);
    sql(`insert into public.memberships (user_id, tenant_id, role) values (${U(p.id)}, ${U(p === PEOPLE.dealer ? DEALER_TENANT : TENANT)}, '${p.role}');`);
  }

  // Account kinds are settings: which kinds exist, which receive customer payments, which must net to zero.
  const kinds = [
    ["exchanger", "Exchanger account", true, false, false, 1],
    ["own", "Our own account", true, false, false, 2],
    ["pass_through", "Pass-through account", true, true, false, 3],
    ["foreign", "Foreign account (UAE)", false, false, false, 4],
    ["staff_cash", "Cash with staff", false, false, false, 5],
    ["customers", "Customers", false, false, true, 10],
    ["suppliers", "Suppliers", false, false, true, 11],
    ["expenses", "Expenses", false, false, true, 12],
    ["opening", "Opening balances", false, false, true, 13],
  ] as const;
  for (const t of [TENANT, DEALER_TENANT]) {
    sql(`insert into public.account_kinds (tenant_id, code, label, receives_customer_payments, pass_through, is_external, sort) values ${kinds
      .map(([c, l, r, pt, ext, s]) => `(${U(t)}, '${c}', ${T(l)}, ${BOOL(r)}, ${BOOL(pt)}, ${BOOL(ext)}, ${s})`)
      .join(", ")};`);
  }

  // Account holders, with every spelling seen on screenshots.
  const H = {
    mogtaba: { id: uuid(), name: "Mogtaba Elsir", kind: "exchanger", aliases: ["Mogtaba Elsir", "Mujtaba Elsir", "Motgaba Elsir", "Mogtaba", "Mujtaba", "Motgaba", "Mugtaba El Sir", "مجتبى السر"] },
    hashim: { id: uuid(), name: "Hashim Elnour", kind: "exchanger", aliases: ["Hashim Elnour", "Hashem Elnour", "Hashim El Nour", "Hachim Alnour", "هاشم النور"] },
    omer: { id: uuid(), name: "Omer Karrar", kind: "exchanger", aliases: ["Omer Karrar", "Omar Karrar", "Umar Karar", "Omer Karar", "عمر كرار"] },
    babiker: { id: uuid(), name: "Babiker Saeed", kind: "exchanger", aliases: ["Babiker Saeed", "Babikir Saeed", "Babekir Said", "Babiker Said", "بابكر سعيد"] },
    company: { id: uuid(), name: "Nileray Solar Trading", kind: "company", aliases: ["Nileray Solar Trading", "Nileray Solar", "نايل راي"] },
    khalid: { id: uuid(), name: "Khalid Osman", kind: "relative", aliases: ["Khalid Osman", "Khaled Osman", "خالد عثمان"] },
  };
  for (const h of Object.values(H)) {
    sql(`insert into public.account_holders (id, tenant_id, display_name, kind, phone) values (${U(h.id)}, ${U(TENANT)}, ${T(h.name)}, '${h.kind}', '${PHONE}');`);
    // Spellings that normalise to the same form (Hashim Elnour, Hashim El Nour) are one alias.
    sql(`insert into public.holder_aliases (tenant_id, holder_id, alias) values ${h.aliases.map((a) => `(${U(TENANT)}, ${U(h.id)}, ${T(a)})`).join(", ")} on conflict (tenant_id, alias_norm) do nothing;`);
  }

  interface Acc { id: string; name: string; bank?: string; mask?: string; kind: string; holder?: string; currency: string; limit?: number; route?: string; forwards?: string }
  const LIMIT = 1500000000; // 15,000,000.00 SDG
  const A: Record<string, Acc> = {
    mogBok: { id: uuid(), name: "Mogtaba · Bank of Khartoum", bank: "Bank of Khartoum (Bankak)", mask: "••4412", kind: "exchanger", holder: H.mogtaba.id, currency: "SDG", limit: LIMIT, route: "Mogtaba Elsir" },
    mogFib: { id: uuid(), name: "Mogtaba · Faisal Islamic", bank: "Faisal Islamic Bank", mask: "••0937", kind: "exchanger", holder: H.mogtaba.id, currency: "SDG", limit: LIMIT, route: "Mogtaba Elsir" },
    hashim: { id: uuid(), name: "Hashim · Omdurman National", bank: "Omdurman National Bank", mask: "••2208", kind: "exchanger", holder: H.hashim.id, currency: "SDG", limit: LIMIT, route: "Hashim Elnour" },
    omer: { id: uuid(), name: "Omer · Bank of Khartoum", bank: "Bank of Khartoum (Bankak)", mask: "••7781", kind: "exchanger", holder: H.omer.id, currency: "SDG", limit: LIMIT, route: "Omer Karrar" },
    babiker: { id: uuid(), name: "Babiker · Al Baraka", bank: "Al Baraka Bank Sudan", mask: "••5530", kind: "exchanger", holder: H.babiker.id, currency: "SDG", limit: LIMIT, route: "Babiker Saeed" },
    own: { id: uuid(), name: "Nileray · Bank of Khartoum", bank: "Bank of Khartoum (Bankak)", mask: "••1019", kind: "own", holder: H.company.id, currency: "SDG", limit: LIMIT },
    khalid: { id: uuid(), name: "Khalid Osman (pass-through)", bank: "Bank of Khartoum (Bankak)", mask: "••6621", kind: "pass_through", holder: H.khalid.id, currency: "SDG", limit: LIMIT },
    awxEur: { id: uuid(), name: "Airwallex UAE · EUR", bank: "Airwallex (UAE)", mask: "••EUR1", kind: "foreign", holder: H.company.id, currency: "EUR", route: "Airwallex (UAE)" },
    awxAed: { id: uuid(), name: "Airwallex UAE · AED", bank: "Airwallex (UAE)", mask: "••AED1", kind: "foreign", holder: H.company.id, currency: "AED", route: "Airwallex (UAE)" },
    cash: { id: uuid(), name: "Cash with staff", kind: "staff_cash", currency: "SDG" },
    custSdg: { id: uuid(), name: "Customers (SDG)", kind: "customers", currency: "SDG" },
    supEur: { id: uuid(), name: "Suppliers (EUR)", kind: "suppliers", currency: "EUR" },
    supSdg: { id: uuid(), name: "Suppliers and customs (SDG)", kind: "suppliers", currency: "SDG" },
    expSdg: { id: uuid(), name: "Expenses (SDG)", kind: "expenses", currency: "SDG" },
    expEur: { id: uuid(), name: "Expenses (EUR)", kind: "expenses", currency: "EUR" },
    openSdg: { id: uuid(), name: "Opening balances (SDG)", kind: "opening", currency: "SDG" },
    openEur: { id: uuid(), name: "Opening balances (EUR)", kind: "opening", currency: "EUR" },
  };
  A.khalid!.forwards = A.mogBok!.id;
  for (const a of Object.values(A)) {
    sql(`insert into public.accounts (id, tenant_id, kind, holder_id, name, bank, number_masked, currency, daily_limit_minor, route_label, created_at)
      values (${U(a.id)}, ${U(TENANT)}, '${a.kind}', ${U(a.holder)}, ${T(a.name)}, ${T(a.bank)}, ${T(a.mask)}, '${a.currency}', ${a.limit ?? "null"}, ${T(a.route)}, '${ts(START, 0)}');`);
  }
  sql(`update public.accounts set forwards_to = ${U(A.mogBok!.id)} where id = ${U(A.khalid!.id)};`);
  const payIn = [A.mogBok!, A.mogFib!, A.hashim!, A.omer!, A.babiker!];

  // Products and prices
  sql(`insert into public.products (id, tenant_id, sku, name, category, brand, spec, min_stock) values ${PRODUCTS.map(
    (p) => `(${U(p.id)}, ${U(TENANT)}, ${T(p.sku)}, ${T(p.name)}, '${p.category}', ${T(p.brand)}, ${T(p.spec)}, ${p.min})`,
  ).join(", ")};`);
  sql(`insert into public.product_prices (product_id, tenant_id, price_usd_minor) values ${PRODUCTS.map((p) => `(${U(p.id)}, ${U(TENANT)}, ${p.price})`).join(", ")};`);

  // Reference rates for every day (EUR and AED for reporting, SDG market rate for valuing pounds)
  const rateRows: string[] = [];
  for (let i = START - 60; i <= 0; i++) {
    const m = market[Math.max(i, START)]!;
    rateRows.push(`(${U(TENANT)}, '${day(i)}', 'EUR', ${eurPpm(i)}, ${U(PEOPLE.owner.id)}, '${ts(Math.min(i, 0), 1)}')`);
    rateRows.push(`(${U(TENANT)}, '${day(i)}', 'AED', ${AED_PPM}, ${U(PEOPLE.owner.id)}, '${ts(Math.min(i, 0), 1)}')`);
    rateRows.push(`(${U(TENANT)}, '${day(i)}', 'SDG', ${BigInt(m) * 1000000n}, ${U(PEOPLE.owner.id)}, '${ts(Math.min(i, 0), 1)}')`);
  }
  sql(`insert into public.reference_rates (tenant_id, rate_date, currency, per_usd_ppm, set_by, set_at) values ${rateRows.join(", ")};`);
  sql(`insert into public.reference_rates (tenant_id, rate_date, currency, per_usd_ppm, set_by, set_at) values (${U(DEALER_TENANT)}, '${day(-20)}', 'EUR', ${eurPpm(-20)}, ${U(PEOPLE.dealer.id)}, '${ts(-20, 0)}');`);

  // Labels
  const LABELS = { onTime: uuid(), slow: uuid(), pumps: uuid(), network: uuid(), price: uuid(), new: uuid(), showroom: uuid() };
  sql(`insert into public.labels (id, tenant_id, name, color) values
    (${U(LABELS.onTime)}, ${U(TENANT)}, 'Pays on time', 'green'), (${U(LABELS.slow)}, ${U(TENANT)}, 'Slow payer', 'red'),
    (${U(LABELS.pumps)}, ${U(TENANT)}, 'Pump specialist', 'blue'), (${U(LABELS.network)}, ${U(TENANT)}, 'Large installer network', 'violet'),
    (${U(LABELS.price)}, ${U(TENANT)}, 'Price sensitive', 'amber'), (${U(LABELS.new)}, ${U(TENANT)}, 'New in 2026', 'slate'),
    (${U(LABELS.showroom)}, ${U(TENANT)}, 'Visits the showroom', 'teal');`);

  // Customers: the three dealers of the trial task, then the rest of the network (570 in all)
  const customers: Customer[] = [
    { id: uuid(), name: "Ahmed Trading", city: "Khartoum", adviser: PEOPLE.amira.id, segment: "A+", contact: "Ahmed Elhassan" },
    { id: uuid(), name: "Nile Solar", city: "Omdurman", adviser: PEOPLE.amira.id, segment: "A", contact: "Mona Ibrahim" },
    { id: uuid(), name: "Dongola Power", city: "Dongola", adviser: PEOPLE.nusiba.id, segment: "A+", contact: "Yasir Babiker" },
  ];
  const usedNames = new Set(customers.map((c) => c.name));
  while (customers.length < 570) {
    const north = chance(0.34);
    const city = pick(north ? CITIES_NUSIBA : CITIES_AMIRA);
    let name = chance(0.2) ? `${pick(FIRST)} ${pick(LAST)} ${pick(["Solar", "Trading", "& Sons", "Electric"])}` : `${pick(NAME_A)} ${pick(NAME_B)}`;
    if (usedNames.has(name)) name = `${name} ${city}`;
    if (usedNames.has(name)) continue;
    usedNames.add(name);
    customers.push({
      id: uuid(),
      name,
      city,
      adviser: north ? PEOPLE.nusiba.id : PEOPLE.amira.id,
      segment: weighted([["A+", 3], ["A", 9], ["B", 24], ["C", 40], ["D", 24]] as const),
      contact: `${pick(FIRST)} ${pick(LAST)}`,
    });
  }
  const custRows: string[] = [];
  const contactRows: string[] = [];
  const labelRows: string[] = [];
  customers.forEach((c, n) => {
    const pipeline = c.segment === "D" ? weighted([["dormant", 3], ["lead", 2], ["contacted", 2], ["active", 3]] as const) : weighted([["active", 12], ["quoted", 1], ["dormant", 1]] as const);
    const source = weighted([["existing_network", 6], ["referral", 5], ["whatsapp", 4], ["walk_in", 2], ["facebook", 2], ["exhibition", 1], ["field_visit", 2]] as const);
    const kind = chance(0.35) ? "installer" : "dealer";
    const created = START - between(30, 900);
    custRows.push(`(${U(c.id)}, ${U(TENANT)}, 'C-${String(n + 1).padStart(5, "0")}', ${T(c.name)}, '${kind}', ${T(c.city)}, ${T(c.contact)}, ${U(c.adviser)}, '${c.segment}', '${pipeline}', '${source}', '${new Date(today + created * DAY_MS).toISOString()}')`);
    contactRows.push(`(${U(TENANT)}, ${U(c.id)}, 'whatsapp', '${PHONE}', true, true)`);
    const labels = new Set<string>();
    if (c.segment === "A+" || c.segment === "A") if (chance(0.6)) labels.add(LABELS.onTime);
    if (chance(0.08)) labels.add(LABELS.slow);
    if (chance(0.12)) labels.add(LABELS.pumps);
    if (c.segment !== "D" && chance(0.1)) labels.add(LABELS.network);
    if (chance(0.15)) labels.add(LABELS.price);
    if (created > -400 && chance(0.4)) labels.add(LABELS.new);
    if (chance(0.1)) labels.add(LABELS.showroom);
    for (const l of labels) labelRows.push(`(${U(c.id)}, ${U(l)}, ${U(TENANT)})`);
  });
  sql(`insert into public.customers (id, tenant_id, code, name, kind, city, contact_name, adviser_id, segment, pipeline, source, created_at) values ${custRows.join(",\n")};`);
  sql(`insert into public.customer_contacts (tenant_id, customer_id, channel, value, is_primary, whatsapp_opt_in) values ${contactRows.join(",\n")};`);
  sql(`insert into public.customer_labels (customer_id, label_id, tenant_id) values ${labelRows.join(",\n")};`);
  sql(`insert into public.counters (tenant_id, name, value) values (${U(TENANT)}, 'customer', ${customers.length});`);

  // ---------------------------------------------------------------- the simulation
  const own = PEOPLE.owner.id;
  const wh = PEOPLE.tarig.id;
  const stock: Record<string, number> = Object.fromEntries(PRODUCTS.map((p) => [p.id, 0]));
  const committed: Record<string, number> = Object.fromEntries(PRODUCTS.map((p) => [p.id, 0]));
  const intake: Record<string, number> = {}; // account|day -> minor
  const room = (acc: Acc, i: number) => (acc.limit ?? LIMIT) - (intake[`${acc.id}|${i}`] ?? 0);

  // Opening balances
  call(own, ts(START, 5), "record_movement", { p_kind: T("opening"), p_day: D(day(START)), p_from: U(A.openSdg!.id), p_from_amount: B(420_000_000_00), p_to: U(A.own!.id), p_memo: T("Opening balance") });
  call(own, ts(START, 6), "record_movement", { p_kind: T("opening"), p_day: D(day(START)), p_from: U(A.openEur!.id), p_from_amount: B(210_000_00), p_to: U(A.awxEur!.id), p_memo: T("Opening balance") });

  // Shipments. Purchase prices per unit (invoice currency) and costs; S-2026-014 is the current
  // shipment of the brief, where a $270 inverter lands at $303.58.
  interface Ship { ref: string; supplier: string; origin: string; ordered: number; received: number | null; eta: number; currency: "USD" | "EUR"; usdPerEur?: number; commissionBps?: number;
    lines: [string, number, number][]; costs: [string, number, string, number, number | null][] }
  const SHIPS: Ship[] = [
    { ref: "S-2026-011", supplier: "Sunvolt Import & Export", origin: "Ningbo → Port Sudan", ordered: -150, received: -104, eta: -106, currency: "USD",
      lines: [["SPF-5000-ES", 160, 300], ["SPF-6000-ESP", 130, 345], ["SPE-12000-ES", 50, 650], ["SPH-10K-TL3", 20, 1020], ["GEL-200-12", 300, 150], ["BOS-MNT-4", 400, 26], ["BOS-MC4-20", 300, 9], ["BOS-PV-6MM", 120, 62]],
      costs: [["freight", 1180000, "USD", -128, null], ["insurance", 55000, "USD", -140, null], ["customs", 3640000000, "SDG", -108, 6150], ["clearance", 540000, "AED", -107, null], ["transport", 520000000, "SDG", -105, 6150]] },
    { ref: "S-2026-012", supplier: "Longray Solar Materials", origin: "Shanghai → Port Sudan", ordered: -120, received: -78, eta: -80, currency: "USD",
      lines: [["PNL-550-MONO", 1400, 52], ["PNL-585-NBF", 1000, 61], ["PNL-450-MONO", 700, 43], ["PMP-1.5HP-SF", 60, 430], ["PMP-7.5HP-SUB", 20, 1650], ["AC-18K-HYB", 40, 700]],
      costs: [["freight", 1420000, "USD", -100, null], ["insurance", 48000, "USD", -115, null], ["customs", 4180000000, "SDG", -82, 6480], ["clearance", 610000, "AED", -81, null], ["transport", 690000000, "SDG", -79, 6480]] },
    { ref: "S-2026-013", supplier: "Hope Energy Storage GmbH", origin: "Hamburg → Jebel Ali → Port Sudan", ordered: -95, received: -52, eta: -54, currency: "EUR", usdPerEur: 1162000, commissionBps: 80,
      lines: [["HOPE-5.0L-B1", 180, 46800], ["HOPE-16.0LM-A1", 60, 119500], ["HOPE-10.0L-C1", 40, 80000]].map(([s, q, eurCents]) => [s as string, q as number, (eurCents as number) / 100]) as [string, number, number][],
      costs: [["freight", 890000, "EUR", -70, 862000], ["insurance", 110000, "USD", -90, null], ["customs", 7920000000, "SDG", -56, 7120], ["clearance", 720000, "AED", -55, null], ["transport", 610000000, "SDG", -53, 7120]] },
    { ref: "S-2026-014", supplier: "Sunvolt Import & Export", origin: "Ningbo → Port Sudan", ordered: -70, received: -30, eta: -33, currency: "USD",
      lines: [["SPF-3500-ES", 200, 270], ["SPF-6000-ESP", 140, 345], ["SPE-12000-ES", 55, 650], ["AC-12K-DC", 60, 520], ["PMP-3HP-SUB", 40, 860], ["BOS-PV-6MM", 150, 62], ["BOS-CMB-BOX", 235, 30]],
      costs: [["freight", 1240000, "USD", -50, null], ["insurance", 66000, "USD", -65, null], ["customs", 4498000000, "SDG", -34, 7700], ["clearance", 918000, "AED", -33, null], ["transport", 1080000000, "SDG", -31, 7700]] },
    { ref: "S-2026-015", supplier: "Longray Solar Materials", origin: "Shanghai → Port Sudan", ordered: -40, received: null, eta: 12, currency: "USD",
      lines: [["PNL-550-MONO", 1500, 51], ["PNL-585-NBF", 800, 60], ["HOPE-5.0L-B1", 100, 548], ["SPF-6000-ESP", 150, 345], ["AC-12K-DC", 40, 520]],
      costs: [["freight", 1390000, "USD", -12, null], ["insurance", 52000, "USD", -35, null]] },
  ];
  const shipIds: Record<string, string> = {};
  const shipEvents: Record<number, (() => void)[]> = {};
  const on = (i: number, fn: () => void) => (shipEvents[i] ??= []).push(fn);
  // Shipments ordered before the window are entered on its first day.
  for (const s of SHIPS) {
    const createDay = Math.max(s.ordered, START);
    on(createDay, () => {
      const lines = s.lines.map(([sku, qty, unit]) => ({ product_id: bySku[sku]!.id, qty, unit_price_minor: Math.round(unit * 100) }));
      setWho(own, ts(createDay, 20));
      sql(`select set_config('seed.ship_${s.ref.replace(/-/g, "_")}', public.create_shipment(p_ref => ${T(s.ref)}, p_supplier => ${T(s.supplier)}, p_origin => ${T(s.origin)}, p_ordered_on => ${D(day(s.ordered))}, p_eta => ${D(day(s.eta))}, p_invoice_currency => ${T(s.currency)}, p_usd_per_eur_ppm => ${s.usdPerEur ? B(s.usdPerEur) : "null"}, p_commission_bps => ${I(s.commissionBps ?? 0)}, p_lines => ${J(lines)})::text, false);`);
      shipIds[s.ref] = `current_setting('seed.ship_${s.ref.replace(/-/g, "_")}')::uuid`;
    });
    for (const [kind, amount, cur, when, rate] of s.costs) {
      on(Math.max(when, START), () => {
        const ratePpm = rate == null ? "null" : cur === "EUR" ? B(rate) : B(rate * 1000000);
        call(own, ts(Math.max(when, START), 30), "add_shipment_cost", { p_shipment: lit(shipIds[s.ref]!), p_kind: T(kind), p_amount_minor: B(amount), p_currency: T(cur), p_incurred_on: D(day(when)), p_rate_ppm: lit(String(ratePpm)) });
        if (cur === "SDG") {
          call(own, ts(Math.max(when, START), 31), "record_movement", { p_kind: T("supplier_payment"), p_day: D(day(Math.max(when, START))), p_from: U(A.own!.id), p_from_amount: B(amount), p_to: U(A.supSdg!.id), p_memo: T(`${s.ref} ${kind}`), p_shipment: lit(shipIds[s.ref]!) });
        }
      });
    }
    if (s.received !== null) {
      const r = s.received;
      on(r - 3, () => call(wh, ts(r - 3, 60), "set_shipment_status", { p_shipment: lit(shipIds[s.ref]!), p_status: T("arrived"), p_day: D(day(r - 3)) }));
      on(r, () => {
        call(own, ts(r, 40), "finalise_landed_cost", { p_shipment: lit(shipIds[s.ref]!) });
        call(wh, ts(r, 90), "receive_shipment", { p_shipment: lit(shipIds[s.ref]!), p_day: D(day(r)) });
        for (const [sku, qty] of s.lines) stock[bySku[sku]!.id]! += qty;
      });
    } else {
      on(-25, () => call(wh, ts(-25, 60), "set_shipment_status", { p_shipment: lit(shipIds[s.ref]!), p_status: T("in_transit"), p_day: D(day(-25)) }));
    }
  }
  // Supplier payments from the UAE account
  const supplierPays: [number, number, string][] = [[-96, 105_000_00, "S-2026-011 balance"], [-88, 70_000_00, "S-2026-013 deposit"], [-60, 82_000_00, "S-2026-013 balance"], [-68, 45_000_00, "S-2026-014 deposit"], [-36, 90_000_00, "S-2026-014 balance"], [-38, 35_000_00, "S-2026-015 deposit"]];
  for (const [i, eur, memo] of supplierPays) {
    on(i, () => call(own, ts(i, 200), "record_movement", { p_kind: T("supplier_payment"), p_day: D(day(i)), p_from: U(A.awxEur!.id), p_from_amount: B(eur), p_to: U(A.supEur!.id), p_memo: T(memo) }));
  }

  // Minimum rate: the owner raises it as the pound falls. Three days ago: 8,000.
  const minChanges = [-96, -82, -68, -54, -40, -26, -12];
  const minRates: Record<number, number> = {};
  for (const i of minChanges) minRates[i] = Math.floor((market[i]! * 0.975) / 50) * 50;
  minRates[-3] = 8000;
  let minRate = 5900;

  // Orders
  interface Order { id: string; number?: string; customer: Customer; day: number; total: number; totalUsd: number; paid: number; lines: { product: Product; qty: number }[]; paidDay?: number; released: boolean; kind: "order" | "quote" }
  const openByCustomer = new Map<string, Order[]>();
  const orders: Order[] = [];
  const weightsBySeg = { "A+": 14, A: 6, B: 2.5, C: 1, D: 0.3 } as const;
  const custWeights = customers.map((c) => [c, weightsBySeg[c.segment]] as const);

  function basket(c: Customer): { sku: string; qty: number }[] {
    const scale = { "A+": 1.6, A: 1.3, B: 1, C: 0.8, D: 0.6 }[c.segment];
    const q = (lo: number, hi: number) => Math.max(1, Math.round(between(lo, hi) * scale));
    const kind = weighted([["hybrid", 5], ["panels", 3], ["pump", 1.4], ["ac", 1], ["big", 0.6]] as const);
    if (kind === "hybrid") {
      const inv = pick(["SPF-6000-ESP", "SPF-6000-ESP", "SPF-5000-ES", "SPF-3500-ES", "SPE-12000-ES"]);
      const bat = pick(["HOPE-5.0L-B1", "HOPE-5.0L-B1", "HOPE-10.0L-C1", "GEL-200-12", "HOPE-16.0LM-A1"]);
      const b: { sku: string; qty: number }[] = [{ sku: inv, qty: q(1, 4) }, { sku: bat, qty: bat === "GEL-200-12" ? q(4, 12) : q(1, 3) }];
      if (chance(0.45)) b.push({ sku: pick(["PNL-550-MONO", "PNL-585-NBF"]), qty: q(8, 30) });
      if (chance(0.3)) b.push({ sku: pick(["BOS-PV-6MM", "BOS-CMB-BOX", "BOS-MNT-4", "BOS-MC4-20"]), qty: q(2, 8) });
      return b;
    }
    if (kind === "panels") return [{ sku: pick(["PNL-550-MONO", "PNL-585-NBF", "PNL-450-MONO"]), qty: q(20, 70) }, { sku: "BOS-MNT-4", qty: q(5, 15) }, ...(chance(0.5) ? [{ sku: "BOS-PV-6MM", qty: q(1, 4) }] : [])];
    if (kind === "pump") return [{ sku: pick(["PMP-1.5HP-SF", "PMP-3HP-SUB", "PMP-3HP-SUB", "PMP-7.5HP-SUB"]), qty: q(1, 2) }, { sku: "PNL-550-MONO", qty: q(8, 24) }];
    if (kind === "ac") return [{ sku: pick(["AC-12K-DC", "AC-18K-HYB"]), qty: q(1, 4) }, { sku: "PNL-585-NBF", qty: q(4, 12) }];
    return [{ sku: "SPH-10K-TL3", qty: q(1, 2) }, { sku: "HOPE-16.0LM-A1", qty: q(1, 3) }, { sku: "PNL-585-NBF", qty: q(20, 40) }];
  }

  function discountFor(value: number): { disc: number; blocked: boolean } {
    const r = weighted([["none", 56], ["sand", 27], ["red", 14], ["blocked", 3]] as const);
    if (r === "none" || value < 20000) return { disc: 0, blocked: false };
    const pct = r === "sand" ? 0.8 + rnd() * 2.1 : r === "red" ? 3.2 + rnd() * 1.7 : 5.4 + rnd() * 2.2;
    let disc = Math.floor((value * pct) / 100 / 500) * 500; // whole five dollars
    if (disc === 0) disc = 500;
    const line = lineOf({ qty: 1, unitPriceMinor: value, discountMinor: disc });
    return { disc, blocked: line.tier === "blocked" };
  }

  function makeOrder(i: number, minute: number, c: Customer, kind: "order" | "quote"): Order | null {
    const wanted = basket(c);
    const merged = new Map<string, number>();
    for (const w of wanted) merged.set(w.sku, (merged.get(w.sku) ?? 0) + w.qty);
    const lines: { product: Product; qty: number; disc: number; blocked: boolean; line: LineResult }[] = [];
    for (const [sku, qty] of merged) {
      const p = bySku[sku]!;
      const free = stock[p.id]! - committed[p.id]!;
      const take = Math.min(qty, free);
      if (take <= 0) continue;
      const { disc, blocked } = discountFor(take * p.price);
      lines.push({ product: p, qty: take, disc, blocked, line: lineOf({ qty: take, unitPriceMinor: p.price, discountMinor: disc }) });
    }
    if (lines.length === 0) return null;
    const rate = Math.max(minRate, Math.round((market[i]! * (1.025 + rnd() * 0.02)) / 10) * 10);
    const totals = totalsOf(lines.map((l) => l.line), rate);
    const id = uuid();
    const who = c.adviser;
    let m = minute;
    const payload = lines.map((l) => {
      const base: Record<string, unknown> = { product_id: l.product.id, qty: l.qty, discount_usd_minor: l.disc };
      return base;
    });
    // Lines above 5% go through the owner first.
    lines.forEach((l, n) => {
      if (!l.blocked) return;
      const key = `seed.appr_${id.replace(/-/g, "")}_${n}`;
      setWho(who, ts(i, m));
      sql(`select set_config('${key}', public.request_discount_approval(p_draft => ${U(id)}, p_customer => ${U(c.id)}, p_product => ${U(l.product.id)}, p_qty => ${I(l.qty)}, p_discount_usd_minor => ${B(l.disc)}, p_note => ${T("Competing offer from another importer")})::text, false);`);
      call(own, ts(i, m + 25), "decide_discount_approval", { p_id: lit(`current_setting('${key}')::uuid`), p_approve: BOOL(true) });
      payload[n]!.approval_id = `__APPROVAL__${key}`;
      m += 30;
    });
    const payloadSql = `jsonb_build_array(${payload
      .map((p) => {
        const approval = typeof p.approval_id === "string" ? `, 'approval_id', current_setting('${(p.approval_id as string).replace("__APPROVAL__", "")}')` : "";
        return `jsonb_build_object('product_id', '${p.product_id}', 'qty', ${p.qty}, 'discount_usd_minor', ${p.discount_usd_minor}${approval})`;
      })
      .join(", ")})`;
    call(who, ts(i, m + 5), "save_order", { p_id: U(id), p_customer: U(c.id), p_rate_sdg: I(rate), p_lines: lit(payloadSql), p_kind: T(kind) });
    const o: Order = { id, customer: c, day: i, total: totals.totalSdg, totalUsd: totals.totalUsd, paid: 0, lines: lines.map((l) => ({ product: l.product, qty: l.qty })), released: false, kind };
    if (kind === "order") {
      for (const l of lines) committed[l.product.id]! += l.qty;
      const list = openByCustomer.get(c.id) ?? [];
      list.push(o);
      openByCustomer.set(c.id, list);
    }
    orders.push(o);
    return o;
  }

  // Receipts
  interface Rec { id: string; account: Acc; amount: number; day: number; recordedBy: string; forwarded: number | null; confirmed: boolean; allocations: { order: Order; amount: number }[] }
  const receipts: Rec[] = [];
  const bankCode = (acc: Acc, i: number) => {
    const d = day(i).replace(/-/g, "").slice(2);
    if (acc.bank?.startsWith("Bank of Khartoum")) return `FT${d}${String(between(10000, 99999))}`;
    if (acc.bank?.startsWith("Faisal")) return `${d}${String(between(100000, 999999))}`;
    if (acc.bank?.startsWith("Omdurman")) return `ONB${String(between(100000000, 999999999))}`;
    return `ABS-${d}-${String(between(1000, 9999))}`;
  };
  // An account's pounds that are confirmed and matched, waiting for the exchanger to pay out.
  const settleable: Record<string, { rec: Rec; amount: number }[]> = {};
  const payoutAccountOf = (acc: Acc) => (acc.forwards ? Object.values(A).find((a) => a.id === acc.forwards)! : acc);

  const conflictDays = new Set([-13, -12, -11, -2, -1]);
  function pay(i: number, minute: number, c: Customer, budget: number) {
    const open = (openByCustomer.get(c.id) ?? []).filter((o) => o.paid < o.total);
    let left = Math.min(budget, open.reduce((s, o) => s + (o.total - o.paid), 0));
    let m = minute;
    while (left > 0) {
      const target = chance(0.07) ? A.khalid! : chance(0.07) ? A.own! : pick(payIn.filter((a) => room(a, i) >= 50000000));
      if (!target) break;
      let amount = Math.min(left, chance(0.8) ? 300000000 : between(20, 58) * 5000000, room(target, i));
      if (amount <= 0) break;
      if (left - amount > 0 && left - amount < 10000000) amount = Math.min(left, 300000000, room(target, i)); // no tiny tails
      const allocations: { order: Order; amount: number }[] = [];
      let rest = amount;
      for (const o of open) {
        if (rest === 0) break;
        const take = Math.min(rest, o.total - o.paid);
        if (take <= 0) continue;
        allocations.push({ order: o, amount: take });
        o.paid += take;
        rest -= take;
        if (o.paid === o.total) o.paidDay = i;
      }
      intake[`${target.id}|${i}`] = (intake[`${target.id}|${i}`] ?? 0) + amount;
      const rec: Rec = { id: uuid(), account: target, amount, day: i, recordedBy: c.adviser, forwarded: null, confirmed: false, allocations };
      receipts.push(rec);
      const code = bankCode(target, i);
      const fromName = chance(0.8) ? c.contact : `${pick(FIRST)} ${pick(LAST)}`;
      call(c.adviser, ts(i, m), "record_receipt", {
        p_id: U(rec.id), p_customer: U(c.id), p_txn_code: T(code), p_amount_sdg_minor: B(amount), p_received_on: D(day(i)), p_from_name: T(fromName),
        p_to_account: U(target.id), p_proof_path: T(`seed/${rec.id}.png`), p_proof_sha256: T(hex(64)),
        p_allocations: J(allocations.map((a) => ({ order_id: a.order.id, sdg_minor: a.amount }))),
      });
      // Now and then a screenshot arrives twice with the amount misread: same code, other amount.
      if (conflictDays.has(i) && amount > 100000000) {
        conflictDays.delete(i);
        if (i >= -2) conflictDays.delete(i === -2 ? -1 : -2); // one open conflict near today
        call(c.adviser, ts(i, m + 40), "record_receipt", {
          p_id: U(uuid()), p_customer: U(c.id), p_txn_code: T(code), p_amount_sdg_minor: B(amount - 50000000), p_received_on: D(day(i)), p_from_name: T(fromName),
          p_to_account: U(target.id), p_proof_path: T(`seed/${rec.id}-again.png`), p_proof_sha256: T(hex(64)), p_allocations: J([]),
        });
      }
      left -= amount;
      m += between(3, 25);
      if (target === A.khalid) {
        // passed on to the exchanger the same evening, except today
        if (i < 0) endOfDay.push(() => call(own, ts(i, 560), "record_movement", { p_kind: T("transfer"), p_day: D(day(i)), p_from: U(A.khalid!.id), p_from_amount: B(amount), p_to: U(A.mogBok!.id), p_memo: T("Passed on to Mogtaba") }));
      }
    }
  }
  let endOfDay: (() => void)[] = [];
  const late: Record<number, (() => void)[]> = {};
  const on2 = (i: number, fn: () => void) => (late[i] ??= []).push(fn);

  // Payout schedule per exchanger account, and their conversion spread
  const spreads: Record<string, number> = { [A.mogBok!.id]: 0.006, [A.mogFib!.id]: 0.006, [A.hashim!.id]: 0.011, [A.omer!.id]: 0.004, [A.babiker!.id]: 0.009 };
  const nextPayout: Record<string, number> = Object.fromEntries(payIn.map((a) => [a.id, START + between(8, 14)]));

  // ---------------------------------------------------------------- day by day
  for (let i = START; i <= 0; i++) {
    for (const fn of shipEvents[i] ?? []) fn();
    if (minRates[i]) {
      minRate = minRates[i]!;
      call(own, ts(i, 2), "update_settings", { p: J({ min_rate_sdg: minRate }) });
    }
    const work = isWorkday(i);

    // Morning: the owner confirms what was forwarded yesterday (exchangers confirm by WhatsApp)
    if (work) {
      const toConfirm = receipts.filter((r) => r.forwarded !== null && r.forwarded < i && !r.confirmed);
      if (toConfirm.length) {
        call(own, ts(i, 15), "set_receipt_status", { p_ids: lit(`array[${toConfirm.map((r) => `'${r.id}'`).join(",")}]::uuid[]`), p_status: T("confirmed") });
        for (const r of toConfirm) {
          r.confirmed = true;
          const pa = payoutAccountOf(r.account);
          if (pa.kind === "exchanger") for (const a of r.allocations) (settleable[pa.id] ??= []).push({ rec: r, amount: a.amount });
        }
      }
      // The warehouse releases orders that were fully paid by yesterday
      for (const o of orders) {
        if (o.kind === "order" && !o.released && o.paidDay !== undefined && o.paidDay < i && (o.paidDay < i - 1 || (i < 0 && chance(0.7)))) {
          call(wh, ts(i, 70 + between(0, 200)), "release_order", { p_order: U(o.id) });
          o.released = true;
          for (const l of o.lines) {
            stock[l.product.id]! -= l.qty;
            committed[l.product.id]! -= l.qty;
          }
        }
      }
    }

    // Orders and quotes
    if (work && i >= START + 6) {
      const n = i === 0 ? 3 : pick([1, 1, 2, 2, 2, 2, 3]);
      for (let k = 0; k < n; k++) {
        const c = i === 0 && k === 0 ? customers[1]! : weighted(custWeights);
        const quote = chance(0.12);
        const o = makeOrder(i, 60 + k * 90, c, quote ? "quote" : "order");
        if (o && quote && i < -2 && chance(0.75)) {
          // converted within its validity, keeping the quoted rate
          const conv = i + between(1, 2);
          on2(conv, () => {
            const newId = uuid();
            call(c.adviser, ts(conv, 120), "convert_quote", { p_quote: U(o.id), p_new_id: U(newId) });
            const converted: Order = { ...o, id: newId, kind: "order", day: conv, paid: 0 };
            for (const l of converted.lines) committed[l.product.id]! += l.qty;
            const list = openByCustomer.get(c.id) ?? [];
            list.push(converted);
            openByCustomer.set(c.id, list);
            orders.push(converted);
          });
        }
      }
    }
    for (const fn of late[i] ?? []) fn();

    // Payments by dealers with open orders
    if (work) {
      for (const [cid, list] of openByCustomer) {
        const open = list.filter((o) => o.paid < o.total && o.day <= i);
        if (!open.length) continue;
        const age = i - open[0]!.day;
        const p = age === 0 ? 0.45 : age === 1 ? 0.55 : age <= 4 ? 0.6 : 0.9;
        if (i === 0 && age === 0) continue;
        if (!chance(p)) continue;
        const c = open[0]!.customer;
        if (i === 0 && (age < 2 || chance(0.5))) continue; // today is still young
        const slow = age < 3 && chance(0.35);
        pay(i, 200 + between(0, 150), c, i === 0 ? between(1, 3) * 300000000 : slow ? between(2, 5) * 300000000 : Number.MAX_SAFE_INTEGER);
        void cid;
      }
    }

    // Forwarding: advisers tell the exchanger which transfers are ours. Mostly the same day.
    if (work) {
      for (const adviser of [PEOPLE.amira.id, PEOPLE.nusiba.id]) {
        const due = receipts.filter((r) => r.recordedBy === adviser && r.forwarded === null && (r.day === i ? chance(0.85) : r.day < i && (i < -4 || chance(0.5))));
        const forgotten = i >= -3 ? due.filter(() => chance(0.08)) : [];
        const send = due.filter((r) => !forgotten.includes(r));
        if (send.length) {
          call(adviser, ts(i, 520), "set_receipt_status", { p_ids: lit(`array[${send.map((r) => `'${r.id}'`).join(",")}]::uuid[]`), p_status: T("forwarded") });
          for (const r of send) r.forwarded = i;
        }
      }
    }

    // Exchanger payouts in euros (Babiker pays in dirhams to the UAE account)
    for (const acc of payIn) {
      if (i < nextPayout[acc.id]! || !work || i === 0) continue;
      const items = settleable[acc.id] ?? [];
      const sdg = items.reduce((s, x) => s + x.amount, 0);
      if (sdg > 0) {
        const usdCents = Math.floor(sdg / (market[i]! * (1 + spreads[acc.id]!)));
        if (acc === A.babiker) {
          const aed = Math.floor((usdCents * AED_PPM) / 1000000);
          call(own, ts(i, 450), "record_payout", { p_day: D(day(i)), p_from_account: U(acc.id), p_sdg_minor: B(sdg), p_to_account: U(A.awxAed!.id), p_to_amount: B(aed), p_memo: T("Payout in AED") });
        } else {
          const eur = Math.floor((usdCents * eurPpm(i)) / 1000000);
          call(own, ts(i, 450), "record_payout", { p_day: D(day(i)), p_from_account: U(acc.id), p_sdg_minor: B(sdg), p_to_account: U(A.awxEur!.id), p_to_amount: B(eur), p_memo: T("Payout in EUR") });
        }
        settleable[acc.id] = [];
      }
      nextPayout[acc.id] = i + between(4, 7);
    }

    // Weekly: the UAE account converts dirhams to euros; staff take cash for fuel and transport
    if (new Date(dayMs(i)).getUTCDay() === 4) {
      if (i > START) {
        call(own, ts(i, 470), "record_movement", { p_kind: T("cash_withdrawal"), p_day: D(day(i)), p_from: U(A.own!.id), p_from_amount: B(between(12, 20) * 10000000), p_to: U(A.cash!.id), p_memo: T("Cash for the week") });
        call(own, ts(i, 480), "record_movement", { p_kind: T("expense"), p_day: D(day(i)), p_from: U(A.cash!.id), p_from_amount: B(between(8, 11) * 10000000), p_to: U(A.expSdg!.id), p_category: T("Fuel and transport"), p_memo: T("Deliveries and generator fuel") });
      }
    }
    for (const fn of endOfDay) fn();
    endOfDay = [];
    if (new Date(dayMs(i)).getUTCDate() === 1) {
      call(own, ts(i, 30), "record_movement", { p_kind: T("expense"), p_day: D(day(i)), p_from: U(A.own!.id), p_from_amount: B(450000000), p_to: U(A.expSdg!.id), p_category: T("Rent"), p_memo: T("Warehouse and showroom, Omdurman") });
      call(own, ts(i, 32), "record_movement", { p_kind: T("expense"), p_day: D(day(i)), p_from: U(A.own!.id), p_from_amount: B(2150000000), p_to: U(A.expSdg!.id), p_category: T("Salaries"), p_memo: T("Team of five") });
      call(own, ts(i, 34), "record_movement", { p_kind: T("expense"), p_day: D(day(i)), p_from: U(A.awxEur!.id), p_from_amount: B(4500), p_to: U(A.expEur!.id), p_category: T("Bank fees"), p_memo: T("Airwallex monthly fees") });
    }
  }

  // AED held on the UAE account converted to euros, twice in the period
  for (const i of [-40, -9]) {
    // amount: what is on the AED account by then; the database refuses nothing here, so keep it modest
    call(own, ts(i, 500), "record_movement", { p_kind: T("conversion"), p_day: D(day(i)), p_from: U(A.awxAed!.id), p_from_amount: B(i === -40 ? 7000000 : 8000000), p_to: U(A.awxEur!.id), p_to_amount: B(Math.floor(((i === -40 ? 7000000 : 8000000) * 1000000) / AED_PPM * eurPpm(i) / 1000000 * 0.9965)), p_memo: T("AED to EUR on Airwallex") });
  }

  // A refund: one inverter came back damaged in transit; refunded in pounds at the order's rate
  const refunded = orders.find((o) => o.released && o.day < -40 && o.lines.some((l) => l.product.category === "inverter"));
  if (refunded) {
    const inv = refunded.lines.find((l) => l.product.category === "inverter")!;
    const rate = Math.round(refunded.total / refunded.totalUsd);
    call(own, ts(-38, 300), "record_movement", { p_kind: T("refund"), p_day: D(day(-38)), p_from: U(A.own!.id), p_from_amount: B(Math.round(inv.product.price * 0.15) * rate), p_to: U(A.custSdg!.id), p_order: U(refunded.id), p_memo: T("Partial refund: inverter damaged in transit, repaired under warranty") });
  }

  // Statements for yesterday: every account agrees with the ledger except Hashim's, where a
  // forwarded transfer is missing from the exchanger's list. That's the contradiction to show.
  setWho(own, ts(0, 5));
  for (const a of [...payIn, A.own!, A.awxEur!, A.awxAed!]) {
    const diff = a === A.hashim ? `- coalesce((select amount_sdg_minor from public.receipts where to_account_id = ${U(a.id)} and received_on < ${D(day(0))} order by received_on desc, recorded_at desc limit 1), 0)` : "";
    sql(`select public.record_statement(p_account => ${U(a.id)}, p_as_of => ${D(day(-1))}, p_balance_minor => (private.balance(${U(a.id)}, ${D(day(-1))}) ${diff})::bigint);`);
  }

  // Resolve the earlier conflicts; the latest stays open for the owner.
  sql(`select public.resolve_conflict(p_id => k.id, p_resolution => 'Misread amount; the screenshot shows the recorded amount.')
       from public.receipt_conflicts k where k.raised_at < (select max(raised_at) from public.receipt_conflicts);`);

  // Today: a discount above 5% waiting for the owner
  const dongola = customers[2]!;
  setWho(PEOPLE.nusiba.id, ts(0, 500));
  sql(`select public.request_discount_approval(p_draft => ${U(uuid())}, p_customer => ${U(dongola.id)}, p_product => ${U(bySku["HOPE-16.0LM-A1"]!.id)}, p_qty => 2, p_discount_usd_minor => ${B(27000)}, p_note => 'Dongola Power has a competing quote for two 16 kWh batteries');`);

  // The dealer environment: its own branding, a small catalogue and one order.
  const dp = PEOPLE.dealer.id;
  const dpProducts = [uuid(), uuid()];
  const dpCustomers = [uuid(), uuid(), uuid()];
  sql(`insert into public.products (id, tenant_id, sku, name, category, brand, spec, min_stock) values
    (${U(dpProducts[0])}, ${U(DEALER_TENANT)}, 'DP-KIT-3K', 'Home kit 3 kW (installed)', 'inverter', 'Dongola Power', 'Inverter, 2 batteries, 6 panels, installation', 0),
    (${U(dpProducts[1])}, ${U(DEALER_TENANT)}, 'DP-PUMP-3HP', 'Farm pump 3 hp (installed)', 'pump', 'Dongola Power', 'Pump, 10 panels, installation', 0);`);
  sql(`insert into public.product_prices (product_id, tenant_id, price_usd_minor) values (${U(dpProducts[0])}, ${U(DEALER_TENANT)}, 185000), (${U(dpProducts[1])}, ${U(DEALER_TENANT)}, 260000);`);
  sql(`insert into public.customers (id, tenant_id, code, name, city, adviser_id, segment, created_at) values
    (${U(dpCustomers[0])}, ${U(DEALER_TENANT)}, 'C-00001', 'Wadi Halfa Farmers Cooperative', 'Wadi Halfa', null, 'A', '${ts(-20, 0)}'),
    (${U(dpCustomers[1])}, ${U(DEALER_TENANT)}, 'C-00002', 'Karima Health Centre', 'Karima', null, 'B', '${ts(-20, 0)}'),
    (${U(dpCustomers[2])}, ${U(DEALER_TENANT)}, 'C-00003', 'Merowe Date Farm', 'Merowe', null, 'B', '${ts(-20, 0)}');`);
  sql(`insert into public.customer_contacts (tenant_id, customer_id, channel, value, is_primary) values ${dpCustomers.map((c) => `(${U(DEALER_TENANT)}, ${U(c)}, 'whatsapp', '${PHONE}', true)`).join(", ")};`);
  sql(`insert into public.counters (tenant_id, name, value) values (${U(DEALER_TENANT)}, 'customer', 3);`);
  call(dp, ts(-2, 100), "save_order", { p_id: U(uuid()), p_customer: U(dpCustomers[0]), p_rate_sdg: I(8250), p_lines: J([{ product_id: dpProducts[1], qty: 2, discount_usd_minor: 0 }]), p_kind: T("order") });

  // Leave the session clean: no user, real clock.
  sql(`select set_config('request.jwt.claim.sub', '', false), set_config('app.clock', '', false);`);

  // Run in chunks so an error points at the statement that caused it.
  const CHUNK = 400;
  for (let k = 0; k < out.length; k += CHUNK) {
    const part = out.slice(k, k + CHUNK);
    try {
      await db.service.exec(part.join("\n"));
    } catch (e) {
      // find the failing statement
      for (const s of part) {
        try {
          await db.service.exec(s);
        } catch (e2) {
          throw new Error(`seed failed: ${(e2 as Error).message}\n${s.slice(0, 600)}`);
        }
      }
      throw e;
    }
  }
  return { orders: orders.length, receipts: receipts.length, statements: out.length };
}
