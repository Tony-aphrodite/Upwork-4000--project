/**
 * The acceptance checks. They run against a fresh database built from the same migrations (never
 * the demo data), in order, each building on the one before, the way the technical lead's
 * acceptance tests would walk through a feature. The same list runs in CI (vitest) and live on
 * the Checks page.
 */
import { acceptRate } from "@qirsh/money";
import { Database, DbError } from "./client";
import { buildFixture, F, iso } from "./fixture";

export type Area = "The trial task" | "Receipts and accounts" | "Stock" | "Permissions" | "Reports";
export const AREAS: Area[] = ["The trial task", "Receipts and accounts", "Stock", "Permissions", "Reports"];

export interface Check {
  id: string;
  area: Area;
  title: string;
  run: (ctx: Ctx) => Promise<string>;
}

export interface CheckResult {
  id: string;
  area: Area;
  title: string;
  ok: boolean;
  detail: string;
  ms: number;
}

interface Ctx {
  db: Database;
  shipment: string;
  ids: Record<string, string>;
}

// ------------------------------------------------------------------ helpers
let counter = 0;
function newId() {
  counter++;
  const tail = (Date.now().toString(16) + counter.toString(16).padStart(6, "0")).slice(-12).padStart(12, "0");
  return `c${Math.floor(Math.random() * 0xfffffff).toString(16).padStart(7, "0")}-0000-4000-8000-${tail}`;
}
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}
async function refused(p: Promise<unknown>, want: { hint?: string; code?: string; text?: RegExp }): Promise<string> {
  try {
    await p;
  } catch (e) {
    const err = e as DbError;
    if (want.hint && err.hint !== want.hint) throw new Error(`Refused, but for another reason: ${err.message}`);
    if (want.code && err.code !== want.code) throw new Error(`Refused with ${err.code}: ${err.message}`);
    if (want.text && !want.text.test(err.message)) throw new Error(`Refused with: ${err.message}`);
    return err.message;
  }
  throw new Error("It was allowed.");
}
const usd = (c: number) => `$${(c / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const sdg = (m: number) => `${(m / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })} SDG`;
const L1 = { product_id: F.products.spf6000, qty: 4, discount_usd_minor: 4000 };
const L2 = { product_id: F.products.hope5, qty: 2, discount_usd_minor: 7000 };
const L3 = { product_id: F.products.hope16, qty: 1, discount_usd_minor: 15000 };
type Order = { id: string; number: string; rate_sdg: number; total_usd_minor: number; total_sdg_minor: number; lines: { tier: string; total_usd_minor: number; approved_by?: string }[] };
/** Owner-level SQL for the checks' own bookkeeping (bypasses RLS). */
async function svc<T>(db: Database, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.service.query<T>(sql, params)).rows;
}
async function clock(db: Database, at: string | null) {
  await svc(db, "select set_config('app.clock', $1, false)", [at ?? ""]);
}
async function payInFull(db: Database, order: Order, customer: string, account = F.accounts.hashim, day?: string) {
  const adviser = db.as(F.adviser);
  let left = order.total_sdg_minor - (Number((await svc<{ p: number }>(db, "select paid_sdg_minor::float8 as p from orders where id = $1", [order.id]))[0]?.p) || 0);
  while (left > 0) {
    const amount = Math.min(left, 300000000);
    await adviser.rpc("record_receipt", {
      p_id: newId(), p_customer: customer, p_txn_code: `PAY${newId().slice(-10)}`, p_amount_sdg_minor: amount, p_received_on: day ?? iso(0),
      p_from_name: "Dealer", p_to_account: account, p_proof_path: "checks/proof.png", p_proof_sha256: newId() + newId(), p_allocations: [{ order_id: order.id, sdg_minor: amount }],
    });
    left -= amount;
  }
}

// ------------------------------------------------------------------ the checks
export const CHECKS: Check[] = [
  {
    id: "worked-without-line-3",
    area: "The trial task",
    title: "Worked example without line 3: $3,570, which is 29,274,000 SDG at 8,200, and it saves",
    async run({ db, ids }) {
      const o = await db.as(F.adviser).rpc<Order>("save_order", { p_id: (ids.o12 = newId()), p_customer: F.customers.ahmed, p_rate_sdg: 8200, p_lines: [L1, L2] });
      assert(o.total_usd_minor === 357000, `total ${usd(o.total_usd_minor)}`);
      assert(o.total_sdg_minor === 2927400000, `total ${sdg(o.total_sdg_minor)}`);
      assert(o.lines[0]!.tier === "sand" && o.lines[1]!.tier === "red", `colours ${o.lines.map((l) => l.tier)}`);
      assert(o.lines[0]!.total_usd_minor === 202000 && o.lines[1]!.total_usd_minor === 155000, "line totals");
      return `${o.number}: ${usd(o.total_usd_minor)} = ${sdg(o.total_sdg_minor)}; line 1 sand ($2,020), line 2 red ($1,550). Stored in cents: ${o.total_usd_minor}.`;
    },
  },
  {
    id: "blocked-line",
    area: "The trial task",
    title: "Line 3 at 7.25% blocks saving, even when the database is called directly",
    async run({ db, ids }) {
      ids.draft = newId();
      const msg = await refused(db.as(F.adviser).rpc("save_order", { p_id: ids.draft, p_customer: F.customers.ahmed, p_rate_sdg: 8200, p_lines: [L1, L2, L3] }), { hint: "approval_required" });
      const rows = await svc(db, "select 1 from orders where id = $1", [ids.draft]);
      assert(rows.length === 0, "an order row exists");
      return `Refused by save_order: "${msg}" Nothing was written.`;
    },
  },
  {
    id: "only-owner-approves",
    area: "The trial task",
    title: "Only the owner can approve a discount above 5%",
    async run({ db, ids }) {
      ids.approval = await db.as(F.adviser).rpc<string>("request_discount_approval", {
        p_draft: ids.draft, p_customer: F.customers.ahmed, p_product: F.products.hope16, p_qty: 1, p_discount_usd_minor: 15000,
      });
      const a = await refused(db.as(F.adviser).rpc("decide_discount_approval", { p_id: ids.approval, p_approve: true }), { code: "42501" });
      await refused(db.as(F.marketing).rpc("decide_discount_approval", { p_id: ids.approval, p_approve: true }), { code: "42501" });
      return `Adviser: "${a}" Marketing: refused too. The request waits for the owner.`;
    },
  },
  {
    id: "after-approval",
    area: "The trial task",
    title: "After the owner approves line 3: $5,490, which is 45,018,000 SDG",
    async run({ db, ids }) {
      await db.as(F.owner).rpc("decide_discount_approval", { p_id: ids.approval, p_approve: true });
      const o = await db.as(F.adviser).rpc<Order>("save_order", {
        p_id: ids.draft, p_customer: F.customers.ahmed, p_rate_sdg: 8200, p_lines: [L1, L2, { ...L3, approval_id: ids.approval }],
      });
      assert(o.total_usd_minor === 549000 && o.total_sdg_minor === 4501800000, `${usd(o.total_usd_minor)} ${sdg(o.total_sdg_minor)}`);
      assert(o.lines[2]!.tier === "approved", "line 3 not approved");
      ids.o123 = o.id;
      return `${o.number}: ${usd(o.total_usd_minor)} = ${sdg(o.total_sdg_minor)}. Line 3 ($1,920) is stored with the owner's approval.`;
    },
  },
  {
    id: "approval-is-exact",
    area: "The trial task",
    title: "An approval covers that exact line only; it can't be stretched or reused",
    async run({ db, ids }) {
      const draft = newId();
      const appr = await db.as(F.adviser).rpc<string>("request_discount_approval", { p_draft: draft, p_customer: F.customers.ahmed, p_product: F.products.hope16, p_qty: 1, p_discount_usd_minor: 15000 });
      await db.as(F.owner).rpc("decide_discount_approval", { p_id: appr, p_approve: true });
      const bigger = await refused(db.as(F.adviser).rpc("save_order", { p_id: draft, p_customer: F.customers.ahmed, p_rate_sdg: 8200, p_lines: [{ ...L3, discount_usd_minor: 16000, approval_id: appr }] }), { hint: "approval_required" });
      await refused(db.as(F.adviser).rpc("save_order", { p_id: newId(), p_customer: F.customers.ahmed, p_rate_sdg: 8200, p_lines: [{ ...L3, approval_id: appr }] }), { hint: "approval_required" });
      await refused(db.as(F.adviser).rpc("save_order", { p_id: newId(), p_customer: F.customers.ahmed, p_rate_sdg: 8200, p_lines: [{ ...L3, approval_id: ids.approval }] }), { hint: "approval_required" });
      return `$160 instead of the approved $150: "${bigger}" The same approval on another order, and the used one again: refused.`;
    },
  },
  {
    id: "rate-minimum",
    area: "The trial task",
    title: "A rate of 7,900 is refused and goes back to 8,000",
    async run({ db }) {
      const screen = acceptRate("7,900", 8000);
      assert(screen.rate === 8000 && screen.refused, "screen did not reset");
      const msg = await refused(db.as(F.adviser).rpc("save_order", { p_id: newId(), p_customer: F.customers.nile, p_rate_sdg: 7900, p_lines: [L1] }), { hint: "min_rate" });
      return `On the screen: 7,900 → 8,000. In the database: "${msg}"`;
    },
  },
  {
    id: "saved-order-fixed",
    area: "The trial task",
    title: "Change the rate setting to 9,000: the saved order still shows 8,200 and 45,018,000 SDG",
    async run({ db, ids }) {
      await db.as(F.owner).rpc("update_settings", { p: { min_rate_sdg: 9000 } });
      const o = await db.as(F.adviser).rpc<Order>("order_detail", { p_id: ids.o123 });
      const newRefused = await refused(db.as(F.adviser).rpc("save_order", { p_id: newId(), p_customer: F.customers.nile, p_rate_sdg: 8200, p_lines: [L1] }), { hint: "min_rate" });
      await db.as(F.owner).rpc("update_settings", { p: { min_rate_sdg: 8000 } });
      assert(o.rate_sdg === 8200 && o.total_sdg_minor === 4501800000, `now ${o.rate_sdg} and ${sdg(o.total_sdg_minor)}`);
      return `Reopened: ${o.number} at ${o.rate_sdg.toLocaleString("en-US")} = ${sdg(o.total_sdg_minor)}. A new order at 8,200 is refused while the minimum is 9,000 ("${newRefused}").`;
    },
  },
  {
    id: "nobody-edits",
    area: "The trial task",
    title: "Not even the owner, or a direct UPDATE, can change a saved order",
    async run({ db, ids }) {
      const a = await refused(db.service.query("update orders set rate_sdg = 9000, total_sdg_minor = total_usd_minor * 9000 where id = $1", [ids.o123]), {});
      const b = await refused(db.service.query("update order_lines set discount_usd_minor = 0 where order_id = $1", [ids.o123]), {});
      const c = await refused(db.service.query("delete from orders where id = $1", [ids.o123]), {});
      return `UPDATE orders: "${a}" UPDATE order_lines: "${b.split(";")[0]}". DELETE: "${c}"`;
    },
  },
  {
    id: "prices-fixed",
    area: "The trial task",
    title: "Prices are fixed: an adviser can't change one; the owner can, and it is marked",
    async run({ db }) {
      const msg = await refused(db.as(F.adviser).rpc("save_order", { p_id: newId(), p_customer: F.customers.nile, p_rate_sdg: 8200, p_lines: [{ ...L1, discount_usd_minor: 0, unit_price_usd_minor: 45000 }] }), { code: "42501" });
      const o = await db.as(F.owner).rpc<Order & { lines: { price_overridden: boolean; unit_price_usd_minor: number }[] }>("save_order", {
        p_id: newId(), p_customer: F.customers.nile, p_rate_sdg: 8200, p_lines: [{ ...L1, discount_usd_minor: 0, unit_price_usd_minor: 49000 }],
      });
      assert(o.lines[0]!.price_overridden && o.lines[0]!.unit_price_usd_minor === 49000, "owner override not recorded");
      return `Adviser: "${msg}" Owner: ${o.number} at $490 a unit, flagged as an override.`;
    },
  },
  {
    id: "idempotent",
    area: "The trial task",
    title: "The same save sent twice over a dropped connection is one order",
    async run({ db }) {
      const id = newId();
      const args = { p_id: id, p_customer: F.customers.nile, p_rate_sdg: 8300, p_lines: [L2] };
      const a = await db.as(F.adviser).rpc<Order>("save_order", args);
      const b = await db.as(F.adviser).rpc<Order>("save_order", args);
      const n = (await svc(db, "select 1 from orders where id = $1", [id])).length;
      assert(a.number === b.number && n === 1, "two orders");
      return `Both calls returned ${a.number}; one row.`;
    },
  },
  {
    id: "no-direct-writes",
    area: "The trial task",
    title: "Writing to the tables directly is refused: every write goes through a checked function",
    async run({ db }) {
      const a = await refused(db.as(F.adviser).query("insert into orders (id, tenant_id, number, kind, status, customer_id, adviser_id, rate_sdg, eur_per_usd_ppm, value_usd_minor, discount_usd_minor, total_usd_minor, total_sdg_minor, total_eur_minor, payload_hash, created_by, created_at) values (gen_random_uuid(), $1, 'X', 'order', 'confirmed', $2, $3, 8200, 1, 1, 0, 1, 8200, 1, 'x', $3, now())", [F.tenant, F.customers.ahmed, F.adviser]), { text: /permission/i });
      await refused(db.as(F.owner).query("update product_prices set price_usd_minor = 1"), { text: /permission/i });
      return `Adviser INSERT into orders: "${a}" Owner UPDATE on prices outside set_price: refused too.`;
    },
  },

  // ---------------------------------------------------------------- receipts and accounts
  {
    id: "receipt-two-orders",
    area: "Receipts and accounts",
    title: "One receipt pays two orders, and never more than either needs",
    async run({ db, ids }) {
      const adv = db.as(F.adviser);
      const o1 = await adv.rpc<Order>("save_order", { p_id: (ids.r1 = newId()), p_customer: F.customers.dongola, p_rate_sdg: 8200, p_lines: [{ product_id: F.products.spf3500, qty: 1, discount_usd_minor: 0 }] });
      const o2 = await adv.rpc<Order>("save_order", { p_id: (ids.r2 = newId()), p_customer: F.customers.dongola, p_rate_sdg: 8200, p_lines: [{ product_id: F.products.spf3500, qty: 2, discount_usd_minor: 0 }] });
      ids.code = "FT2609184527A";
      const r = await adv.rpc<{ outcome: string; receipt: { number: string } }>("record_receipt", {
        p_id: (ids.receipt = newId()), p_customer: F.customers.dongola, p_txn_code: ids.code, p_amount_sdg_minor: 300000000, p_received_on: iso(0), p_from_name: "Motgaba",
        p_to_account: F.accounts.mogtaba, p_proof_path: "checks/1.png", p_proof_sha256: (ids.sha = "a".repeat(64)),
        p_allocations: [{ order_id: o1.id, sdg_minor: 200000000 }, { order_id: o2.id, sdg_minor: 100000000 }],
      });
      const over = await refused(adv.rpc("allocate_receipt", { p_receipt: ids.receipt, p_order: o1.id, p_sdg_minor: 1 }), {});
      const paid = (await svc<{ n: string; p: number }>(db, "select number as n, paid_sdg_minor::float8 as p from orders where id in ($1, $2) order by number", [o1.id, o2.id])).map((x) => `${x.n} ${sdg(x.p)}`);
      return `${r.receipt.number} (3,000,000 SDG) → ${paid.join(" and ")}. Allocating one more piastre: "${over}"`;
    },
  },
  {
    id: "duplicate",
    area: "Receipts and accounts",
    title: "A screenshot recorded twice is refused, however the code is typed",
    async run({ db, ids }) {
      const msg = await refused(db.as(F.adviser).rpc("record_receipt", {
        p_id: newId(), p_customer: F.customers.dongola, p_txn_code: " ft 2609-1845 27a ", p_amount_sdg_minor: 300000000, p_received_on: iso(0), p_from_name: "Mogtaba",
        p_to_account: F.accounts.mogtaba, p_proof_path: "checks/1b.png", p_proof_sha256: "b".repeat(64),
      }), { hint: "duplicate" });
      const msg2 = await refused(db.as(F.adviser).rpc("record_receipt", {
        p_id: newId(), p_customer: F.customers.dongola, p_txn_code: "OTHERCODE1", p_amount_sdg_minor: 120000000, p_received_on: iso(0), p_from_name: "Mogtaba",
        p_to_account: F.accounts.mogtaba, p_proof_path: "checks/1c.png", p_proof_sha256: ids.sha,
      }), { hint: "duplicate" });
      return `Same code as " ft 2609-1845 27a ": "${msg}" Same image, another code: "${msg2}"`;
    },
  },
  {
    id: "conflict",
    area: "Receipts and accounts",
    title: "Same code with a different amount is flagged for the owner, not saved over the first",
    async run({ db, ids }) {
      const r = await db.as(F.adviser).rpc<{ outcome: string; message: string }>("record_receipt", {
        p_id: newId(), p_customer: F.customers.dongola, p_txn_code: ids.code!, p_amount_sdg_minor: 250000000, p_received_on: iso(0), p_from_name: "Mogtaba",
        p_to_account: F.accounts.mogtaba, p_proof_path: "checks/1d.png", p_proof_sha256: "d".repeat(64),
      });
      assert(r.outcome === "conflict", `outcome ${r.outcome}`);
      const checks = await db.as(F.owner).rpc<{ code: string; status: string }[]>("closing_checks");
      assert(checks.find((c) => c.code === "conflicts")?.status === "fail", "closing check did not flag it");
      const amount = (await svc<{ a: number }>(db, "select amount_sdg_minor::float8 as a from receipts where id = $1", [ids.receipt]))[0]!.a;
      assert(amount === 300000000, "original changed");
      return `"${r.message}" The original stays at 3,000,000 SDG; the closing check fails until the owner resolves it.`;
    },
  },
  {
    id: "transfer-cap",
    area: "Receipts and accounts",
    title: "A transfer above 3,000,000 SDG is refused",
    async run({ db }) {
      const msg = await refused(db.as(F.adviser).rpc("record_receipt", {
        p_id: newId(), p_customer: F.customers.dongola, p_txn_code: "CAP0000001", p_amount_sdg_minor: 300000100, p_received_on: iso(0), p_from_name: "x",
        p_to_account: F.accounts.hashim, p_proof_path: "checks/2.png", p_proof_sha256: "c".repeat(64),
      }), {});
      return `3,000,001 SDG: "${msg}"`;
    },
  },
  {
    id: "daily-limit",
    area: "Receipts and accounts",
    title: "An account over its 15,000,000 daily limit: the receipt is kept and flagged",
    async run({ db }) {
      const adv = db.as(F.adviser);
      let last: { receipt: { flags: string[] } } | null = null;
      for (let k = 0; k < 6; k++) {
        last = await adv.rpc("record_receipt", {
          p_id: newId(), p_customer: F.customers.nile, p_txn_code: `LIM${k}${newId().slice(-8)}`, p_amount_sdg_minor: 300000000, p_received_on: iso(0), p_from_name: "x",
          p_to_account: F.accounts.hashim, p_proof_path: `checks/lim${k}.png`, p_proof_sha256: newId() + k,
        });
      }
      assert(last!.receipt.flags.includes("over_daily_limit"), "not flagged");
      const today = await adv.rpc<{ accounts: { name: string; remaining_minor: number }[] }>("accounts_today");
      const h = today.accounts.find((a) => a.name === "Hashim ONB")!;
      return `The sixth 3,000,000 transfer (18,000,000 today) is saved with the flag over_daily_limit. Room left today on Hashim: ${sdg(h.remaining_minor)}.`;
    },
  },
  {
    id: "aliases",
    area: "Receipts and accounts",
    title: "“Mogtaba”, “Mujtaba” and “Motgaba” are one person",
    async run({ db, ids }) {
      const m = await db.as(F.adviser).rpc<{ display_name: string }[]>("match_holder", { p_name: " MUJTABA " });
      const holder = (await svc<{ h: string }>(db, "select h.display_name as h from receipts r join account_holders h on h.id = r.from_holder_id where r.id = $1", [ids.receipt]))[0]?.h;
      assert(m[0]?.display_name === "Mogtaba Elsir" && holder === "Mogtaba Elsir", "no match");
      return `" MUJTABA " → ${m[0]!.display_name}. The receipt sent by "Motgaba" is linked to ${holder}.`;
    },
  },
  {
    id: "pass-through",
    area: "Receipts and accounts",
    title: "A pass-through account must net to zero; until it does, the closing check fails",
    async run({ db }) {
      await db.as(F.adviser).rpc("record_receipt", {
        p_id: newId(), p_customer: F.customers.nile, p_txn_code: "PASS000001", p_amount_sdg_minor: 240000000, p_received_on: iso(0), p_from_name: "x",
        p_to_account: F.accounts.khalid, p_proof_path: "checks/pt.png", p_proof_sha256: "e".repeat(64),
      });
      const before = (await db.as(F.owner).rpc<{ code: string; status: string }[]>("closing_checks")).find((c) => c.code === "pass_through_zero")!.status;
      await db.as(F.owner).rpc("record_movement", { p_kind: "transfer", p_day: iso(0), p_from: F.accounts.khalid, p_from_amount: 240000000, p_to: F.accounts.mogtaba, p_memo: "Passed on" });
      const after = (await db.as(F.owner).rpc<{ code: string; status: string }[]>("closing_checks")).find((c) => c.code === "pass_through_zero")!.status;
      assert(before === "fail" && after === "ok", `${before} → ${after}`);
      return `2,400,000 SDG on Khalid's account: check ${before}. Passed on to Mogtaba: check ${after}.`;
    },
  },

  // ---------------------------------------------------------------- stock
  {
    id: "landed-cost",
    area: "Stock",
    title: "Landed cost with a 20% uplift: the $270 inverter lands at $303.58",
    async run({ db, shipment }) {
      const d = await db.as(F.owner).rpc<{ finance: { purchase_usd_minor: number; indirect_usd_minor: number; uplifted_indirect_usd_minor: number }; lines: { sku: string; landed_unit_usd_minor: number; landed_usd_minor: number }[] }>("shipment_dossier", { p_shipment: shipment });
      const inv = d.lines.find((l) => l.sku === "SPF-3500-ES")!;
      const sum = d.lines.reduce((s, l) => s + l.landed_usd_minor, 0);
      assert(inv.landed_unit_usd_minor === 30358, `landed ${usd(inv.landed_unit_usd_minor)}`);
      assert(sum === d.finance.purchase_usd_minor + d.finance.uplifted_indirect_usd_minor, "lines don't add up");
      return `Purchase ${usd(d.finance.purchase_usd_minor)}, costs ${usd(d.finance.indirect_usd_minor)} in USD, SDG and AED, ×1.2 = ${usd(d.finance.uplifted_indirect_usd_minor)}. SPF 3500 ES: $270 → ${usd(inv.landed_unit_usd_minor)}. Lines add up to the cent.`;
    },
  },
  {
    id: "release-unpaid",
    area: "Stock",
    title: "The warehouse can't release an order that isn't fully paid",
    async run({ db, ids }) {
      const msg = await refused(db.as(F.warehouse).rpc("release_order", { p_order: ids.r1 }), { hint: "not_paid" });
      return `Partly paid order: "${msg}"`;
    },
  },
  {
    id: "release-paid",
    area: "Stock",
    title: "A fully paid order leaves the warehouse; its cost is fixed at release, oldest stock first",
    async run({ db, ids }) {
      const o = await db.as(F.adviser).rpc<Order>("order_detail", { p_id: ids.o12 });
      await payInFull(db, o, F.customers.ahmed);
      await db.as(F.warehouse).rpc("release_order", { p_order: ids.o12 });
      const f = (await svc<{ rev: number; cost: number; q: number }>(db, "select sum(revenue_usd_minor)::float8 as rev, sum(cost_usd_minor)::float8 as cost, sum(qty)::int as q from restricted.sale_facts where order_id = $1", [ids.o12]))[0]!;
      assert(f.rev === o.total_usd_minor && f.q === 6, "facts don't add up");
      const again = await refused(db.as(F.warehouse).rpc("release_order", { p_order: ids.o12 }), {});
      return `Paid in ${Math.ceil(o.total_sdg_minor / 300000000)} transfers, released by the warehouse. Revenue ${usd(f.rev)}, cost ${usd(f.cost)}, 6 units, fixed. Releasing again: "${again}"`;
    },
  },
  {
    id: "warehouse-no-money",
    area: "Stock",
    title: "The warehouse sees quantities and paid status, never a price or an amount",
    async run({ db }) {
      const w = db.as(F.warehouse);
      const cat = await w.rpc<{ price_usd_minor: number | null }[]>("catalogue");
      const prices = await w.query("select * from product_prices");
      const orders = await w.query("select * from orders");
      const receipts = await w.query("select * from receipts");
      const pick = await w.rpc<Record<string, unknown>[]>("pick_list");
      const moneyKeys = JSON.stringify(pick).match(/_minor|rate_sdg|price/g);
      assert(cat.every((p) => p.price_usd_minor === null) && prices.length === 0 && orders.length === 0 && receipts.length === 0 && !moneyKeys, "money visible");
      return `Catalogue without prices; product_prices, orders and receipts return 0 rows; the pick list (${pick.length} orders) carries no amounts.`;
    },
  },

  // ---------------------------------------------------------------- permissions
  {
    id: "adviser-no-cost",
    area: "Permissions",
    title: "An adviser can't reach a cost price or a margin, not even with SQL",
    async run({ db, shipment }) {
      const a = db.as(F.adviser);
      const m1 = await refused(a.query("select * from restricted.shipment_line_costs"), { text: /permission/i });
      await refused(a.query("select sum(cost_usd_minor) from restricted.sale_facts"), { text: /permission/i });
      await refused(a.rpc("shipment_dossier", { p_shipment: shipment }), { code: "42501" });
      await refused(a.rpc("profit_report", { p_from: iso(-30), p_to: iso(0), p_by: "product" }), { code: "42501" });
      const ledger = await a.query("select * from ledger_entries");
      assert(ledger.length === 0, "ledger visible");
      return `SELECT on restricted.shipment_line_costs: "${m1}" Same for sale_facts, the dossier and the profit report; the ledger returns 0 rows.`;
    },
  },
  {
    id: "marketing",
    area: "Permissions",
    title: "Marketing reads customers, orders and stock, edits customers, and never sees costs or margins",
    async run({ db }) {
      const m = db.as(F.marketing);
      const orders = await m.query("select * from orders");
      const customers = await m.rpc<{ total: number }>("customers_list", {});
      await m.rpc("save_customer", { p_id: F.customers.nile, p_name: "Nile Solar", p_city: "Omdurman", p_kind: "dealer", p_contact_name: "Mona", p_phone: "0123456789", p_segment: "A", p_pipeline: "active", p_source: "referral" });
      await refused(m.query("select * from restricted.sale_facts"), { text: /permission/i });
      await refused(m.rpc("profit_report", { p_from: iso(-30), p_to: iso(0), p_by: "month" }), { code: "42501" });
      const receipts = await m.query("select * from receipts");
      assert(orders.length > 0 && customers.total === 4 && receipts.length === 0, "wrong visibility");
      return `${orders.length} orders and ${customers.total} customers visible, customer edited; costs, margins and receipts: refused or empty.`;
    },
  },
  {
    id: "own-customers",
    area: "Permissions",
    title: "An adviser works only with her own customers",
    async run({ db, ids }) {
      const other = db.as(F.adviser2);
      const list = await other.rpc<{ total: number }>("customers_list", {});
      const seen = await other.rpc("order_detail", { p_id: ids.o123 });
      const msg = await refused(other.rpc("save_order", { p_id: newId(), p_customer: F.customers.ahmed, p_rate_sdg: 8200, p_lines: [L1] }), { code: "42501" });
      assert(list.total === 1 && seen === null, "sees other customers");
      return `The second adviser sees ${list.total} customer, not the first adviser's orders, and: "${msg}"`;
    },
  },
  {
    id: "environments",
    area: "Permissions",
    title: "A dealer's environment and the distributor's are sealed from each other",
    async run({ db }) {
      const d = db.as(F.dealerOwner);
      const custs = await d.rpc<{ total: number }>("customers_list", {});
      const orders = await d.query("select * from orders");
      const msg = await refused(d.rpc("save_order", { p_id: newId(), p_customer: F.customers.ahmed, p_rate_sdg: 8200, p_lines: [L1] }), {});
      const msg2 = await refused(d.rpc("record_receipt", {
        p_id: newId(), p_customer: F.customers.dealersOwn, p_txn_code: "ENV0000001", p_amount_sdg_minor: 100000000, p_received_on: iso(0), p_from_name: "x",
        p_to_account: F.accounts.mogtaba, p_proof_path: "checks/env.png", p_proof_sha256: "f".repeat(64),
      }), {});
      assert(custs.total === 1 && orders.length === 0, "leak");
      return `The dealer's owner sees ${custs.total} customer (their own) and 0 of the distributor's orders. Ordering for the distributor's customer: "${msg}" Paying into its account: "${msg2}"`;
    },
  },

  // ---------------------------------------------------------------- reports
  {
    id: "report-stable",
    area: "Reports",
    title: "Last month's report gives identical numbers after today's rate, prices and new business",
    async run({ db, ids }) {
      const owner = db.as(F.owner);
      const now = new Date();
      const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
      const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
      const d = (x: Date, days = 0) => new Date(x.getTime() + days * 86400000).toISOString().slice(0, 10);
      // Last month: an order, paid, confirmed, released, and the exchanger's payout in euros.
      await clock(db, `${d(first, 4)}T09:00:00+02:00`);
      const o = await db.as(F.adviser).rpc<Order>("save_order", { p_id: newId(), p_customer: F.customers.ahmed, p_rate_sdg: 8100, p_lines: [{ product_id: F.products.spf6000, qty: 3, discount_usd_minor: 2500 }, { product_id: F.products.hope5, qty: 2, discount_usd_minor: 0 }] });
      await payInFull(db, o, F.customers.ahmed, F.accounts.mogtaba, d(first, 4));
      const recs = (await svc<{ id: string }>(db, "select r.id from receipts r join receipt_allocations a on a.receipt_id = r.id where a.order_id = $1", [o.id])).map((r) => r.id);
      await clock(db, `${d(first, 5)}T09:00:00+02:00`);
      await owner.rpc("set_receipt_status", { p_ids: recs, p_status: "confirmed" });
      await db.as(F.warehouse).rpc("release_order", { p_order: o.id });
      await clock(db, `${d(first, 9)}T12:00:00+02:00`);
      const available = (await svc<{ s: number }>(db, "select sum(a.sdg_minor - a.settled_sdg_minor)::float8 as s from receipt_allocations a join receipts r on r.id = a.receipt_id where r.status = 'confirmed' and r.to_account_id = $1", [F.accounts.mogtaba]))[0]!.s;
      await owner.rpc("record_payout", { p_day: d(first, 9), p_from_account: F.accounts.mogtaba, p_sdg_minor: available, p_to_account: F.accounts.awxEur, p_to_amount: Math.floor(available / 8000 * 0.862) });
      await clock(db, null);

      const range = { p_from: d(first), p_to: d(last) };
      const dims = ["product", "order", "customer", "adviser", "shipment", "month", "route"];
      const before = await Promise.all(dims.map((p_by) => owner.rpc("profit_report", { ...range, p_by })));

      // Today: the pound falls further, the owner raises the minimum and a price, the euro moves,
      // and new business is done.
      await owner.rpc("update_settings", { p: { min_rate_sdg: 8600 } });
      await owner.rpc("set_reference_rate", { p_currency: "EUR", p_day: iso(0), p_per_usd_ppm: 905000 });
      await owner.rpc("set_reference_rate", { p_currency: "EUR", p_day: d(first, 4), p_per_usd_ppm: 700000 }); // even rewriting last month's reference rate
      await owner.rpc("set_price", { p_product: F.products.spf6000, p_price_usd_minor: 55900 });
      const today = await db.as(F.adviser).rpc<Order>("save_order", { p_id: newId(), p_customer: F.customers.ahmed, p_rate_sdg: 8700, p_lines: [{ product_id: F.products.spf6000, qty: 2, discount_usd_minor: 0 }] });
      await payInFull(db, today, F.customers.ahmed, F.accounts.mogtaba);
      await owner.rpc("update_settings", { p: { min_rate_sdg: 8000 } });

      // A late receipt dated last month is refused once last month is closed.
      await owner.rpc("close_period", { p_through: d(last) });
      const late = await refused(db.as(F.adviser).rpc("record_receipt", {
        p_id: newId(), p_customer: F.customers.ahmed, p_txn_code: `LATE${newId().slice(-8)}`, p_amount_sdg_minor: 100000000, p_received_on: d(first, 20),
        p_from_name: "Dealer", p_to_account: F.accounts.mogtaba, p_proof_path: "checks/late.png", p_proof_sha256: newId() + "late",
      }), { hint: "period_closed" });

      const after = await Promise.all(dims.map((p_by) => owner.rpc("profit_report", { ...range, p_by })));
      assert(JSON.stringify(before) === JSON.stringify(after), "the report moved");
      ids.late = late;
      const month = (before[5] as { revenue_usd: number; gross_usd: number; fx_usd: number; net_after_usd: number }[])[0]!;
      return `${d(first)} to ${d(last)}: revenue ${usd(month.revenue_usd)}, gross ${usd(month.gross_usd)}, currency result ${usd(month.fx_usd)}, net ${usd(month.net_after_usd)}. All seven views identical, to the cent, after today's changes. Month closed; a receipt dated into it: "${ids.late}"`;
    },
  },
  {
    id: "views-add-up",
    area: "Reports",
    title: "Every view of the same period adds up to the same totals",
    async run({ db }) {
      const owner = db.as(F.owner);
      const range = { p_from: iso(-120), p_to: iso(0) };
      const totals: Record<string, number> = {};
      for (const p_by of ["product", "order", "customer", "adviser", "shipment", "month"]) {
        const rows = await owner.rpc<{ net_after_usd: number; net_after_eur: number }[]>("profit_report", { ...range, p_by });
        totals[p_by] = rows.reduce((s, r) => s + r.net_after_usd, 0);
      }
      const fxMonth = (await owner.rpc<{ fx_usd: number }[]>("profit_report", { ...range, p_by: "month" })).reduce((s, r) => s + r.fx_usd, 0);
      const fxRoute = (await owner.rpc<{ fx_usd: number }[]>("profit_report", { ...range, p_by: "route" })).reduce((s, r) => s + r.fx_usd, 0);
      const values = new Set(Object.values(totals));
      assert(values.size === 1 && fxMonth === fxRoute, JSON.stringify({ totals, fxMonth, fxRoute }));
      return `Net after currency is ${usd(totals.month!)} whichever way it's cut; the currency result per route adds up to the month's.`;
    },
  },
];

export async function runChecks(open: () => Promise<Database>, onResult?: (r: CheckResult) => void): Promise<CheckResult[]> {
  const db = await open();
  const shipment = await buildFixture(db);
  await db.as(F.owner).rpc("finalise_landed_cost", { p_shipment: shipment });
  await db.as(F.warehouse).rpc("receive_shipment", { p_shipment: shipment, p_day: iso(-45) });
  const ctx: Ctx = { db, shipment, ids: {} };
  const results: CheckResult[] = [];
  for (const c of CHECKS) {
    const t0 = performance.now();
    let r: CheckResult;
    try {
      const detail = await c.run(ctx);
      r = { id: c.id, area: c.area, title: c.title, ok: true, detail, ms: Math.round(performance.now() - t0) };
    } catch (e) {
      r = { id: c.id, area: c.area, title: c.title, ok: false, detail: (e as Error).message, ms: Math.round(performance.now() - t0) };
    }
    results.push(r);
    onResult?.(r);
  }
  await clock(db, null);
  return results;
}
