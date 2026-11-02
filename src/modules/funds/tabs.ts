// The numbers of a fund's tabs (docs/design/funds-ux.md §4, §5.3, §6, F4). Pure, and on top of `home.ts`:
// a stretch here is the stretch the chart draws, so its gains add up to the gain of the Overview.
import {
  addDays,
  addMonths,
  type CivilDate,
  lastDayOfMonth,
  type MonthKey,
  monthKey,
} from "@/platform/dates";
import { legacyPeriodQuery, type Query } from "@/modules/investments/period";
import type { Cents } from "@/platform/money";
import { type FundLine, stretchesOf } from "./home";
import { closingDay, type FundFlow, type FundPeriod, type ValuePoint } from "./period";
import { deductibilityLimit } from "./pension/rules";
import { periodReturns, periodStats } from "./rules";

/** Whether a day falls in a period, both ends included. */
export const inPeriod = (on: string, period: FundPeriod): boolean =>
  (period.from === null || on >= period.from) && on <= period.to;

/**
 * Whether a reading belongs to a period. A reading on the 1st closes the month before (decision 3 of §9), so a
 * statement of 1 January belongs to the year before, as a value of that day does.
 */
export const readsPeriod = (on: string, period: FundPeriod): boolean =>
  (period.from === null || on > closingDay(addDays(period.from, -1))) && on <= closingDay(period.to);

/** A reading inside the dates of a period that closes the period before: it says nothing about this one. */
export const closesPeriodBefore = (on: string, period: FundPeriod): boolean =>
  period.from !== null && on >= period.from && on <= closingDay(addDays(period.from, -1));

const quarterStart = (year: number, quarter: number): MonthKey =>
  addMonths(monthKey(`${year}-01-01`), (quarter - 1) * 3);

/**
 * The day a payslip's contribution counts on: its month, or the first day of its quarter for a payslip with
 * no month, such as a thirteenth. The home counts the accrued money on this same day.
 */
export function competenceOn(line: {
  payrollPeriod: string | null;
  year: number;
  quarter: number;
}): CivilDate {
  return (line.payrollPeriod ?? quarterStart(line.year, line.quarter)) as CivilDate;
}

/**
 * Whether a quarter has something to say in a period: its three months touch it, or its deadline or a credit
 * of its money fall in it. So the fourth quarter of a year, credited in January, is in both years.
 */
export function quarterInPeriod(
  quarter: { year: number; quarter: number; due: CivilDate | null; operationDates: readonly CivilDate[] },
  period: FundPeriod,
): boolean {
  const from = quarterStart(quarter.year, quarter.quarter);
  const to = lastDayOfMonth(addMonths(from, 2));
  const touches = (period.from === null || to >= period.from) && from <= period.to;
  return (
    touches ||
    (quarter.due !== null && inPeriod(quarter.due, period)) ||
    quarter.operationDates.some((on) => inPeriod(on, period))
  );
}

export interface DeductibleYear {
  year: number;
  youCents: Cents;
  employerCents: Cents;
  /** You + employer, TFR excluded: the same figure as the "Deductible used" KPI of that year. */
  usedCents: Cents;
  limitCents: Cents | null;
}

/**
 * The deductible money by calendar year, newest first (§5.3), from the flows the KPI reads, so the two cannot
 * differ: an enrolment fee is in neither. A custom period shows the whole of each year it touches, because the
 * limit is a limit of the whole year. Money dated after today is not there yet, for the KPI too.
 */
export function deductibleYears(
  flows: readonly FundFlow[],
  period: FundPeriod,
  todayOn: CivilDate,
): DeductibleYear[] {
  const firstYear = period.from === null ? null : Number(period.from.slice(0, 4));
  const lastYear = Number(period.to.slice(0, 4));
  const years = new Map<number, DeductibleYear>();
  for (const { on, origin, deductible } of flows) {
    if (!deductible || on > todayOn) continue;
    const year = Number(on.slice(0, 4));
    if (year > lastYear || (firstYear !== null && year < firstYear)) continue;
    if (origin.youCents === 0n && origin.employerCents === 0n) continue;
    const row = years.get(year) ?? {
      year,
      youCents: 0n,
      employerCents: 0n,
      usedCents: 0n,
      limitCents: deductibilityLimit(year),
    };
    row.youCents += origin.youCents;
    row.employerCents += origin.employerCents;
    row.usedCents = row.youCents + row.employerCents;
    years.set(year, row);
  }
  return [...years.values()].sort((a, b) => b.year - a.year);
}

export interface ValuationLine {
  /** The reading's own day. */
  on: CivilDate;
  valueCents: Cents;
  /** `stretch`: from the reading before. `first`: from no value, with the money that went in. `position`: a first value with no money before it. */
  kind: "stretch" | "first" | "position";
  /** The reading before this one; `null` when there is none. */
  fromOn: CivilDate | null;
  /** The money that entered between the two readings; `null` for a position. */
  paidCents: Cents | null;
  /** `null` for a position: it is a starting point, not a gain. */
  gainCents: Cents | null;
  /** Gain ÷ (value at the start + what went in), never annualised. Only between two readings. */
  rate: number | null;
}

const pointOn = (points: readonly ValuePoint[], on: CivilDate) => points.find((point) => point.on === on);

/**
 * One line per reading a period can see, newest first (§6). The gains are `stretchesOf`'s, so they add up to
 * the gain of the Overview to the cent. The return is the one the old returns page showed, for one stretch.
 */
export function valuationLines(line: FundLine, period: FundPeriod): ValuationLine[] {
  const { fund, measure } = line;
  if (measure.status !== "measured") return [];
  const start = measure.start!;
  const lines: ValuationLine[] = stretchesOf(line).map((stretch) => {
    const before = pointOn(fund.points, stretch.from);
    const reading = pointOn(fund.points, stretch.to)!;
    const flows = fund.flows.filter((flow) => flow.on > stretch.from && flow.on <= stretch.to);
    return {
      on: stretch.to,
      valueCents: reading.cents,
      kind: before ? ("stretch" as const) : ("first" as const),
      fromOn: before ? stretch.from : null,
      paidCents: flows.reduce<Cents>((sum, flow) => sum + flow.chargedCents, 0n),
      gainCents: stretch.gainCents,
      rate: before ? (periodReturns([before, reading], fund.flows)[0]?.fraction ?? null) : null,
    };
  });
  // The first value with no money before it opens the period, unless an earlier period closes on it.
  const opening = pointOn(fund.points, start.on);
  const closedBefore = period.from !== null && start.on <= closingDay(addDays(period.from, -1));
  if (opening && !closedBefore) {
    lines.push({
      on: opening.on,
      valueCents: opening.cents,
      kind: "position",
      fromOn: null,
      paidCents: null,
      gainCents: null,
      rate: null,
    });
  }
  return lines.sort((a, b) => (a.on < b.on ? 1 : -1));
}

/** The best and the worst stretch of the lines. Each keeps its own dates: no span is compounded here. */
export function bestAndWorst(lines: readonly ValuationLine[]): {
  best: ValuationLine | null;
  worst: ValuationLine | null;
} {
  const measured = lines.filter((one) => one.rate !== null && one.fromOn !== null);
  const stats = periodStats(
    measured.map((one) => ({
      from: one.fromOn!,
      to: one.on,
      days: 0,
      fromCents: 0n,
      toCents: 0n,
      flowsCents: 0n,
      gainCents: 0n,
      fraction: one.rate!,
    })),
  );
  const pick = (to: CivilDate | undefined) => measured.find((one) => one.on === to) ?? null;
  return { best: pick(stats.best?.to), worst: pick(stats.worst?.to) };
}

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

const flat = (query: Query): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(query)) {
    const first = one(value);
    if (first !== undefined) out[name] = first;
  }
  return out;
};

/**
 * The address of the old page sent to the new parameters (§6). `from` and `to` by month are
 * `legacyPeriodQuery`'s, and they win, as they did on the old page. `span` chose the last months of a chart:
 * 60 was the old "All", 12 is the year running like the `1y` of Investments, and any other number stays the
 * same months as days. `null` when nothing is old. A `span` that is not a number of months is dropped.
 */
export function legacyFundQuery(query: Query, todayOn: CivilDate): Record<string, string> | null {
  const span = one(query.span);
  const rest = Object.fromEntries(Object.entries(query).filter(([name]) => name !== "span"));
  const legacy = legacyPeriodQuery(rest, todayOn);
  if (span === undefined) return legacy;
  // Past a century it is not a span of months: `addMonths` would write a date that does not exist.
  const months = /^[1-9]\d{0,3}$/.test(span) && Number(span) <= 1200 ? Number(span) : null;
  const named = rest.period !== undefined || rest.from !== undefined || rest.to !== undefined;
  if (legacy !== null || named || months === null || months === 12) return legacy ?? flat(rest);
  if (months === 60) return { ...flat(rest), period: "all" };
  return { ...flat(rest), from: addMonths(monthKey(todayOn), -(months - 1)), to: todayOn };
}

/**
 * Where the old returns page goes (§6): the Valuations tab of the fund, with the period the address had.
 */
export function returnsTarget(base: string, query: Query, todayOn: CivilDate): string {
  const period = legacyFundQuery(query, todayOn) ?? flat(query);
  const params = new URLSearchParams({ tab: "valuations" });
  for (const name of ["period", "from", "to"]) {
    if (period[name] !== undefined) params.set(name, period[name]);
  }
  return `${base}?${params}`;
}
