import { addDays, type CivilDate, lastDayOfMonth, monthKey } from "@/platform/dates";
import type { Cents } from "@/platform/money";

export const DAY_BASES = ["365", "360"] as const;
export const SETTLEMENTS = ["daily", "monthly", "quarterly", "annual"] as const;
export const RULE_MODES = ["analyze_only", "post_to_provider"] as const;
export const RULE_STATES = ["active", "paused"] as const;
export const ACCRUAL_STATUSES = ["accrued", "negative_balance", "no_balance"] as const;
export const POSTING_STATES = ["none", "claimed", "posted", "indeterminate"] as const;

export type DayBasis = (typeof DAY_BASES)[number];
export type Settlement = (typeof SETTLEMENTS)[number];
export type RuleMode = (typeof RULE_MODES)[number];
export type RuleState = (typeof RULE_STATES)[number];
export type AccrualStatus = (typeof ACCRUAL_STATUSES)[number];
export type PostingState = (typeof POSTING_STATES)[number];

/**
 * Fixed point for the interest ledger (spec §7.6): an amount in **cents** times 10¹², so a day's
 * gross, net and remainder keep twelve decimals of a cent and no float decides a rounding.
 */
export type Fixed = bigint;
export const FIXED_SCALE = 1_000_000_000_000n;
const DIGITS = 12;
const DECIMAL = /^(-?)(\d+)(?:\.(\d+))?$/;

/** A decimal string (a `numeric` column, a rate) at the fixed scale; more than 12 decimals are cut. */
export function fixedFromDecimal(value: string): Fixed {
  const match = DECIMAL.exec(value.trim());
  if (!match) throw new RangeError(`Not a decimal: "${value}"`);
  const [, sign, whole, fraction = ""] = match;
  const parsed = BigInt(whole) * FIXED_SCALE + BigInt((fraction + "0".repeat(DIGITS)).slice(0, DIGITS));
  return sign === "-" ? -parsed : parsed;
}

/** The fixed value as the decimal string a `numeric(24,12)` column stores. */
export function fixedToDecimal(value: Fixed): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const fraction = (abs % FIXED_SCALE).toString().padStart(DIGITS, "0");
  return `${negative ? "-" : ""}${abs / FIXED_SCALE}.${fraction}`;
}

export interface Tier {
  /** The balance the tier reaches up to, `null` on the last one: everything above. */
  upToCents: Cents | null;
  /** The gross yearly rate as a fraction ("0.0275"). */
  annualRate: string;
}

/**
 * A day's gross interest on a balance, tier by tier (spec §7.6): each tier's rate on the part of
 * the balance between the previous threshold and its own, summed. Cents × 10¹².
 */
export function grossOfDay(balanceCents: Cents, tiers: readonly Tier[], basis: 365 | 360): Fixed {
  let previous = 0n;
  let gross = 0n;
  for (const tier of tiers) {
    const top = tier.upToCents === null || balanceCents < tier.upToCents ? balanceCents : tier.upToCents;
    const portion = top - previous;
    if (portion > 0n) gross += (portion * fixedFromDecimal(tier.annualRate)) / BigInt(basis);
    if (tier.upToCents === null || balanceCents <= tier.upToCents) break;
    previous = tier.upToCents;
  }
  return gross;
}

/** Half-up to the cent of a fixed amount, symmetric on negatives (spec §4.3). */
export function roundToCents(value: Fixed): Cents {
  const half = FIXED_SCALE / 2n;
  return value >= 0n ? (value + half) / FIXED_SCALE : -((-value + half) / FIXED_SCALE);
}

export interface DayAccrual {
  status: AccrualStatus;
  grossFixed: Fixed;
  netCents: Cents;
  carryAfter: Fixed;
}

/**
 * One day of spec §7.6: gross on the day's balance; net = gross × (1 − tax) + the remainder of the
 * day before; the day's net is that rounded half-up to the cent, never negative; the new remainder
 * is what rounding left. `carryBefore` is `null` (read as zero) when the day before has no accrual:
 * the remainder is used only from the day right before. A negative or unknown balance is a skipped
 * day, visibly, with nothing earned and nothing carried.
 */
export function accrueDay(input: {
  balanceCents: Cents | null;
  tiers: readonly Tier[];
  basis: 365 | 360;
  taxRate: string;
  carryBefore: Fixed | null;
}): DayAccrual {
  if (input.balanceCents === null)
    return { status: "no_balance", grossFixed: 0n, netCents: 0n, carryAfter: 0n };
  if (input.balanceCents < 0n) {
    return { status: "negative_balance", grossFixed: 0n, netCents: 0n, carryAfter: 0n };
  }
  const grossFixed = grossOfDay(input.balanceCents, input.tiers, input.basis);
  const kept = FIXED_SCALE - fixedFromDecimal(input.taxRate);
  const total = (grossFixed * kept) / FIXED_SCALE + (input.carryBefore ?? 0n);
  const rounded = roundToCents(total);
  const netCents = rounded < 0n ? 0n : rounded;
  return { status: "accrued", grossFixed, netCents, carryAfter: total - netCents * FIXED_SCALE };
}

const QUARTER_START = [1, 1, 1, 4, 4, 4, 7, 7, 7, 10, 10, 10];

/** The calendar period of a frequency that contains `on`. */
export function periodOf(frequency: Settlement, on: CivilDate): { from: CivilDate; to: CivilDate } {
  const year = on.slice(0, 4);
  const month = Number(on.slice(5, 7));
  // Some banks pay every day: the period is the day itself, settled the day after.
  if (frequency === "daily") return { from: on, to: on };
  if (frequency === "monthly") {
    const first = monthKey(on);
    return { from: first, to: lastDayOfMonth(first) };
  }
  if (frequency === "quarterly") {
    const start = QUARTER_START[month - 1];
    const first = `${year}-${String(start).padStart(2, "0")}-01`;
    const last = `${year}-${String(start + 2).padStart(2, "0")}-01`;
    return { from: first, to: lastDayOfMonth(last) };
  }
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

/**
 * The settlement periods between two days (spec §7.6), clipped to them: a rule starting on the
 * 15th settles its first half month, and one ending mid-period settles the day after it ends.
 */
export function settlementPeriods(
  frequency: Settlement,
  from: CivilDate,
  to: CivilDate,
): { from: CivilDate; to: CivilDate; settleOn: CivilDate }[] {
  const periods: { from: CivilDate; to: CivilDate; settleOn: CivilDate }[] = [];
  for (let day = from; day <= to;) {
    const period = periodOf(frequency, day);
    const end = period.to < to ? period.to : to;
    periods.push({ from: day, to: end, settleOn: addDays(end, 1) });
    day = addDays(end, 1);
  }
  return periods;
}

export type ReconciliationStatus =
  "no_data" | "indeterminate" | "matched" | "missing" | "delayed" | "anomalous";

/**
 * How a settlement compares with what was really paid (spec §7.6, plan F4 §3.4.5). `paidCents` is
 * `null` when there is no way to see the payment (no match text): that is no data, not a zero.
 * Within one cent is a match; nothing paid is `missing` once the window has closed and `delayed`
 * while it is open; less than accrued is `delayed` while open, and anything else is `anomalous`.
 */
export function reconcile(input: {
  accruedDays: number;
  accruedCents: Cents;
  paidCents: Cents | null;
  posting: PostingState;
  windowOpen: boolean;
}): ReconciliationStatus {
  if (input.accruedDays === 0) return "no_data";
  if (input.posting === "claimed" || input.posting === "indeterminate") return "indeterminate";
  if (input.paidCents === null) return "no_data";
  const difference = input.paidCents - input.accruedCents;
  if (difference >= -1n && difference <= 1n) return "matched";
  if (input.paidCents === 0n) return input.windowOpen ? "delayed" : "missing";
  if (difference < 0n && input.windowOpen) return "delayed";
  return "anomalous";
}

/** At most this many tiers per rule. */
export const MAX_TIERS = 10;

/**
 * Tiers the engine can run (spec §7.6: unsupported settings refused, never accepted and ignored):
 * thresholds strictly increasing, the last and only the last open, rates between 0 and 1.
 */
export function validateTiers(tiers: readonly Tier[]): boolean {
  if (tiers.length === 0 || tiers.length > MAX_TIERS) return false;
  let previous = 0n;
  for (const [index, tier] of tiers.entries()) {
    const last = index === tiers.length - 1;
    if (last !== (tier.upToCents === null)) return false;
    if (tier.upToCents !== null) {
      if (tier.upToCents <= previous) return false;
      previous = tier.upToCents;
    }
    let rate: Fixed;
    try {
      rate = fixedFromDecimal(tier.annualRate);
    } catch {
      return false;
    }
    if (rate < 0n || rate > FIXED_SCALE) return false;
  }
  return true;
}

/**
 * A percentage as typed, already in plain decimal form ("2.75", "26"), as the fraction a rate
 * column stores ("0.0275"), exactly: the point moves two places, no float. Up to four decimals of a
 * percent (six of the fraction).
 */
export function percentToFraction(plain: string): string {
  const match = /^(\d{1,3})(?:\.(\d{1,4}))?$/.exec(plain.trim());
  if (!match) throw new RangeError(`Not a percentage: "${plain}"`);
  const [, whole, decimals = ""] = match;
  const digits = (whole.padStart(3, "0") + decimals.padEnd(4, "0")).replace(/^0+(?=\d)/, "");
  const scaled = BigInt(digits); // hundredths of a basis point: the fraction × 10⁶
  const fraction = scaled.toString().padStart(7, "0");
  return `${fraction.slice(0, -6)}.${fraction.slice(-6)}`;
}

/** A stored fraction ("0.027500") as the percentage it is, trimmed ("2.75"). */
export function fractionToPercent(fraction: string): string {
  const scaled = fixedFromDecimal(fraction) / 1_000_000n; // the fraction × 10⁶: hundredths of a basis point
  const whole = scaled / 10_000n;
  const decimals = (scaled % 10_000n).toString().padStart(4, "0").replace(/0+$/, "");
  return decimals === "" ? `${whole}` : `${whole}.${decimals}`;
}

/**
 * Where the bank's payment of a settlement is looked for (plan F4 §3.4.5): from the day after the
 * period for 10 days; for a daily payout, from the day itself to two days after, since a bank that
 * pays every day may date it on the day or the next.
 */
export function paymentWindow(
  frequency: Settlement,
  period: { to: CivilDate; settleOn: CivilDate },
): { from: CivilDate; to: CivilDate } {
  if (frequency === "daily") return { from: period.to, to: addDays(period.to, 2) };
  return { from: period.settleOn, to: addDays(period.settleOn, 10) };
}

/**
 * The payments of each settlement, each payment counted **once** (windows overlap, and a daily
 * payout's overlap every day). Settlements are served in date order, each taking the payments in
 * its window that no earlier one took: all of them for a period payout, the first one for a daily
 * payout, which is paid once. Returns the ids taken per settlement, in its order.
 */
export function assignPayments(
  frequency: Settlement,
  settlements: readonly { id: string; to: CivilDate; settleOn: CivilDate }[],
  payments: readonly { id: string; on: CivilDate }[],
): Map<string, string[]> {
  const byDate = [...payments].sort((a, b) => (a.on < b.on ? -1 : a.on > b.on ? 1 : a.id < b.id ? -1 : 1));
  const taken = new Set<string>();
  const result = new Map<string, string[]>();
  for (const settlement of [...settlements].sort((a, b) => (a.to < b.to ? -1 : 1))) {
    const window = paymentWindow(frequency, settlement);
    const inWindow = byDate.filter(
      (payment) => !taken.has(payment.id) && payment.on >= window.from && payment.on <= window.to,
    );
    const mine = frequency === "daily" ? inWindow.slice(0, 1) : inWindow;
    for (const payment of mine) taken.add(payment.id);
    result.set(
      settlement.id,
      mine.map((payment) => payment.id),
    );
  }
  return result;
}
