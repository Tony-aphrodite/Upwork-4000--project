/**
 * Money rules shared by the order screen and the tests. The database applies the same rules
 * again (supabase/migrations) and is the authority: the browser only previews.
 *
 * Every amount is an integer in the smallest unit of its currency: cents for USD, EUR and AED,
 * piastres (1/100 pound) for SDG. JavaScript numbers are exact for integers up to 2^53, which
 * is far above any amount here; `assertMinor` guards that on every result.
 */

export type Currency = "USD" | "SDG" | "EUR" | "AED";
export type Tier = "none" | "sand" | "red" | "blocked";

export interface Thresholds {
  /** Highest discount, in basis points of the line value, that is still "sand" (300 = 3%). */
  sandMaxBps: number;
  /** Highest discount that is still "red" and can be saved without approval (500 = 5%). */
  redMaxBps: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = { sandMaxBps: 300, redMaxBps: 500 };

export function assertMinor(n: number, what = "amount"): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`${what} must be a whole number of minor units, got ${n}`);
  return n;
}

/**
 * Colour of a line. Compares with integers only: discount / value <= bps / 10000 is written as
 * discount * 10000 <= value * bps, so 3.0000% is sand and 3.0001% is red, with no rounding.
 */
export function tierOf(discountMinor: number, valueMinor: number, t: Thresholds = DEFAULT_THRESHOLDS): Tier {
  assertMinor(discountMinor, "discount");
  assertMinor(valueMinor, "line value");
  if (discountMinor <= 0) return "none";
  if (discountMinor * 10000 <= valueMinor * t.sandMaxBps) return "sand";
  if (discountMinor * 10000 <= valueMinor * t.redMaxBps) return "red";
  return "blocked";
}

export interface LineInput {
  qty: number;
  unitPriceMinor: number;
  discountMinor: number;
}

export interface LineResult extends LineInput {
  valueMinor: number;
  totalMinor: number;
  tier: Tier;
  /** Discount as a percentage of the line value, for display only (never stored or reused). */
  discountPct: number;
}

export function lineOf(l: LineInput, t: Thresholds = DEFAULT_THRESHOLDS): LineResult {
  if (!Number.isInteger(l.qty) || l.qty <= 0) throw new RangeError("Quantity must be a whole number above zero");
  const valueMinor = assertMinor(l.qty * l.unitPriceMinor, "line value");
  if (l.discountMinor < 0) throw new RangeError("Discount cannot be negative");
  if (l.discountMinor > valueMinor) throw new RangeError("Discount cannot be larger than the line value");
  return {
    ...l,
    valueMinor,
    totalMinor: valueMinor - l.discountMinor,
    tier: tierOf(l.discountMinor, valueMinor, t),
    discountPct: valueMinor === 0 ? 0 : (l.discountMinor * 100) / valueMinor,
  };
}

export interface OrderTotals {
  valueUsd: number;
  discountUsd: number;
  totalUsd: number;
  /** Pounds, in piastres: cents x (pounds per dollar) is exact when the rate is a whole number. */
  totalSdg: number;
}

export function totalsOf(lines: LineResult[], rateSdgPerUsd: number): OrderTotals {
  assertRate(rateSdgPerUsd);
  const valueUsd = lines.reduce((s, l) => s + l.valueMinor, 0);
  const discountUsd = lines.reduce((s, l) => s + l.discountMinor, 0);
  const totalUsd = valueUsd - discountUsd;
  return { valueUsd, discountUsd, totalUsd, totalSdg: usdToSdg(totalUsd, rateSdgPerUsd) };
}

export function assertRate(rate: number) {
  if (!Number.isInteger(rate) || rate <= 0) throw new RangeError("The rate is a whole number of pounds per dollar");
}

export function usdToSdg(usdMinor: number, rateSdgPerUsd: number): number {
  assertRate(rateSdgPerUsd);
  return assertMinor(usdMinor * rateSdgPerUsd, "SDG amount");
}

/** Half away from zero, the same as Postgres round() on numeric. */
export function divRound(numerator: number, denominator: number): number {
  const q = Math.trunc(numerator / denominator);
  const r = numerator - q * denominator;
  if (Math.abs(r) * 2 >= Math.abs(denominator)) return q + Math.sign(numerator) * Math.sign(denominator);
  return q;
}

/** Converts with a rate held as an integer in parts per million (0.861234 EUR per USD = 861234). */
export function convertPpm(minor: number, ppm: number): number {
  return assertMinor(divRound(minor * ppm, 1_000_000), "converted amount");
}

/**
 * The rate the adviser typed, checked against the owner's minimum. A lower (or unreadable) rate is
 * refused and replaced by the minimum, exactly as the brief describes.
 */
export function acceptRate(input: string, minRate: number): { rate: number; refused: boolean } {
  const digits = input.replace(/[\s,]/g, "");
  const n = /^\d+$/.test(digits) ? Number(digits) : NaN;
  if (!Number.isSafeInteger(n) || n < minRate) return { rate: minRate, refused: true };
  return { rate: n, refused: false };
}

/** "40", "40.5", "1,020.25" -> cents. More than two decimals is an error, not a rounding. */
export function parseMoney(input: string): number | null {
  const s = input.replace(/[\s,$]/g, "");
  if (s === "") return 0;
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const whole = Number(m[1]);
  const frac = Number((m[2] ?? "").padEnd(2, "0"));
  const minor = whole * 100 + frac;
  return Number.isSafeInteger(minor) ? minor : null;
}

/**
 * Splits `total` over `weights` so that the parts add up to `total` exactly: part i is
 * floor(total * cumulative_i / sum) - floor(total * cumulative_(i-1) / sum). Used for landed
 * cost, for revenue per stock lot and for the currency result per order.
 */
export function apportion(total: number, weights: number[]): number[] {
  assertMinor(total);
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) throw new RangeError("Weights must add up to more than zero");
  let cum = 0;
  let prev = 0;
  return weights.map((w) => {
    cum += w;
    const upTo = Math.floor((total * cum) / sum);
    const part = upTo - prev;
    prev = upTo;
    return part;
  });
}

export interface PlanAccount {
  id: string;
  label: string;
  remainingToday: number;
}

export interface PlanTransfer {
  accountId: string;
  label: string;
  amount: number;
}

/**
 * Payment instructions: splits what is outstanding into transfers of at most `maxTransfer`,
 * filling the accounts with the most room today first. Anything that doesn't fit today is
 * returned as `carryOver` for the next day.
 */
export function transferPlan(outstanding: number, accounts: PlanAccount[], maxTransfer: number) {
  const transfers: PlanTransfer[] = [];
  let left = outstanding;
  const sorted = [...accounts].filter((a) => a.remainingToday > 0).sort((a, b) => b.remainingToday - a.remainingToday);
  for (const a of sorted) {
    let room = a.remainingToday;
    while (left > 0 && room > 0) {
      const amount = Math.min(maxTransfer, room, left);
      transfers.push({ accountId: a.id, label: a.label, amount });
      room -= amount;
      left -= amount;
    }
    if (left === 0) break;
  }
  return { transfers, carryOver: left };
}

export interface LandedLine {
  purchaseUsd: number;
  qty: number;
}

/**
 * Landed cost: indirect costs (freight, customs, clearance, transport) plus the safety uplift,
 * spread pro rata to purchase value. Returns each line's landed total, which adds up exactly.
 */
export function landedCost(lines: LandedLine[], indirectUsd: number, upliftBps: number) {
  const uplifted = divRound(indirectUsd * (10000 + upliftBps), 10000);
  const shares = apportion(uplifted, lines.map((l) => l.purchaseUsd));
  return {
    upliftedIndirectUsd: uplifted,
    lines: lines.map((l, i) => {
      const landedUsd = l.purchaseUsd + shares[i]!;
      return { ...l, indirectShareUsd: shares[i]!, landedUsd, landedUnitUsd: divRound(landedUsd, l.qty) };
    }),
  };
}

const DIGITS: Record<Currency, number> = { USD: 2, EUR: 2, AED: 2, SDG: 2 };

/** Formats minor units: whole amounts without decimals ($2,020, 29,274,000 SDG), otherwise two. */
export function formatMinor(minor: number, currency: Currency, locale = "en", opts: { symbol?: boolean; decimals?: "auto" | "always" } = {}) {
  const d = DIGITS[currency];
  const value = minor / 10 ** d;
  const hasFraction = minor % 10 ** d !== 0;
  const decimals = opts.decimals === "always" || hasFraction ? d : 0;
  const num = new Intl.NumberFormat(locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value);
  if (opts.symbol === false) return num;
  if (currency === "USD") return `$${num}`;
  if (currency === "EUR") return `€${num}`;
  return `${num} ${currency}`;
}
