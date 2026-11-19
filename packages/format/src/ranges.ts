/**
 * The ranges of days the period controls speak of (spec §7.2, §8.4): the presets, their windows and
 * the step of the stepper. One set of rules for Expenses, Overview, Accounts, Funds and Investments,
 * so every screen speaks of time in one way. Pure: "today" is passed in.
 */

import { addDays, addMonths, type CivilDate, lastDayOfMonth, monthKey } from "./dates";
import { formatDate, type UiLocale } from "./format";

/** The four presets of the design, in the order the segmented control shows them. */
export const RANGE_PRESETS = ["thisMonth", "lastMonth", "last3Months", "ytd"] as const;

export type RangePreset = (typeof RANGE_PRESETS)[number];

export interface DateRange {
  from: CivilDate;
  to: CivilDate;
}

/** Up to this many days a range is drawn day by day unless the address says otherwise. */
export const DAY_GRAIN_MAX_DAYS = 62;

const DAY_MS = 86_400_000;

function utcMillis(date: CivilDate): number {
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

/** How many days a range covers, both ends included. */
export function daysInRange(range: DateRange): number {
  return Math.round((utcMillis(range.to) - utcMillis(range.from)) / DAY_MS) + 1;
}

/** Whole months from `from` to `to`, both included. */
function monthSpan(range: DateRange): number {
  const from = monthKey(range.from);
  const to = monthKey(range.to);
  const [fromYear, fromMonth] = from.split("-").map(Number);
  const [toYear, toMonth] = to.split("-").map(Number);
  return (toYear - fromYear) * 12 + (toMonth - fromMonth) + 1;
}

/**
 * Whether the range is made of whole calendar months: it starts on a first and ends on a last day.
 * The period stepper then walks in months rather than in days, which is what makes "previous" on
 * a 31-day August land on a 30-day September and not three days into it (the prototype's own
 * `shiftRange` makes the same distinction).
 */
export function isWholeMonths(range: DateRange): boolean {
  return range.from.endsWith("-01") && range.to === lastDayOfMonth(monthKey(range.to));
}

/** The range is one single calendar month, which the label shows as a month name. */
function isSingleMonth(range: DateRange): boolean {
  return isWholeMonths(range) && monthKey(range.from) === monthKey(range.to);
}

/**
 * The window of a preset, computed from the user's own today (spec §8.4 point 6).
 *
 * All four are whole-month windows, "Year to date" included: a range that ends mid-month would
 * make the stepper walk in days, and stepping back from a nine-month window by 273 days is not
 * something anybody means. The current month is shown whole, exactly as "This month" is.
 */
export function presetRange(preset: RangePreset, today: CivilDate): DateRange {
  const month = monthKey(today);
  switch (preset) {
    case "thisMonth":
      return { from: month, to: lastDayOfMonth(month) };
    case "lastMonth": {
      const previous = addMonths(month, -1);
      return { from: previous, to: lastDayOfMonth(previous) };
    }
    case "last3Months":
      return { from: addMonths(month, -2), to: lastDayOfMonth(month) };
    case "ytd":
      return { from: `${today.slice(0, 4)}-01-01`, to: lastDayOfMonth(month) };
  }
}

/** The same window moved by `periods` of its own length; negative goes back in time. */
export function shiftRange(range: DateRange, periods: number): DateRange {
  if (periods === 0) return range;
  if (isWholeMonths(range)) {
    const step = periods * monthSpan(range);
    const to = addMonths(monthKey(range.to), step);
    return { from: addMonths(monthKey(range.from), step), to: lastDayOfMonth(to) };
  }
  const step = periods * daysInRange(range);
  return { from: addDays(range.from, step), to: addDays(range.to, step) };
}

/**
 * The label of the date range control: one month is named, anything else is spelled out end to
 * end. The prototype makes the same distinction, and it is what keeps "September 2026" from
 * turning into "1 Sep 2026 – 30 Sep 2026" on the common case.
 */
export function rangeLabel(range: DateRange, locale: UiLocale): string {
  if (isSingleMonth(range)) return formatDate(range.from, "monthYear", locale);
  return `${formatDate(range.from, "long", locale)} – ${formatDate(range.to, "long", locale)}`;
}
