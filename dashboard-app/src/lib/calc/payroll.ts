import type { MonthPoint } from "@/lib/contracts";
import { hoursToDays } from "@/lib/format";
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
  ferieBalance?: MoneyInput;
  ferieUnit?: string | null;
  rolBalance?: MoneyInput;
  rolUnit?: string | null;
  /** `FERIE GOD.` — hours used, reported one month in arrears (see below). */
  ferieTaken?: MoneyInput;
  /** `ROL. GOD.` — hours used, reported one month in arrears. */
  rolTaken?: MoneyInput;
  permessiBalance?: MoneyInput;
  permessiUnit?: string | null;
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

export interface FerieRemaining {
  ferieHours: number | null;
  rolHours: number | null;
  combinedHours: number | null;
  combinedDays: number | null;
  /** Secondary figure — deliberately outside the headline. */
  permessiHours: number | null;
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

function toHours(value: MoneyInput, unit: string | null | undefined, hoursPerDay: number): number | null {
  const cents = toCents(value);
  if (cents === null) return null;
  const raw = cents / 100;
  return unit === "days" ? raw * hoursPerDay : raw;
}

/**
 * Payslip-authoritative residuals. Ferie + ROL make the headline; permessi is
 * returned alongside but must never be folded into it.
 */
export function ferieRemaining(
  payslip: PayslipLike | null | undefined,
  hoursPerDay = 8,
): FerieRemaining {
  const empty: FerieRemaining = {
    ferieHours: null,
    rolHours: null,
    combinedHours: null,
    combinedDays: null,
    permessiHours: null,
  };
  if (!payslip) return empty;
  const ferieHours = toHours(payslip.ferieBalance, payslip.ferieUnit, hoursPerDay);
  const rolHours = toHours(payslip.rolBalance, payslip.rolUnit, hoursPerDay);
  const permessiHours = toHours(payslip.permessiBalance, payslip.permessiUnit, hoursPerDay);
  const combinedHours =
    ferieHours === null && rolHours === null ? null : (ferieHours ?? 0) + (rolHours ?? 0);
  return {
    ferieHours,
    rolHours,
    combinedHours,
    combinedDays: hoursToDays(combinedHours, hoursPerDay),
    permessiHours,
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

export interface LeaveTakenMonth {
  /** The month the leave was actually used, not the payslip's own month. */
  month: string;
  ferieHours: number;
  rolHours: number;
  totalHours: number;
  ferieDays: number;
  rolDays: number;
  totalDays: number;
}

/**
 * Leave actually used, per month.
 *
 * Attributed to the month BEFORE the payslip's own, on the owner's rule:
 * "FERIE GOD ... sono quelle usate il mese prima del cedolino, quindi agosto
 * ha luglio". The source is the grid's `FERIE GOD.` column, confirmed by the
 * owner at 12,01 h on the August 2026 payslip.
 *
 * Known inconsistency, left for the human verification screen rather than
 * papered over: on the July payslip the column reads 4,01 h, which under this
 * rule means June — yet June's residual rises by the full monthly accrual,
 * i.e. nothing was taken. The August figure does reconcile (12,01 against
 * July's own usage of 12,00), so the rule holds there. Values reaching a
 * statistic can be corrected on the verification screen.
 */
export function leaveTakenByMonth(
  payslips: PayslipLike[],
  hoursPerDay = 8,
): LeaveTakenMonth[] {
  const perMonth = new Map<string, { ferie: number; rol: number }>();

  for (const p of payslips) {
    if (!isVerified(p) || p.isThirteenth) continue;
    const ferie = toCents(p.ferieTaken ?? null);
    const rol = toCents(p.rolTaken ?? null);
    if (ferie === null && rol === null) continue;

    const used = addMonths(p.month, -1);
    const acc = perMonth.get(used) ?? { ferie: 0, rol: 0 };
    acc.ferie += fromCents(ferie ?? 0);
    acc.rol += fromCents(rol ?? 0);
    perMonth.set(used, acc);
  }

  const div = hoursPerDay > 0 ? hoursPerDay : 8;
  return [...perMonth.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([month, v]) => ({
      month,
      ferieHours: v.ferie,
      rolHours: v.rol,
      totalHours: Number((v.ferie + v.rol).toFixed(2)),
      ferieDays: Number((v.ferie / div).toFixed(2)),
      rolDays: Number((v.rol / div).toFixed(2)),
      totalDays: Number(((v.ferie + v.rol) / div).toFixed(2)),
    }));
}

/** Year-to-date leave used, in days — the "days taken YTD" tile on Work. */
export function leaveTakenYtd(
  payslips: PayslipLike[],
  year: number,
  hoursPerDay = 8,
): { ferieDays: number; rolDays: number; totalDays: number } {
  const rows = leaveTakenByMonth(payslips, hoursPerDay).filter(
    (r) => yearOf(r.month) === year,
  );
  const sum = (pick: (r: LeaveTakenMonth) => number) =>
    Number(rows.reduce((a, r) => a + pick(r), 0).toFixed(2));
  return {
    ferieDays: sum((r) => r.ferieDays),
    rolDays: sum((r) => r.rolDays),
    totalDays: sum((r) => r.totalDays),
  };
}
