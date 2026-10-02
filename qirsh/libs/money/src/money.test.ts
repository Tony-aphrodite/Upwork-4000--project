import { describe, expect, it } from "vitest";
import { acceptRate, apportion, convertPpm, divRound, formatMinor, landedCost, lineOf, parseMoney, tierOf, totalsOf, transferPlan } from "./money";

// The worked example from the trial task, in cents.
const INV6 = 51500; // SPF 6000 ES Plus, $515
const BAT5 = 81000; // Hope 5.0L-B1, $810
const BAT16 = 207000; // Hope 16.0LM-A1, $2,070

describe("worked example", () => {
  const l1 = lineOf({ qty: 4, unitPriceMinor: INV6, discountMinor: 4000 });
  const l2 = lineOf({ qty: 2, unitPriceMinor: BAT5, discountMinor: 7000 });
  const l3 = lineOf({ qty: 1, unitPriceMinor: BAT16, discountMinor: 15000 });

  it("gives each line its value, colour and total", () => {
    expect([l1.valueMinor, l1.totalMinor, l1.tier]).toEqual([206000, 202000, "sand"]);
    expect([l2.valueMinor, l2.totalMinor, l2.tier]).toEqual([162000, 155000, "red"]);
    expect([l3.valueMinor, l3.totalMinor, l3.tier]).toEqual([207000, 192000, "blocked"]);
    expect(l1.discountPct.toFixed(2)).toBe("1.94");
    expect(l2.discountPct.toFixed(2)).toBe("4.32");
    expect(l3.discountPct.toFixed(2)).toBe("7.25");
  });

  it("without line 3: $3,570 = 29,274,000 SDG at 8,200", () => {
    const t = totalsOf([l1, l2], 8200);
    expect(t.totalUsd).toBe(357000);
    expect(t.totalSdg).toBe(2927400000); // 29,274,000.00 pounds in piastres
    expect(formatMinor(t.totalSdg, "SDG")).toBe("29,274,000 SDG");
  });

  it("with line 3 approved: $5,490 = 45,018,000 SDG at 8,200", () => {
    const t = totalsOf([l1, l2, l3], 8200);
    expect(t.totalUsd).toBe(549000);
    expect(formatMinor(t.totalSdg, "SDG")).toBe("45,018,000 SDG");
  });

  it("refuses a rate below the minimum and puts back 8,000", () => {
    expect(acceptRate("7,900", 8000)).toEqual({ rate: 8000, refused: true });
    expect(acceptRate("8200", 8000)).toEqual({ rate: 8200, refused: false });
    expect(acceptRate("8,000", 8000)).toEqual({ rate: 8000, refused: false });
    expect(acceptRate("abc", 8000)).toEqual({ rate: 8000, refused: true });
  });
});

describe("discount colours on the exact boundaries", () => {
  it("3.00% is sand, anything above is red; 5.00% is red, anything above is blocked", () => {
    expect(tierOf(0, 100000)).toBe("none");
    expect(tierOf(3000, 100000)).toBe("sand");
    expect(tierOf(3001, 100000)).toBe("red");
    expect(tierOf(5000, 100000)).toBe("red");
    expect(tierOf(5001, 100000)).toBe("blocked");
  });
  it("uses integers, so a value that isn't a round number can't round its way into a lower colour", () => {
    // 3% of $333.33 is $9.9999; $10.00 is above 3%, so red.
    expect(tierOf(1000, 33333)).toBe("red");
    expect(tierOf(999, 33333)).toBe("sand");
  });
});

describe("parsing and rounding", () => {
  it("reads dollar input into cents and refuses fractions of a cent", () => {
    expect(parseMoney("40")).toBe(4000);
    expect(parseMoney("40.5")).toBe(4050);
    expect(parseMoney("1,020.25")).toBe(102025);
    expect(parseMoney("1.005")).toBeNull();
    expect(parseMoney("-3")).toBeNull();
  });
  it("rounds half away from zero, like Postgres", () => {
    expect(divRound(5, 2)).toBe(3);
    expect(divRound(-5, 2)).toBe(-3);
    expect(divRound(4, 3)).toBe(1);
    expect(convertPpm(549000, 861234)).toBe(472817);
  });
  it("apportions so the parts always add up to the whole", () => {
    const parts = apportion(1000, [1, 1, 1]);
    expect(parts).toEqual([333, 333, 334]);
    expect(apportion(2280123, [5400000, 9000000, 7600000]).reduce((a, b) => a + b)).toBe(2280123);
  });
});

describe("payment instructions", () => {
  it("splits into transfers of at most 3,000,000 and respects each account's room today", () => {
    const plan = transferPlan(
      2927400000,
      [
        { id: "a", label: "A", remainingToday: 1500000000 },
        { id: "b", label: "B", remainingToday: 900000000 },
        { id: "c", label: "C", remainingToday: 0 },
      ],
      300000000,
    );
    expect(plan.transfers.every((t) => t.amount <= 300000000)).toBe(true);
    expect(plan.transfers.reduce((s, t) => s + t.amount, 0) + plan.carryOver).toBe(2927400000);
    expect(plan.transfers.filter((t) => t.accountId === "a").reduce((s, t) => s + t.amount, 0)).toBe(1500000000);
    expect(plan.carryOver).toBe(527400000);
  });
});

describe("landed cost", () => {
  it("spreads uplifted indirect costs pro rata and adds up exactly", () => {
    const r = landedCost([{ purchaseUsd: 5400000, qty: 200 }, { purchaseUsd: 16600000, qty: 80 }], 2280123, 2000);
    expect(r.upliftedIndirectUsd).toBe(2736148);
    expect(r.lines.reduce((s, l) => s + l.indirectShareUsd, 0)).toBe(2736148);
    // $270 inverter from a $220,000 shipment with $22,801.23 of indirect costs and a 20% uplift
    expect(r.lines[0]!.landedUnitUsd).toBe(30358);
  });
});
