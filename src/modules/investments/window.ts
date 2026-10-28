/**
 * The window of the Investments charts (PERS-100): a preset (`range`, the last year by default) or
 * the months the picker wrote (`from`/`to`), read by month or by day — the controls of Overview's
 * "Net worth over time" (spec §7.1, F2.5). Pure: the days to value, oldest first.
 */
import {
  addDays,
  addMonths,
  type CivilDate,
  lastDayOfMonth,
  type MonthKey,
  monthKey,
  monthsBetween,
} from "@/platform/dates";

export type ChartRange = "3m" | "1y" | "all";
export type ChartGrain = "month" | "day";

export interface ChartWindow {
  grain: ChartGrain;
  /** A preset, or `null` with `custom` when the picker wrote the months. */
  range: ChartRange | null;
  custom: { from: MonthKey; to: MonthKey } | null;
}

/** A day chart stops at the last 366 days of its window: one point per day is enough to carry. */
export const DAY_POINTS = 366;

const PRESET_MONTHS: Record<Exclude<ChartRange, "all">, number> = { "3m": 3, "1y": 12 };

/**
 * The months of the window and the days the chart values: each month's last day — today for the
 * month still running — or every day at day grain. Months before `firstOn` (the first period of
 * the services shown) are dropped, so "All" and a range reaching past the history start where the
 * history does instead of drawing an empty stretch.
 */
export function chartDays(
  window: ChartWindow,
  todayOn: CivilDate,
  firstOn: CivilDate | null,
): { months: MonthKey[]; days: CivilDate[] } {
  const thisMonth = monthKey(todayOn);
  const firstMonth = firstOn === null ? thisMonth : monthKey(firstOn);
  let months: MonthKey[];
  if (window.custom) months = monthsBetween(window.custom.from, window.custom.to);
  else if (window.range === "all")
    months = monthsBetween(firstMonth < thisMonth ? firstMonth : thisMonth, thisMonth);
  else months = monthsBetween(addMonths(thisMonth, -(PRESET_MONTHS[window.range ?? "1y"] - 1)), thisMonth);
  const kept = months.filter((month) => month >= firstMonth);
  if (kept.length > 0) months = kept;
  else months = months.slice(-1);

  if (window.grain === "month") {
    return {
      months,
      days: months.map((month) => (month === thisMonth ? todayOn : lastDayOfMonth(month))),
    };
  }
  const lastDay = lastDayOfMonth(months[months.length - 1]);
  const end = lastDay < todayOn ? lastDay : todayOn;
  const candidates = [months[0], addDays(end, -(DAY_POINTS - 1)), ...(firstOn === null ? [] : [firstOn])];
  const start = candidates.reduce((latest, day) => (day > latest ? day : latest));
  const days: CivilDate[] = [];
  for (let day = start; day <= end; day = addDays(day, 1)) days.push(day);
  return { months, days: days.length > 0 ? days : [end] };
}
