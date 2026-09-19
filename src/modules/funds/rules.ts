import { type CivilDate, lastDayOfMonth, type MonthKey, monthKey } from "@/platform/dates";
import type { Cents } from "@/platform/money";

export const FUND_TYPES = ["pac", "pension"] as const;
export const FUND_STATES = ["active", "archived"] as const;
export const VALUATION_SOURCES = ["manual", "import"] as const;
export const DEPOSIT_SOURCES = ["manual", "rule"] as const;

export type FundType = (typeof FUND_TYPES)[number];
export type FundState = (typeof FUND_STATES)[number];
export type ValuationSource = (typeof VALUATION_SOURCES)[number];
export type DepositSource = (typeof DEPOSIT_SOURCES)[number];

export interface DepositLike {
  on: CivilDate;
  chargedCents: Cents;
  /** `null` while the fee is unknown. */
  feeCents: Cents | null;
}

export interface FundMetrics {
  /** What left the bank: the deposits as debited. */
  paidInCents: Cents;
  /** The fees known. */
  feesCents: Cents;
  /** What reached the fund; the known part when a fee is unknown (`investedPartial`). */
  investedCents: Cents;
  investedPartial: boolean;
  valueCents: Cents | null;
  /** Value − paid in (plan F4 §3.6.5): the fees are a cost of the plan. */
  gainCents: Cents | null;
  gainFraction: number | null;
}

/** A fraction of two amounts as a number, from integers: exact to a millionth, no float on the way in. */
function ratio(part: Cents, whole: Cents): number {
  return Number((part * 1_000_000_000n) / whole) / 1_000_000_000;
}

/** Spec §7.7 PAC metrics: paid in, value, gain and cumulative %, with the fees apart. */
export function fundMetrics(deposits: readonly DepositLike[], valueCents: Cents | null): FundMetrics {
  let paidIn = 0n;
  let fees = 0n;
  let invested = 0n;
  let partial = false;
  for (const deposit of deposits) {
    paidIn += deposit.chargedCents;
    if (deposit.feeCents === null) partial = true;
    else {
      fees += deposit.feeCents;
      invested += deposit.chargedCents - deposit.feeCents;
    }
  }
  const gain = valueCents === null ? null : valueCents - paidIn;
  return {
    paidInCents: paidIn,
    feesCents: fees,
    investedCents: invested,
    investedPartial: partial,
    valueCents,
    gainCents: gain,
    gainFraction: gain === null || paidIn === 0n ? null : ratio(gain, paidIn),
  };
}

/**
 * The month's return by Simple Dietz (spec §7.7): `(V − Vprev − flows) / (Vprev + flows)`, the
 * flows being what was paid in during the month. Unknown without both ends, or on nothing invested.
 */
export function simpleDietz(previous: Cents | null, value: Cents | null, flows: Cents): number | null {
  if (previous === null || value === null) return null;
  const base = previous + flows;
  if (base <= 0n) return null;
  return ratio(value - previous - flows, base);
}

/**
 * One return per month of `months`. `ends` holds the value at the end of the month **before** the
 * first, then one per month, so `ends.length === months.length + 1`.
 */
export function monthlyReturns(
  months: readonly MonthKey[],
  ends: readonly (Cents | null)[],
  flowsByMonth: ReadonlyMap<MonthKey, Cents>,
): (number | null)[] {
  return months.map((month, index) =>
    simpleDietz(ends[index], ends[index + 1], flowsByMonth.get(month) ?? 0n),
  );
}

/** The design's footer of the chart: best, worst, positive months, and the months compounded. */
export function returnStats(returns: readonly (number | null)[]): {
  best: number | null;
  worst: number | null;
  positive: number;
  counted: number;
  compounded: number | null;
} {
  const known = returns.filter((value): value is number => value !== null);
  if (known.length === 0) return { best: null, worst: null, positive: 0, counted: 0, compounded: null };
  return {
    best: Math.max(...known),
    worst: Math.min(...known),
    positive: known.filter((value) => value > 0).length,
    counted: known.length,
    compounded: known.reduce((product, value) => product * (1 + value), 1) - 1,
  };
}

/** What was paid in by the end of each month (the "paid in" line of the charts). */
export function cumulativeAt(deposits: readonly DepositLike[], months: readonly MonthKey[]): Cents[] {
  return months.map((month) => {
    const end = lastDayOfMonth(month);
    return deposits
      .filter((deposit) => deposit.on <= end)
      .reduce<Cents>((sum, deposit) => sum + deposit.chargedCents, 0n);
  });
}

/** The deposits of each month, added up by the day they were charged. */
export function flowsByMonth(deposits: readonly DepositLike[]): Map<MonthKey, Cents> {
  const flows = new Map<MonthKey, Cents>();
  for (const deposit of deposits) {
    const month = monthKey(deposit.on);
    flows.set(month, (flows.get(month) ?? 0n) + deposit.chargedCents);
  }
  return flows;
}
