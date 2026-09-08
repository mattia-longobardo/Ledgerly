import type { MonthPoint } from "@/lib/contracts";
import { addMonths, monthKey, monthKeyOf, yearOf } from "@/lib/time";
import { fromCents, sumCents, toCents, type MoneyInput } from "./money";
import { rangeToMonths, type RangeOptions, type RangeSpec } from "./series";

export interface PayslipLike {
  month: string;
  isThirteenth: boolean;
  /** Absent means "already filtered by the caller"; only 'verified' counts otherwise. */
  status?: string;
  supersededBy?: number | null;
  gross?: MoneyInput;
  net?: MoneyInput;
  taxes?: MoneyInput;
  fundContribEmployee?: MoneyInput;
  fundContribEmployer?: MoneyInput;
  verifiedAt?: Date | string | null;
}

export interface AnnualTotals {
  gross: number;
  net: number;
  taxes: number;
  cometaDeposits: number;
}

export interface Ral {
  ytdGross: number;
  projected: number | null;
  isProjected: boolean;
}

export interface AverageOptions {
  now?: Date;
  /** Last month of the window; defaults to the current month. */
  asOf?: string;
}

export function isVerified(p: PayslipLike): boolean {
  const statusOk = p.status === undefined || p.status === "verified";
  return statusOk && (p.supersededBy === undefined || p.supersededBy === null);
}

function ordinary(payslips: readonly PayslipLike[]): PayslipLike[] {
  return payslips.filter((p) => isVerified(p) && p.isThirteenth === false);
}

function windowAverage(
  payslips: readonly PayslipLike[],
  months: number,
  field: "net" | "taxes",
  opts: AverageOptions,
): number | null {
  if (months < 1) return null;
  const to = monthKeyOf(opts.asOf ?? monthKey(opts.now ?? new Date()));
  const from = addMonths(to, -(months - 1));
  const byMonth = new Map<string, number>();
  for (const p of ordinary(payslips)) {
    const m = monthKeyOf(p.month);
    if (m < from || m > to) continue;
    const c = toCents(p[field]);
    if (c === null || byMonth.has(m)) continue;
    byMonth.set(m, c);
  }
  if (byMonth.size < 1) return null;
  let total = 0;
  for (const c of byMonth.values()) total += c;
  return fromCents(Math.round(total / byMonth.size));
}

/** Tredicesima never enters an average: it would inflate every denominator's numerator. */
export function averageNet(
  payslips: readonly PayslipLike[],
  months: number,
  opts: AverageOptions = {},
): number | null {
  return windowAverage(payslips, months, "net", opts);
}

export function averageTaxes(
  payslips: readonly PayslipLike[],
  months: number,
  opts: AverageOptions = {},
): number | null {
  return windowAverage(payslips, months, "taxes", opts);
}

function inYear(payslips: readonly PayslipLike[], year: number): PayslipLike[] {
  return payslips.filter((p) => isVerified(p) && yearOf(monthKeyOf(p.month)) === year);
}

/** Annual figures INCLUDE the tredicesima — it is real money in a real year. */
export function annualTotals(payslips: readonly PayslipLike[], year: number): AnnualTotals {
  const rows = inYear(payslips, year);
  return {
    gross: fromCents(sumCents(rows.map((p) => p.gross))),
    net: fromCents(sumCents(rows.map((p) => p.net))),
    taxes: fromCents(sumCents(rows.map((p) => p.taxes))),
    cometaDeposits: fromCents(
      sumCents(rows.map((p) => p.fundContribEmployee)) +
        sumCents(rows.map((p) => p.fundContribEmployer)),
    ),
  };
}

/**
 * RAL = sum of TOTALE LORDO across the year, tredicesima included. An
 * incomplete year annualises the ordinary months observed so far and adds the
 * tredicesima (actual when already filed, otherwise one further ordinary month).
 */
export function ral(
  payslips: readonly PayslipLike[],
  year: number,
  opts: { now?: Date } = {},
): Ral {
  const rows = inYear(payslips, year);
  const ytdCents = sumCents(rows.map((p) => p.gross));
  const complete = year < yearOf(monthKey(opts.now ?? new Date()));
  if (complete) return { ytdGross: fromCents(ytdCents), projected: null, isProjected: false };

  const ordinaryByMonth = new Map<string, number>();
  let thirteenthCents = 0;
  for (const p of rows) {
    const c = toCents(p.gross);
    if (c === null) continue;
    if (p.isThirteenth) thirteenthCents += c;
    else ordinaryByMonth.set(monthKeyOf(p.month), c);
  }
  if (ordinaryByMonth.size === 0) {
    return { ytdGross: fromCents(ytdCents), projected: null, isProjected: true };
  }
  let ordinaryCents = 0;
  for (const c of ordinaryByMonth.values()) ordinaryCents += c;
  const avgMonth = ordinaryCents / ordinaryByMonth.size;
  const projectedCents = avgMonth * 12 + (thirteenthCents > 0 ? thirteenthCents : avgMonth);
  return {
    ytdGross: fromCents(ytdCents),
    projected: fromCents(Math.round(projectedCents)),
    isProjected: true,
  };
}

export function netPerMonthSeries(
  payslips: readonly PayslipLike[],
  range: RangeSpec,
  opts: RangeOptions & { includeThirteenth?: boolean } = {},
): MonthPoint[] {
  const byMonth = new Map<string, number>();
  const observed: string[] = [];
  for (const p of payslips) {
    if (!isVerified(p)) continue;
    if (p.isThirteenth && opts.includeThirteenth !== true) continue;
    const m = monthKeyOf(p.month);
    observed.push(m);
    const c = toCents(p.net);
    if (c === null) continue;
    byMonth.set(m, (byMonth.get(m) ?? 0) + c);
  }
  const earliest = opts.earliest ?? observed.sort()[0] ?? null;
  return rangeToMonths(range, { now: opts.now, earliest }).map((month) => ({
    month,
    value: fromCents(byMonth.get(month) ?? null),
  }));
}

const THIRTEENTH_KEYWORDS = [
  /TREDICESIMA/,
  /\b13\s*(?:MA|ESIMA|A)(?![A-Z])/,
  /13\s*ª/,
  /GRATIFICA\s+NATALIZIA/,
];
const STRONG_NET_RATIO = 1.75;
const DECEMBER_NET_RATIO = 1.35;

/**
 * December alone is not evidence — the ordinary December payslip is a normal
 * month — so the calendar signal only counts next to an elevated net.
 */
export function isThirteenthCandidate(input: {
  month?: string | null;
  net?: MoneyInput;
  medianNet?: MoneyInput;
  text?: string | null;
}): boolean {
  const text = (input.text ?? "").toUpperCase();
  if (THIRTEENTH_KEYWORDS.some((re) => re.test(text))) return true;

  const net = toCents(input.net);
  const median = toCents(input.medianNet);
  if (net === null || median === null || median <= 0) return false;
  const ratio = net / median;
  if (ratio >= STRONG_NET_RATIO) return true;
  const isDecember = input.month ? monthKeyOf(input.month).slice(5, 7) === "12" : false;
  return isDecember && ratio >= DECEMBER_NET_RATIO;
}

