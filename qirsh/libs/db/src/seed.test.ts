import { beforeAll, describe, expect, it } from "vitest";
import { Database } from "./client";
import { PEOPLE, seed } from "./seed";

// The demo data is replayed through the real functions; these tests prove it came out
// consistent, and that the problems it plants on purpose are the only ones the checks find.
let db: Database;
beforeAll(async () => {
  db = await Database.open();
  await seed(db);
}, 120000);

describe("demo data", () => {
  it("passes every closing check except the three problems planted for the demo", async () => {
    const checks = await db.as(PEOPLE.owner.id).rpc<{ code: string; status: string; items: unknown[] }[]>("closing_checks");
    const notOk = Object.fromEntries(checks.filter((c) => c.status !== "ok").map((c) => [c.code, c.status]));
    expect(notOk).toMatchObject({ statements_match: "fail", conflicts: "fail", forwarded: "warn" });
    for (const code of ["allocations_add_up", "booked_add_up", "released_add_up", "stock_add_up", "released_paid", "landed_add_up", "unmatched"]) {
      expect(checks.find((c) => c.code === code)?.status, code).toBe("ok");
    }
  });

  it("lands the $270 inverter of S-2026-014 at $303.58", async () => {
    const r = await db.service.query<{ v: number }>(`select c.landed_unit_usd_minor::int as v from restricted.shipment_line_costs c
      join shipment_lines l on l.id = c.line_id join shipments s on s.id = l.shipment_id join products p on p.id = l.product_id
      where s.ref = 'S-2026-014' and p.sku = 'SPF-3500-ES'`);
    expect(r.rows[0]?.v).toBe(30358);
  });

  it("has 570 customers and three months of orders, receipts and payouts", async () => {
    const r = (await db.service.query<Record<string, number>>(`select (select count(*) from customers where tenant_id = '5a1e0000-0000-4000-8000-000000000001')::int as customers,
      (select count(*) from orders)::int as orders, (select count(*) from receipts)::int as receipts, (select count(*) from restricted.fx_facts)::int as fx`)).rows[0]!;
    expect(r.customers).toBe(570);
    expect(r.orders).toBeGreaterThan(100);
    expect(r.receipts).toBeGreaterThan(800);
    expect(r.fx).toBeGreaterThan(500);
  });

  it("never shows an adviser a cost, even on the full data", async () => {
    await expect(db.as(PEOPLE.amira.id).query("select * from restricted.sale_facts")).rejects.toThrow(/permission/);
    const cat = await db.as(PEOPLE.tarig.id).rpc<{ price_usd_minor: number | null }[]>("catalogue");
    expect(cat.every((p) => p.price_usd_minor === null)).toBe(true);
  });
});
