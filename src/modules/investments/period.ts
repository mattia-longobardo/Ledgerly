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
} from "@/platform/dates";
import type { PnlPeriod } from "./pnl";

export type Query = Record<string, string | string[] | undefined>;

/** The parameters of the period (§1.2): what a link carries from one page or tab to the next. */
export type PeriodQuery = { period?: string; from?: string; to?: string };

const first = (value: string | string[] | undefined): string | undefined =>
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
  if (range === undefined && grain === undefined && !months) return null;

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
  if (range === "all") return { ...kept, period: "all" };
  if (range === "3m") return { ...kept, from: addMonths(monthKey(todayOn), -2), to: todayOn };
  const period = first(query.period);
  return period === undefined ? kept : { ...kept, period };
}

/** A period as the parameters that ask for it; the year running is the default and needs none. */
export function periodQuery(period: PnlPeriod, todayOn: CivilDate): PeriodQuery {
  if (period.kind === "all") return { period: "all" };
  if (period.kind === "custom") return { from: period.from!, to: period.to };
  return period.year === Number(todayOn.slice(0, 4)) ? {} : { period: String(period.year) };
}

/**
 * The days the period really spans: "All" starts on the first day with data (today when there is
 * none), a year never before it either, so the chart does not draw an empty stretch.
 */
export function periodSpan(period: PnlPeriod, firstOn: CivilDate | null): { from: CivilDate; to: CivilDate } {
  const start = period.from ?? firstOn ?? period.to;
  const from = period.kind === "custom" || firstOn === null || start >= firstOn ? start : firstOn;
  return { from: from > period.to ? period.to : from, to: period.to };
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
export const SHORT_DAYS = 92;
/** Up to a leap year it goes by month; past it, the P&L bars go by year. */
export const YEAR_DAYS = 366;

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
