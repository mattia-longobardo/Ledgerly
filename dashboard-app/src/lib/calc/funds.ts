import { addMonths, monthKeyOf } from "@/lib/time";
import { fromCents, sumCents, toCents, type MoneyInput } from "./money";
import {
  pointsOf,
  rangeToMonths,
  type RangeOptions,
  type RangeSpec,
  type SeriesLike,
} from "./series";

export interface FundSettingRow {
  effectiveFrom: string;
  initialCapital?: MoneyInput;
  depositMode?: string;
  fixedMonthlyAmount?: MoneyInput;
}

export interface FundDepositRow {
  month: string;
  amount: MoneyInput;
}

export interface ReturnRow {
  month: string;
  value: number | null;
  deposited: number;
  absReturn: number | null;
  monthAbs: number | null;
  monthPct: number | null;
}

export interface MonthlyReturnInput {
  valueM: MoneyInput;
  valuePrev: MoneyInput;
  depositsInM?: MoneyInput;
}

export interface MonthlyReturn {
  abs: number | null;
  /** Percentage points, e.g. 2.86 for +2.86 % — matches formatPercent. */
  pct: number | null;
}

/** Latest row whose `effective_from` is at or before the month. */
export function effectiveSetting<T extends { effectiveFrom: string }>(
  settings: readonly T[],
  month: string,
): T | null {
  const key = monthKeyOf(month);
  let best: T | null = null;
  let bestFrom = "";
  for (const s of settings) {
    const from = monthKeyOf(s.effectiveFrom);
    if (from <= key && (best === null || from >= bestFrom)) {
      best = s;
      bestFrom = from;
    }
  }
  return best;
}

function initialCapitalCents(settings: readonly FundSettingRow[]): number {
  let earliest: FundSettingRow | undefined;
  for (const s of settings) {
    if (!earliest || monthKeyOf(s.effectiveFrom) < monthKeyOf(earliest.effectiveFrom)) earliest = s;
  }
  return toCents(earliest?.initialCapital) ?? 0;
}

/**
 * Initial capital of the earliest settings row plus every deposit up to and
 * including M. Both deposit modes write fund_deposits, so a fixed→payroll
 * switch cannot show up here.
 */
export function totalDeposited(
  settings: readonly FundSettingRow[],
  deposits: readonly FundDepositRow[],
  month: string,
): number {
  const key = monthKeyOf(month);
  const cents =
    initialCapitalCents(settings) +
    sumCents(deposits.filter((d) => monthKeyOf(d.month) <= key).map((d) => d.amount));
  return fromCents(cents);
}

/** Latest observed fund value at or before the month; gaps do not carry forward. */
export function currentValue(series: SeriesLike, month: string): number | null {
  const key = monthKeyOf(month);
  let best: { month: string; value: number } | null = null;
  for (const p of pointsOf(series)) {
    const m = monthKeyOf(p.month);
    if (m > key || p.value === null) continue;
    if (best === null || m >= best.month) best = { month: m, value: p.value };
  }
  return best === null ? null : best.value;
}

export function absoluteReturn(value: MoneyInput, deposited: MoneyInput): number | null {
  const v = toCents(value);
  if (v === null) return null;
  return fromCents(v - (toCents(deposited) ?? 0));
}

/** Simple-Dietz with deposits treated as start-of-month. */
export function monthlyReturn(input: MonthlyReturnInput): MonthlyReturn {
  const v = toCents(input.valueM);
  const prev = toCents(input.valuePrev);
  if (v === null || prev === null) return { abs: null, pct: null };
  const dep = toCents(input.depositsInM) ?? 0;
  const absCents = v - prev - dep;
  const denom = prev + dep;
  return {
    abs: fromCents(absCents),
    pct: denom === 0 ? null : (absCents / denom) * 100,
  };
}

export function returnTable(
  settings: readonly FundSettingRow[],
  deposits: readonly FundDepositRow[],
  series: SeriesLike,
  range: RangeSpec,
  opts: RangeOptions = {},
): ReturnRow[] {
  const valueByMonth = new Map<string, number>();
  const observed: string[] = [];
  for (const p of pointsOf(series)) {
    const m = monthKeyOf(p.month);
    observed.push(m);
    const c = toCents(p.value);
    if (c !== null) valueByMonth.set(m, c);
  }

  const depositsByMonth = new Map<string, number>();
  for (const d of deposits) {
    const m = monthKeyOf(d.month);
    observed.push(m);
    depositsByMonth.set(m, (depositsByMonth.get(m) ?? 0) + (toCents(d.amount) ?? 0));
  }

  const earliest = opts.earliest ?? observed.sort()[0] ?? null;
  const months = rangeToMonths(range, { now: opts.now, earliest });

  return months.map((month) => {
    const value = valueByMonth.get(month) ?? null;
    const deposited = totalDeposited(settings, deposits, month);
    const prev = valueByMonth.get(addMonths(month, -1)) ?? null;
    const depositsInM = depositsByMonth.get(month) ?? 0;
    const { abs, pct } = monthlyReturn({
      valueM: fromCents(value),
      valuePrev: fromCents(prev),
      depositsInM: fromCents(depositsInM),
    });
    return {
      month,
      value: fromCents(value),
      deposited,
      absReturn: value === null ? null : fromCents(value - ((toCents(deposited) ?? 0))),
      monthAbs: abs,
      monthPct: pct,
    };
  });
}
