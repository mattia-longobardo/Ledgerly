// The period of Funds and Investments (docs/design/investments-ux.md §1.2, §2.2): its type, the year
// up to today, the parameters a link carries, a year as those parameters, the old parameters sent to
// the new ones, the days a period really spans, and the intervals of its charts. Pure and shared:
// Funds and Investments read their period and draw their charts the same way (audit FND-7, FND-8).
import {
  addDays,
  addMonths,
  type CivilDate,
  dayOfWeek,
  daysBetween,
  isCivilDate,
  lastDayOfMonth,
  monthKey,
} from "./dates";

/** A period of the pages (§1.2): a calendar year, "All", or days picked. */
export interface Period {
  kind: "year" | "all" | "custom";
  /** The calendar year of a `year` period. */
  year: number | null;
  /** The first day; `null` for "All": each service or fund from its own first day. */
  from: CivilDate | null;
  /** The last day: today for the period still running, never past it. */
  to: CivilDate;
}

/** The days of a period, both ends included. `from` is `null` for "All". */
export type PeriodDays = Pick<Period, "from" | "to">;

/** A calendar year, up to today while it runs: the one "year to date" of the pages. */
export function yearPeriod(year: number, todayOn: CivilDate): PeriodDays {
  const end = `${year}-12-31`;
  return { from: `${year}-01-01`, to: end < todayOn ? end : todayOn };
}

/** "All": from the first day with data to today. */
export function allPeriod(todayOn: CivilDate): PeriodDays {
  return { from: null, to: todayOn };
}

/**
 * What the address cannot mean (§6): a year still to come goes back to the year running. A year older
 * than the first data stays, because the page has something to say about it.
 */
export function isFutureYear(period: string | undefined, todayOn: CivilDate): boolean {
  return period !== undefined && /^\d{4}$/.test(period) && Number(period) > Number(todayOn.slice(0, 4));
}

export type Query = Record<string, string | string[] | undefined>;

/** The parameters of the period (§1.2): what a link carries from one page or tab to the next. */
export type PeriodQuery = { preset?: string; from?: string; to?: string; off?: string };

/** A calendar year as the parameters that ask for it; the year running is the default and needs none. */
export function yearQuery(year: number, todayOn: CivilDate): PeriodQuery {
  const back = Number(todayOn.slice(0, 4)) - year;
  return back > 0 ? { off: String(back) } : {};
}

/** The first value of a parameter given once or many times. */
export const first = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

const MONTH = /^\d{4}-\d{2}$/;

/**
 * The address of the charts before U2 (`range=3m|1y|all`, `from`/`to` by month, `grain`) sent to
 * the nearest new one (§1.2), so a saved link still opens: `1y` → the year running, `all` → `all`,
 * `3m` → the three months to today by day, months → their first and last day. `grain` goes, the
 * granularity is automatic (§2.2). Every other parameter stays. `null` when nothing is old.
 */
export function legacyPeriodQuery(query: Query, todayOn: CivilDate): Record<string, string> | null {
  const range = first(query.range);
  const grain = first(query.grain);
  const from = first(query.from);
  const to = first(query.to);
  const months = from !== undefined && to !== undefined && MONTH.test(from) && MONTH.test(to);
  const period = first(query.period);
  if (range === undefined && grain === undefined && !months && period === undefined) return null;

  const kept: Record<string, string> = {};
  for (const [name, value] of Object.entries(query)) {
    const one = first(value);
    if (one === undefined || ["range", "grain", "from", "to", "period"].includes(name)) continue;
    kept[name] = one;
  }
  if (months) {
    const [start, end] = from! <= to! ? [from!, to!] : [to!, from!];
    return { ...kept, from: `${start}-01`, to: lastDayOfMonth(`${end}-01`) };
  }
  // A day range the picker wrote stays: only `range` or `grain` came along with it.
  if (from !== undefined && to !== undefined && isCivilDate(from) && isCivilDate(to)) {
    return { ...kept, from, to };
  }
  if (range === "all") return { ...kept, preset: "all" };
  if (range === "3m") return { ...kept, from: addMonths(monthKey(todayOn), -2), to: todayOn };
  // The period before the presets: `period=all`, or a year.
  if (period === "all") return { ...kept, preset: "all" };
  if (period !== undefined && /^\d{4}$/.test(period)) {
    const year = Number(period);
    if (year >= 1970) return { ...kept, ...yearQuery(year, todayOn) };
  }
  return kept;
}

/**
 * The days the period really spans: "All" starts on the first day with data (today when there is
 * none), a year never before it either, so the chart does not draw an empty stretch.
 */
export function periodSpan(
  period: { kind: string; from: CivilDate | null; to: CivilDate },
  firstOn: CivilDate | null,
): { from: CivilDate; to: CivilDate } {
  const start = period.from ?? firstOn ?? period.to;
  const from = period.kind === "custom" || firstOn === null || start >= firstOn ? start : firstOn;
  return { from: from > period.to ? period.to : from, to: period.to };
}

// ——— The intervals of the charts (§2.2, audit FND-8) ——————————————————————————————————————————————

/** A quarter: up to 92 days a chart goes by its short grain (a week, a stretch) and its values by day. */
const SHORT_DAYS = 92;
/** Up to a leap year it goes by month; past it, by year. */
const YEAR_DAYS = 366;

/**
 * The grain of the bars over `days` (§2.2): the page's own short one up to a quarter — a week for
 * Investments, a stretch between two values for Funds — by month up to a year, by year past it.
 */
export function chartGrain<Short extends string>(days: number, short: Short): Short | "month" | "year" {
  return days <= SHORT_DAYS ? short : days <= YEAR_DAYS ? "month" : "year";
}

export type BarGrain = "week" | "month" | "year";

export interface Interval {
  from: CivilDate;
  to: CivilDate;
}

/**
 * The bars of a chart by calendar week (Monday to Sunday), month or year ({@link chartGrain} with
 * weeks): contiguous, oldest first, the ends cut to the span, the first starting on `from` and the
 * last ending on `to`.
 */
export function barIntervals(from: CivilDate, to: CivilDate): { grain: BarGrain; intervals: Interval[] } {
  const grain = chartGrain(daysBetween(from, to) + 1, "week");
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
 * The points of a value chart (§2.2): every day up to a quarter, else each month's last day (the
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
