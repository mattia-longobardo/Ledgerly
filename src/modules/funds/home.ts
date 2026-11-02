// The numbers of the Funds home (docs/design/funds-ux.md §5.3, §6, F2). Pure: the caller reads the
// rows, and `measurePeriod` (period.ts) stays the only place that says what a gain is. This file adds
// the portfolio on top of it: which funds count in a period, the state of the page, the chart.
import {
  addDays,
  type CivilDate,
  daysBetween,
  lastDayOfMonth,
  monthKey,
  monthsBetween,
} from "@/platform/dates";
import type { Cents } from "@/platform/money";
import { modifiedDietz } from "@/modules/investments/pnl";
import { xirr, type Xirr } from "@/modules/investments/xirr";
import {
  closingDay,
  type FundFlow,
  type FundPeriod,
  measurePeriod,
  type MoneyOrigin,
  type PeriodMeasure,
  startOf,
  type ValuePoint,
  yearPeriod,
} from "./period";
import { deductibilityLimit } from "./pension/rules";

/**
 * What the address cannot mean (§6): a year still to come goes back to the year running. A year older
 * than the first data stays, because the page has something to say about it.
 */
export function isFutureYear(period: string | undefined, todayOn: CivilDate): boolean {
  return period !== undefined && /^\d{4}$/.test(period) && Number(period) > Number(todayOn.slice(0, 4));
}

/** A value older than this asks to be updated (decision 7 of §9). */
export const STALE_DAYS = 31;
/** Past this spread between the dates of the values, a percentage of the portfolio means nothing (§5.3). */
export const AGGREGATE_RATE_DAYS = 45;
/** Up to a quarter, a custom period draws the stretches between the values (§6). */
export const STRETCH_DAYS = 92;

/** One month of a payslip's contributions: money accrued, not yet in the fund. */
export interface AccruedLine {
  on: CivilDate;
  cents: Cents;
  /** The deadline of its quarter, when the money reaches the fund. */
  dueOn: CivilDate | null;
}

export interface HomeFund {
  id: string;
  name: string;
  type: "pac" | "pension";
  archived: boolean;
  points: readonly ValuePoint[];
  flows: readonly FundFlow[];
  accrued: readonly AccruedLine[];
}

/** The day a reading describes: one taken on the 1st closes the month before (decision 3 of §9). */
export function describedDay(on: CivilDate): CivilDate {
  return on.endsWith("-01") ? addDays(on, -1) : on;
}

const sortedPoints = (points: readonly ValuePoint[]) =>
  [...points].sort((a, b) => (a.on < b.on ? -1 : a.on > b.on ? 1 : 0));

const lastUpTo = (points: readonly ValuePoint[], on: CivilDate): ValuePoint | null => {
  let found: ValuePoint | null = null;
  for (const point of points) if (point.on <= on && (found === null || point.on > found.on)) found = point;
  return found;
};

/**
 * The first day the stepper has to reach (§6): a deposit, a value, an operation or a payslip. A first
 * value on the 1st of a month with money already in describes the month before, so the gain falls
 * there, in the year before when it is the 1st of January, and the stepper must walk to it.
 */
export function firstDataOn(funds: readonly HomeFund[]): CivilDate | null {
  const days: CivilDate[] = [];
  for (const fund of funds) {
    for (const flow of fund.flows) days.push(flow.on);
    for (const line of fund.accrued) days.push(line.on);
    const first = sortedPoints(fund.points)[0];
    if (!first) continue;
    const funded = fund.flows.some((flow) => flow.chargedCents > 0n && flow.on <= first.on);
    days.push(funded ? describedDay(first.on) : first.on);
  }
  return days.length === 0 ? null : days.sort()[0];
}

export type LineStatus = "measured" | "no_value_in_period" | "never_valued";

export interface FundLine {
  fund: HomeFund;
  measure: PeriodMeasure;
  status: LineStatus;
  accruedCents: Cents;
}

export type HomeState =
  /** The period ends before the first data there is. */
  | "before_first"
  /** Every fund in the period has its gain. */
  | "measured"
  /** Some funds have their gain, others do not: the hero says "available". */
  | "partial"
  /** The period runs to today and no value falls in it yet. */
  | "running_no_value"
  /** Money went in during the period, and no value measures it. */
  | "paid_no_value"
  /** Only the payslips know about this period. */
  | "payslips_only"
  /** Nothing moved, and no value was recorded. */
  | "quiet";

export interface HomeSummary {
  state: HomeState;
  lines: FundLine[];
  /** Σ of the measured funds; `null`, never zero, when no fund can be measured. */
  gainCents: Cents | null;
  marketCents: Cents | null;
  /** The measured funds' fees, so market − fees = gain; every fund's when none is measured. */
  feesCents: Cents;
  feesPartial: boolean;
  paidInCents: Cents;
  origin: MoneyOrigin;
  rate: number | null;
  xirr: Xirr | null;
  /** Σ of the last values each fund's period can see, with their dates. */
  valueCents: Cents | null;
  valueFrom: CivilDate | null;
  valueTo: CivilDate | null;
  notInValueCents: Cents;
  accruedCents: Cents;
  /** Tu + azienda on the pension funds against the year's limit; only for a calendar year. */
  deductible: { usedCents: Cents; limitCents: Cents } | null;
}

/**
 * What a fund's row and the total say it is worth. An archived fund has no value today: its old
 * reading stays in its gain, but it is not money the portfolio holds now.
 */
export function lineValue(line: FundLine, period: FundPeriod, todayOn: CivilDate): Cents | null {
  if (line.fund.archived && period.to >= todayOn) return null;
  return line.measure.end?.cents ?? null;
}

function lineOf(fund: HomeFund, period: FundPeriod): FundLine {
  const measure = measurePeriod({ points: fund.points, flows: fund.flows, period });
  const accruedCents = fund.accrued
    .filter((line) => (period.from === null || line.on >= period.from) && line.on <= period.to)
    .reduce<Cents>((sum, line) => sum + line.cents, 0n);
  return {
    fund,
    measure,
    accruedCents,
    status:
      measure.status === "measured"
        ? "measured"
        : measure.end === null
          ? "never_valued"
          : "no_value_in_period",
  };
}

/**
 * Whether a fund belongs in a period (§6, decision 5). With something to say in it, always; with
 * nothing, an open fund still has its row when the period reaches today — it is where its first value
 * is recorded — and otherwise nobody needs a line of dashes. An archived fund counts only where it has
 * data, with its badge, so the past does not change the day it is archived.
 */
function belongs(line: FundLine, period: FundPeriod, todayOn: CivilDate): boolean {
  const { measure, fund, accruedCents } = line;
  const active =
    measure.status === "measured" ||
    measure.paidInCents !== 0n ||
    measure.feesPaidCents !== 0n ||
    accruedCents !== 0n;
  if (active) return true;
  if (fund.archived) return false;
  return period.to >= todayOn || measure.end !== null;
}

const NO_ORIGIN: MoneyOrigin = { youCents: 0n, employerCents: 0n, tfrCents: 0n, otherCents: 0n };

const sum = (values: readonly Cents[]) => values.reduce<Cents>((total, one) => total + one, 0n);

const flowsIn = (fund: HomeFund, from: CivilDate, to: CivilDate) =>
  fund.flows.filter((flow) => flow.on > from && flow.on <= to);

/**
 * The percentage of the portfolio (§5.3): Σ gain over Σ average capital, on one span from the oldest
 * start to the newest value, and only while the values are close enough for that span to mean the same
 * for every fund. A fund that starts later enters as money coming in that day.
 */
function aggregateReturn(lines: readonly FundLine[]): { rate: number | null; xirr: Xirr | null } {
  const measured = lines.filter((line) => line.status === "measured");
  if (measured.length === 0) return { rate: null, xirr: null };
  if (measured.length === 1) return { rate: measured[0].measure.rate, xirr: measured[0].measure.xirr };
  const ends = measured.map((line) => line.measure.end!.on).sort();
  const to = ends[ends.length - 1];
  if (daysBetween(ends[0], to) > AGGREGATE_RATE_DAYS) return { rate: null, xirr: null };
  const from = measured.map((line) => line.measure.start!.on).sort()[0];
  if (daysBetween(from, to) <= 0) return { rate: null, xirr: null };

  let startCents = 0n;
  const flows: { on: CivilDate; cents: Cents }[] = [];
  for (const { fund, measure } of measured) {
    const start = measure.start!;
    if (start.on === from) startCents += start.cents;
    else if (start.cents !== 0n) flows.push({ on: start.on, cents: start.cents });
    for (const flow of flowsIn(fund, start.on, measure.end!.on)) {
      flows.push({ on: flow.on, cents: flow.chargedCents });
    }
  }
  const pnlCents = sum(measured.map((line) => line.measure.gainCents!));
  const endCents = sum(measured.map((line) => line.measure.end!.cents));
  return {
    rate: modifiedDietz({ from: addDays(from, 1), to, startCents, pnlCents, flows }).rate,
    xirr:
      daysBetween(from, to) >= 365
        ? xirr([
            { on: from, cents: -startCents },
            ...flows.map((flow) => ({ on: flow.on, cents: -flow.cents })),
            { on: to, cents: endCents },
          ])
        : null,
  };
}

function stateOf(input: {
  lines: readonly FundLine[];
  period: FundPeriod;
  todayOn: CivilDate;
  firstOn: CivilDate | null;
  paidInCents: Cents;
  accruedCents: Cents;
}): HomeState {
  const { lines, period, todayOn, firstOn, paidInCents, accruedCents } = input;
  if (firstOn !== null && period.to < firstOn) return "before_first";
  const measured = lines.filter((line) => line.status === "measured").length;
  if (measured > 0) return measured === lines.length ? "measured" : "partial";
  if (period.to >= todayOn) return "running_no_value";
  if (paidInCents !== 0n) return "paid_no_value";
  if (accruedCents !== 0n) return "payslips_only";
  return "quiet";
}

/** Everything the home says about one period: the hero, the KPIs and the rows, which add up to it. */
export function homeSummary(input: {
  funds: readonly HomeFund[];
  period: FundPeriod & { year?: number | null };
  todayOn: CivilDate;
  firstOn: CivilDate | null;
}): HomeSummary {
  const { funds, period, todayOn, firstOn } = input;
  const lines = funds.map((fund) => lineOf(fund, period)).filter((line) => belongs(line, period, todayOn));
  const measured = lines.filter((line) => line.status === "measured");
  const seen = lines.filter((line) => lineValue(line, period, todayOn) !== null);
  const days = seen.map((line) => line.measure.end!.on).sort();
  const origin = { ...NO_ORIGIN };
  for (const { measure } of lines) {
    origin.youCents += measure.origin.youCents;
    origin.employerCents += measure.origin.employerCents;
    origin.tfrCents += measure.origin.tfrCents;
    origin.otherCents += measure.origin.otherCents;
  }
  const paidInCents = sum(lines.map((line) => line.measure.paidInCents));
  const accruedCents = sum(lines.map((line) => line.accruedCents));
  const year = period.year ?? null;
  const limitCents = year === null ? null : deductibilityLimit(year);
  const pensions = lines.filter((line) => line.fund.type === "pension");
  const { rate, xirr: yearly } = aggregateReturn(lines);
  return {
    state: stateOf({ lines, period, todayOn, firstOn, paidInCents, accruedCents }),
    lines,
    gainCents: measured.length === 0 ? null : sum(measured.map((line) => line.measure.gainCents!)),
    marketCents: measured.length === 0 ? null : sum(measured.map((line) => line.measure.marketCents!)),
    feesCents:
      measured.length === 0
        ? sum(lines.map((line) => line.measure.feesPaidCents))
        : sum(measured.map((line) => line.measure.feesCents!)),
    feesPartial: measured.some((line) => line.measure.feesPartial),
    paidInCents,
    origin,
    rate,
    xirr: yearly,
    valueCents: seen.length === 0 ? null : sum(seen.map((line) => lineValue(line, period, todayOn)!)),
    valueFrom: days[0] ?? null,
    valueTo: days.at(-1) ?? null,
    // A fund with no value at all has nothing the money could be "after": its row says so instead.
    notInValueCents: sum(seen.map((line) => line.measure.notInValueCents)),
    accruedCents,
    deductible:
      limitCents === null || pensions.length === 0
        ? null
        : {
            usedCents: sum(
              pensions.map((line) => line.measure.origin.youCents + line.measure.origin.employerCents),
            ),
            limitCents,
          },
  };
}

/** The value of the open funds today, whatever the period: its last reading, with its own date. */
export function valueToday(funds: readonly HomeFund[], todayOn: CivilDate): Cents | null {
  const values = funds
    .filter((fund) => !fund.archived)
    .map((fund) => lastUpTo(fund.points, closingDay(todayOn)))
    .filter((point) => point !== null);
  return values.length === 0 ? null : sum(values.map((point) => point.cents));
}

/** The open funds whose last value is too old (§6), oldest first. */
export function staleFunds(
  funds: readonly HomeFund[],
  todayOn: CivilDate,
): { fund: HomeFund; lastOn: CivilDate }[] {
  return funds
    .filter((fund) => !fund.archived && fund.points.length > 0)
    .map((fund) => ({ fund, lastOn: sortedPoints(fund.points).at(-1)!.on }))
    .filter(({ lastOn }) => daysBetween(lastOn, todayOn) > STALE_DAYS)
    .sort((a, b) => (a.lastOn < b.lastOn ? -1 : a.lastOn > b.lastOn ? 1 : 0));
}

export interface YearRow {
  year: number;
  summary: HomeSummary;
}

/** "Year by year" under All (§6), newest first. The rows add up to All, to the cent. */
export function yearRows(
  funds: readonly HomeFund[],
  todayOn: CivilDate,
  firstOn: CivilDate | null,
): YearRow[] {
  if (firstOn === null) return [];
  const rows: YearRow[] = [];
  for (let year = Number(todayOn.slice(0, 4)); year >= Number(firstOn.slice(0, 4)); year -= 1) {
    const period = { ...yearPeriod(year, todayOn), year };
    rows.push({ year, summary: homeSummary({ funds, period, todayOn, firstOn }) });
  }
  return rows;
}

// ——— The chart (§6) ——————————————————————————————————————————————————————————————————————————

/** What one fund did between two readings: never split, never spread over the months it spans. */
export interface Stretch {
  fundId: string;
  from: CivilDate;
  to: CivilDate;
  gainCents: Cents;
}

/**
 * A fund's stretches inside its measure. They telescope: their sum is the gain of the period, to the
 * cent, and nothing is said about the days between two readings.
 */
export function stretchesOf(line: FundLine): Stretch[] {
  const { fund, measure } = line;
  if (measure.status !== "measured") return [];
  const start = measure.start!;
  const end = measure.end!;
  const inside = sortedPoints(fund.points).filter((point) => point.on > start.on && point.on <= end.on);
  const stretches: Stretch[] = [];
  let previous = start;
  for (const point of inside) {
    const flows = sum(flowsIn(fund, previous.on, point.on).map((flow) => flow.chargedCents));
    stretches.push({
      fundId: fund.id,
      from: previous.on,
      to: point.on,
      gainCents: point.cents - previous.cents - flows,
    });
    previous = point;
  }
  return stretches;
}

export type GainGrain = "month" | "year" | "stretch";

export interface GainBar {
  from: CivilDate;
  to: CivilDate;
  /** Per fund; a fund with no reading in the bar is absent, never a zero. */
  byFund: Map<string, Cents>;
  stretches: Stretch[];
  /** `null` when no fund has a reading in this bar: a gap, never a zero. */
  totalCents: Cents | null;
}

export function gainGrain(
  period: FundPeriod & { year?: number | null },
  span: { from: CivilDate; to: CivilDate },
): GainGrain {
  if (period.from === null) return "year";
  // A year goes by month, however little of it has passed (§6).
  if (typeof period.year === "number") return "month";
  const days = daysBetween(span.from, span.to) + 1;
  if (days <= STRETCH_DAYS) return "stretch";
  return days <= 366 ? "month" : "year";
}

/**
 * The bars of the Gain view. A stretch lands in the bar of the day its last reading describes: a value
 * of the 1st belongs to the month before, and a stretch longer than a month stays one bar.
 */
export function gainBars(
  lines: readonly FundLine[],
  span: { from: CivilDate; to: CivilDate },
  grain: GainGrain,
): GainBar[] {
  const stretches = lines
    .flatMap(stretchesOf)
    .sort((a, b) => (a.to < b.to ? -1 : a.to > b.to ? 1 : a.fundId < b.fundId ? -1 : 1));
  const slots: { from: CivilDate; to: CivilDate }[] = [];
  if (grain === "stretch") {
    for (const to of new Set(stretches.map((stretch) => stretch.to))) {
      const own = stretches.filter((stretch) => stretch.to === to);
      slots.push({ from: own.map((one) => one.from).sort()[0], to });
    }
  } else if (grain === "month") {
    for (const month of monthsBetween(monthKey(span.from), monthKey(span.to))) {
      slots.push({ from: month, to: lastDayOfMonth(month) });
    }
  } else {
    for (let year = Number(span.from.slice(0, 4)); year <= Number(span.to.slice(0, 4)); year += 1) {
      slots.push({ from: `${year}-01-01`, to: `${year}-12-31` });
    }
  }
  const slotOf = (stretch: Stretch) => {
    if (grain === "stretch") return slots.findIndex((slot) => slot.to === stretch.to);
    const day = describedDay(stretch.to);
    return slots.findIndex((slot) => day >= slot.from && day <= slot.to);
  };
  const bars: GainBar[] = slots.map((slot) => ({
    ...slot,
    byFund: new Map(),
    stretches: [],
    totalCents: null,
  }));
  for (const stretch of stretches) {
    // Never lost: on the edge of the span, a stretch stays in the nearest bar, so the sum still holds.
    const slot = slotOf(stretch);
    const bar = bars[slot < 0 ? (describedDay(stretch.to) < slots[0].from ? 0 : bars.length - 1) : slot];
    bar.stretches.push(stretch);
    bar.byFund.set(stretch.fundId, (bar.byFund.get(stretch.fundId) ?? 0n) + stretch.gainCents);
    bar.totalCents = (bar.totalCents ?? 0n) + stretch.gainCents;
  }
  return bars;
}

export interface ValuePointRow {
  on: CivilDate;
  valueCents: Cents;
  /** The money each fund's own last reading could see: so the gap is always a documented gain. */
  paidCents: Cents;
}

/**
 * The Value view: one point per reading, no other. On each date a fund counts with its own last reading
 * and with only the money that reading could see: a deposit made after it waits for the next one,
 * so it can never look like a loss. A first value with no money before it is a position, not a gain,
 * so it counts on both sides.
 */
export function valueSeries(lines: readonly FundLine[]): ValuePointRow[] {
  const dates = new Set<CivilDate>();
  for (const { fund, measure } of lines) {
    if (measure.status !== "measured") continue;
    for (const point of fund.points) {
      if (point.on >= measure.start!.on && point.on <= measure.end!.on) dates.add(point.on);
    }
  }
  return [...dates].sort().map((on) => {
    let valueCents = 0n;
    let paidCents = 0n;
    for (const { fund } of lines) {
      const points = sortedPoints(fund.points);
      const reading = lastUpTo(points, on);
      if (reading === null) continue;
      const origin = startOf(null, points, fund.flows)!;
      valueCents += reading.cents;
      paidCents += origin.cents + sum(flowsIn(fund, origin.on, reading.on).map((flow) => flow.chargedCents));
    }
    return { on, valueCents, paidCents };
  });
}
