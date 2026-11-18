import { type CivilDate, type MonthKey, addMonths, monthKey, monthsApart } from "../../platform/dates";
import {
  type LeaveDayKind,
  type LeaveDayView,
  type ResidualBasis,
  type ResidualView,
  minuteWeight,
} from "./rules";

/*
 * What accrues, and what will be left on a day still to come (release N5.1,
 * `docs/design/timeoff-accrual.md`).
 *
 * The page is also where leave is planned, so "how much is left today" is half the answer: the
 * other half is what the months between now and the absence will add. Everything here is pure —
 * the query hands over what the payslips printed and the days booked, the screen asks for a date.
 * A forecast below zero is an ordinary answer and never an error.
 */

/** The kinds that have a balance to forecast. */
export type AccrualKind = Extract<LeaveDayKind, "vacation" | "rol">;

/** What one payslip printed as MAT. for one kind: the year's running total, in hours. */
export interface AccruedReading {
  /** The payslip's own month. */
  period: MonthKey;
  accruedHours: number | null;
}

/** How much a month adds, and where the figure came from — the screen always says which. */
export interface AccrualRate {
  minutesPerMonth: number;
  /** `payslip`: read from the payslips' MAT.; `allowance`: the stated allowance over twelve. */
  source: "payslip" | "allowance";
}

/** How many month-to-month differences the rate is the mean of: a year of them. */
const RATE_MONTHS = 12;

/**
 * What one month grants (decision D1).
 *
 * MAT. is the year's running total: it grows every month and starts again in January. So the
 * month's own accrual is the difference from the payslip before it, and for January it is MAT.
 * itself. The rate is the mean of the last twelve such differences — the employer rounds, so two
 * neighbouring months can differ by a few minutes and the mean is what a year really grants. A
 * month with no payslip before it gives no difference and is left out; a difference below zero is
 * a correction, not an accrual, and is left out too.
 *
 * With no difference to read, the rate is the stated allowance over twelve months, and it says so.
 * With neither there is no rate at all: `null`, never a guess.
 */
export function monthlyRate(
  readings: readonly AccruedReading[],
  allowanceMinutes: number | null,
): AccrualRate | null {
  // The last payslip of a month wins: a rectification restates MAT. as it restates everything.
  const byMonth = new Map<MonthKey, number>();
  for (const one of readings) {
    if (one.accruedHours !== null) byMonth.set(monthKey(one.period), one.accruedHours);
  }

  const differences: number[] = [];
  for (const month of [...byMonth.keys()].sort()) {
    const accrued = byMonth.get(month) as number;
    const before = month.slice(5, 7) === "01" ? 0 : byMonth.get(addMonths(month, -1));
    if (before !== undefined && accrued >= before) differences.push(accrued - before);
  }

  const recent = differences.slice(-RATE_MONTHS);
  const meanHours = recent.reduce((sum, one) => sum + one, 0) / Math.max(recent.length, 1);
  if (meanHours > 0) return { minutesPerMonth: meanHours * 60, source: "payslip" };
  if (allowanceMinutes !== null && allowanceMinutes > 0) {
    return { minutesPerMonth: allowanceMinutes / 12, source: "allowance" };
  }
  return null;
}

/** The balance a forecast starts from. */
export interface ForecastOpening {
  /** `payslip`: the RES. of the last applied payslip. `year`: an empty first of January. */
  source: "payslip" | "year";
  minutes: number;
  /** The last month whose accrual is already inside `minutes`: the months after it add theirs. */
  accruedThrough: MonthKey;
  /** The first day that is not inside `minutes` yet: the days from here on are subtracted. */
  spentFrom: CivilDate;
}

/**
 * Where a forecast starts (decisions D1, D4).
 *
 * The RES. of the last applied payslip, whatever year it is of: the balance at the end of that
 * payslip's month, with the days of the month before it counted. Nothing is reset at the turn of
 * the year — the whole balance goes on, as A.P. does on the January payslip.
 *
 * With no payslip at all the start is the first of January of the year shown, with nothing in it:
 * the year then fills at the rate of the stated allowance.
 */
export function forecastOpening(
  snapshot: { period: MonthKey; remainingHours: number } | null,
  year: number,
): ForecastOpening {
  if (snapshot !== null) {
    const period = monthKey(snapshot.period);
    return {
      source: "payslip",
      minutes: Math.round(snapshot.remainingHours * 60),
      accruedThrough: period,
      spentFrom: period,
    };
  }
  const january = `${String(year).padStart(4, "0")}-01-01`;
  return { source: "year", minutes: 0, accruedThrough: addMonths(january, -1), spentFrom: january };
}

/** Everything a forecast of one kind is worked out from. The panel gets it as it is. */
export interface ForecastInput {
  rate: AccrualRate | null;
  opening: ForecastOpening;
  /** Every day of this kind from `opening.spentFrom` to the end of the year shown. */
  days: readonly LeaveDayView[];
  minutesPerDay: number;
}

/** The months after `after` that have ended before `date`: the ones whose accrual counts (D3). */
function monthsEarned(after: MonthKey, date: CivilDate): number {
  return Math.max(0, monthsApart(after, monthKey(date)) - 1);
}

/**
 * The balance on a day still to come: the opening balance, plus what the months in between grant,
 * minus the days booked in between.
 *
 * A month's accrual counts once the month has ended (decision D3): an absence on 15 August is
 * measured against what had accrued by the end of July. `accruedBefore` is the day the accrual is
 * read on — the first day of an absence — and `spentThrough` the last day whose bookings are
 * subtracted — its last day.
 *
 * `null` when there is no rate, and for a day before the opening: the balance of a day a payslip
 * has already counted is the payslip's business, not a forecast.
 */
export function forecastAt(
  input: ForecastInput,
  at: { accruedBefore: CivilDate; spentThrough: CivilDate },
): number | null {
  const { rate, opening, days, minutesPerDay } = input;
  if (rate === null || at.accruedBefore < opening.spentFrom) return null;

  const spent = days
    .filter((day) => day.on >= opening.spentFrom && day.on <= at.spentThrough)
    .reduce((sum, day) => sum + minuteWeight(day, minutesPerDay), 0);
  const earned = rate.minutesPerMonth * monthsEarned(opening.accruedThrough, at.accruedBefore);
  return Math.round(opening.minutes + earned - spent);
}

/** The forecast for the last day of a year, December's accrual included: what the year hands on. */
export function forecastAtYearEnd(input: ForecastInput, year: number): number | null {
  return forecastAt(input, {
    accruedBefore: `${String(year + 1).padStart(4, "0")}-01-01`,
    spentThrough: `${String(year).padStart(4, "0")}-12-31`,
  });
}

/** What a card says about the accrual of its kind. */
export interface AccrualView {
  rate: AccrualRate | null;
  /** The forecast for 31 December of the year shown; `null` when there is none to give. */
  yearEndMinutes: number | null;
  /** For a forecast that starts from a payslip: that payslip's month. */
  payslipPeriod: MonthKey | null;
  /**
   * `true` when the year shown has no payslip of its own and the forecast comes from an earlier
   * one (decision D6): the card then leads with the forecast, and says that it is one.
   */
  leads: boolean;
}

export function accrualView(input: ForecastInput, year: number, basis: ResidualBasis): AccrualView {
  const yearEndMinutes = forecastAtYearEnd(input, year);
  const fromPayslip = input.opening.source === "payslip";
  return {
    rate: input.rate,
    yearEndMinutes,
    payslipPeriod: fromPayslip && yearEndMinutes !== null ? input.opening.accruedThrough : null,
    leads: fromPayslip && yearEndMinutes !== null && basis !== "payslip",
  };
}

/** What a range of the panel does to the forecast of one kind, on the day the absence starts. */
export interface ForecastChange {
  beforeMinutes: number;
  afterMinutes: number;
}

/**
 * The forecast before and after a range is written (U2).
 *
 * `shown` is the year on the screen for this kind, as it is and as the panel's preview leaves it;
 * the days of the years before it are not the panel's to change and stay as they are. `null` when
 * the day has no forecast, and for a range that starts in another year — its days are not shown.
 */
export function forecastChange(
  input: ForecastInput | undefined,
  range: { from: CivilDate; to: CivilDate },
  year: number,
  shown: { before: readonly LeaveDayView[]; after: readonly LeaveDayView[] },
): ForecastChange | null {
  if (input === undefined || Number(range.from.slice(0, 4)) !== year) return null;
  const earlier = input.days.filter((day) => Number(day.on.slice(0, 4)) !== year);
  const at = { accruedBefore: range.from, spentThrough: range.to };
  const beforeMinutes = forecastAt({ ...input, days: [...earlier, ...shown.before] }, at);
  const afterMinutes = forecastAt({ ...input, days: [...earlier, ...shown.after] }, at);
  return beforeMinutes === null || afterMinutes === null ? null : { beforeMinutes, afterMinutes };
}

/* Going over what is left, and what will have accrued by then */

/** A kind whose booked days come to more than there was to spend. */
export interface Overdrawn {
  kind: AccrualKind;
  /** How far past zero, in minutes: always positive. */
  byMinutes: number;
  /** Which number it went past — the payslip's residual, or the stated allowance. */
  basis: ResidualBasis;
  /** For `payslip`: the month whose payslip printed the figure it went past. */
  snapshotPeriod: MonthKey | null;
  /**
   * The planned day the booking first outran what had accrued by it, when the accrual was worked
   * out. `null` when there was no rate to work it out with, and the plain year-end figure is all
   * the warning has to go on.
   */
  onDate: CivilDate | null;
}

export interface OverdrawnInput {
  /** The residual the card shows, which decides whether there is anything to warn about. */
  view: ResidualView;
  /** The same forecast the card and the panel use: one rate on the whole page (decision D5). */
  forecast: ForecastInput;
  /** The payslip's carry-over, in minutes — part of what is available before a month accrues. */
  carriedMinutes: number;
  year: number;
  /** The planned days of this kind in the year shown; the ones the residual subtracted. */
  planned: readonly LeaveDayView[];
}

/** The worst shortfall of a run of days, each measured against what had accrued by its own date. */
function worstShortfall(
  days: readonly LeaveDayView[],
  start: { minutes: number; accruedThrough: MonthKey },
  rate: AccrualRate,
  minutesPerDay: number,
): { byMinutes: number; onDate: CivilDate } | null {
  const inOrder = [...days].sort((a, b) => (a.on < b.on ? -1 : a.on > b.on ? 1 : 0));
  let consumed = 0;
  let worst: { byMinutes: number; onDate: CivilDate } | null = null;
  for (const day of inOrder) {
    consumed += minuteWeight(day, minutesPerDay);
    const earned = rate.minutesPerMonth * monthsEarned(start.accruedThrough, day.on);
    const short = consumed - (start.minutes + earned);
    // A minute either way is the rate's own arithmetic, not somebody booking a day they lack.
    if (short > 1 && (worst === null || short > worst.byMinutes)) {
      worst = { byMinutes: Math.round(short), onDate: day.on };
    }
  }
  return worst;
}

/**
 * Whether a kind has been booked past what was left — and past what will have accrued by the day
 * it is booked on.
 *
 * The plain check decides **whether** to warn: a residual that is still positive is not a problem,
 * and a residual nobody can compute (`unknown`) cannot be exceeded. When it does go negative the
 * plain figure asks the wrong question of a day in the future: a fortnight booked in August is not
 * spent against February's balance but against February's balance **plus** the months in between.
 * So the planned days are walked in date order, each against what has accrued by its own date, and
 * the warning reports the worst shortfall and the day it happened on.
 *
 * The accrual is the page's one rate (decision D5): a month's worth, counted once the month has
 * ended. Where there is no rate — no payslip to read it from and no stated allowance — the
 * year-end figure stands.
 *
 * Where the walk starts differs by basis, because the two figures mean different things:
 *
 *  - a payslip's RES. is already-accrued balance, so it opens the window as it stands and only the
 *    months **after** the one it was printed for add to it;
 *  - a stated allowance is the whole year at once, so it cannot open the window — it *is* the
 *    thing being spread. What opens it is the carry-over, less whatever a payslip has counted.
 *
 * A year with no payslip of its own, read from an earlier one (decision D6), is measured as the
 * card shows it: against the forecast, from that payslip on.
 */
export function overdrawn(kind: AccrualKind, input: OverdrawnInput): Overdrawn | null {
  const { view, forecast, carriedMinutes, year, planned } = input;
  const { rate, opening, minutesPerDay } = forecast;

  if (accrualView(forecast, year, view.basis).leads) {
    const yearEnd = forecastAtYearEnd(forecast, year) as number;
    if (yearEnd >= 0) return null;
    const yearLast = `${String(year).padStart(4, "0")}-12-31`;
    const worst = worstShortfall(
      forecast.days.filter((day) => day.on >= opening.spentFrom && day.on <= yearLast),
      opening,
      rate as AccrualRate,
      minutesPerDay,
    );
    return worst && { kind, basis: "payslip", snapshotPeriod: opening.accruedThrough, ...worst };
  }

  if (view.remainingMinutes === null || view.remainingMinutes >= 0) return null;
  const flat: Overdrawn = {
    kind,
    byMinutes: -view.remainingMinutes,
    basis: view.basis,
    snapshotPeriod: view.snapshotPeriod,
    onDate: null,
  };
  if (rate === null) return flat;

  const january = `${String(year).padStart(4, "0")}-01-01`;
  const start =
    view.basis === "payslip"
      ? {
          minutes: view.remainingMinutes + view.plannedMinutes,
          accruedThrough: monthKey(view.snapshotPeriod as MonthKey),
        }
      : { minutes: carriedMinutes - view.takenMinutes, accruedThrough: addMonths(january, -1) };
  const worst = worstShortfall(planned, start, rate, minutesPerDay);
  return worst && { ...flat, ...worst };
}
