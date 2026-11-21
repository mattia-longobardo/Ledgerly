// src/modules/investments/period.ts — the period of the section in the address (docs/design/
// investments-ux.md §1.2, §2, U2): the old chart parameters sent to the new ones, a period written
// back as parameters, the years the stepper walks, and the intervals of the chart (§2.2). Pure: no
// database, no clock. Reading the address is `periodOf` in `pnl.ts`, which U1 wrote.
import {
  addDays,
  addMonths,
  type CivilDate,
  dayOfWeek,
  daysBetween,
  isCivilDate,
  lastDayOfMonth,
  monthKey,
} from "../../shared/dates";
import {
  type DateRange,
  presetRange,
  RANGE_PRESETS,
  type RangePreset,
  shiftRange,
} from "../../platform/ranges";
import type { PnlPeriod } from "./pnl";
import { first, type PeriodQuery, type Query, yearQuery } from "../../shared/period";

export { legacyPeriodQuery, periodSpan, yearQuery } from "../../shared/period";
export type { Query } from "../../shared/period";

/** The names of those parameters: the only ones a tab carries to the next. */
export const PERIOD_KEYS = ["preset", "from", "to", "off"] as const;

/**
 * The presets of Funds and Investments: the four of Expenses, and "All" — the whole history, which
 * a P&L needs and a month of spending does not.
 */
export const SECTION_PRESETS = [...RANGE_PRESETS, "all"] as const;
type SectionPreset = (typeof SECTION_PRESETS)[number];

/** These sections open on the year running: a fund has too few values for a month to say much. */
const DEFAULT_SECTION_PRESET: SectionPreset = "ytd";

interface SectionPeriod {
  /** `null` when the address carries an explicit `from`/`to`, which wins over the presets. */
  preset: SectionPreset | null;
  /** How many periods back the stepper moved. Always 0 under "All". */
  offset: number;
  /** The days the control shows; `null` under "All", which has no window to step. */
  range: DateRange | null;
  /** The period as it stands, for every link that keeps it. */
  params: PeriodQuery;
  /** The same without the stepper's offset: what the stepper's own links start from. */
  stepperParams: PeriodQuery;
  /** What the engines measure: a calendar year when the range is one, else its days up to today. */
  period: PnlPeriod;
}

/** A whole calendar year, or the year running up to a day not before today. */
function yearOfRange(range: DateRange, todayOn: CivilDate): number | null {
  const year = range.from.slice(0, 4);
  if (range.from !== `${year}-01-01` || range.to.slice(0, 4) !== year) return null;
  const whole = range.to === `${year}-12-31`;
  const running = year === todayOn.slice(0, 4) && range.to >= todayOn;
  return whole || running ? Number(year) : null;
}

/**
 * The period of Funds and Investments, read from the address the way Expenses, Overview and Accounts
 * read theirs: a preset (`preset`), or the days the picker wrote (`from`/`to`), moved back by `off`
 * periods of its own length. A window that starts after today falls back to the default.
 */
export function sectionPeriod(query: Query, todayOn: CivilDate): SectionPeriod {
  const text = (name: string) => first(query[name])?.trim() ?? "";
  const from = text("from");
  const to = text("to");
  const custom = isCivilDate(from) && isCivilDate(to) && from <= to && from <= todayOn;
  const wanted = text("preset");
  const preset = custom ? null : (SECTION_PRESETS.find((key) => key === wanted) ?? DEFAULT_SECTION_PRESET);
  const stepperParams: PeriodQuery = {
    preset: preset === null || preset === DEFAULT_SECTION_PRESET ? undefined : preset,
    from: custom ? from : undefined,
    to: custom ? to : undefined,
  };
  if (preset === "all") {
    return {
      preset,
      offset: 0,
      range: null,
      params: stepperParams,
      stepperParams,
      period: { kind: "all", year: null, from: null, to: todayOn },
    };
  }
  const offset = Math.max(0, Math.trunc(Number(text("off"))) || 0);
  const base = custom
    ? { from: from as CivilDate, to: to as CivilDate }
    : presetRange(preset as RangePreset, todayOn);
  // "Year to date" steps by calendar year: the one before it is the whole year before, which is the
  // P&L a person asks for, and not a window of as many months as this year has had so far.
  const back = Number(todayOn.slice(0, 4)) - offset;
  const range =
    preset === "ytd" && offset > 0
      ? { from: `${back}-01-01`, to: `${back}-12-31` }
      : shiftRange(base, -offset);
  const year = yearOfRange(range, todayOn);
  const end = range.to < todayOn ? range.to : todayOn;
  return {
    preset,
    offset,
    range,
    params: { ...stepperParams, off: offset > 0 ? String(offset) : undefined },
    stepperParams,
    period:
      year === null
        ? { kind: "custom", year: null, from: range.from, to: end }
        : { kind: "year", year, from: range.from, to: end },
  };
}

/** A period as the parameters that ask for it; the year running is the default and needs none. */
export function periodQuery(period: PnlPeriod, todayOn: CivilDate): PeriodQuery {
  if (period.kind === "all") return { preset: "all" };
  if (period.kind === "custom") return { from: period.from!, to: period.to };
  return yearQuery(period.year!, todayOn);
}

/** The years the stepper walks (§2.1): from the first with data to the one running. */
export function yearsOf(firstOn: CivilDate | null, todayOn: CivilDate): { first: number; last: number } {
  const last = Number(todayOn.slice(0, 4));
  const firstYear = firstOn === null ? last : Number(firstOn.slice(0, 4));
  return { first: Math.min(firstYear, last), last };
}

export type BarGrain = "week" | "month" | "year";

export interface Interval {
  from: CivilDate;
  to: CivilDate;
}

/** A quarter: up to 92 days the chart goes by week (P&L) and by day (value) (§2.2). */
const SHORT_DAYS = 92;
/** Up to a leap year it goes by month; past it, the P&L bars go by year. */
const YEAR_DAYS = 366;

/**
 * The bars of the P&L chart (§2.2): by week up to 92 days (Monday to Sunday, the ends cut to the
 * span), by calendar month up to a year, by calendar year past it. Contiguous, oldest first, the
 * first starting on `from` and the last ending on `to`.
 */
export function barIntervals(from: CivilDate, to: CivilDate): { grain: BarGrain; intervals: Interval[] } {
  const days = daysBetween(from, to) + 1;
  const grain: BarGrain = days <= SHORT_DAYS ? "week" : days <= YEAR_DAYS ? "month" : "year";
  const endOf = (day: CivilDate): CivilDate => {
    if (grain === "week") return addDays(day, (7 - dayOfWeek(day)) % 7);
    if (grain === "month") return lastDayOfMonth(monthKey(day));
    return `${day.slice(0, 4)}-12-31`;
  };
  const intervals: Interval[] = [];
  for (let start = from; start <= to;) {
    const end = endOf(start);
    intervals.push({ from: start, to: end < to ? end : to });
    start = addDays(end, 1);
  }
  return { grain, intervals };
}

/**
 * The points of the value chart (§2.2): every day up to 92 days, else each month's last day (the
 * last point is `to`, today for the month running).
 */
export function valueDays(from: CivilDate, to: CivilDate): { grain: "day" | "month"; days: CivilDate[] } {
  const days: CivilDate[] = [];
  if (daysBetween(from, to) + 1 <= SHORT_DAYS) {
    for (let day = from; day <= to; day = addDays(day, 1)) days.push(day);
    return { grain: "day", days };
  }
  for (let month = monthKey(from); month <= to; month = addMonths(month, 1)) {
    const end = lastDayOfMonth(month);
    days.push(end < to ? end : to);
  }
  return { grain: "month", days };
}
