/**
 * The date windows a pass of a source reads (the engine's decision). The rest of the mapping is the
 * plugin's own since rewrite plan R5c: accounts, categories and movements reach the engine in the
 * words of contract 2.
 *
 * Everything here is a pure function: no HTTP, no database, no clock.
 */

import {
  addDays,
  addMonths,
  type CivilDate,
  isCivilDate,
  lastDayOfMonth,
  type MonthKey,
  monthKey,
} from "@ledgerly/domain/shared/dates";
import { FIRST_LINK_MONTHS } from "./depth";

/** A closed civil-date window, both ends included: the unit `/records` is read by. */
export interface DateWindow {
  from: CivilDate;
  to: CivilDate;
}

/** The first link fetches twelve months (spec §9.1); the constant lives in `depth.ts` since F2.5. */
export { FIRST_LINK_MONTHS };
/** The hourly pass re-reads the last seven days (spec §9.1); the schedule itself is the job's. */
const REREAD_DAYS = 7;
/** A whole calendar month as a window. */
export function monthWindow(month: MonthKey): DateWindow {
  return { from: monthKey(month), to: lastDayOfMonth(month) };
}

/**
 * The monthly windows of a first link: `months` whole months ending with the month `today` falls
 * in, oldest first (spec §9.1: twelve of them). The last window runs to the end of the current
 * month rather than to today, so a movement the source dates a few days ahead is not missed.
 */
export function firstLinkWindows(today: CivilDate, months: number = FIRST_LINK_MONTHS): DateWindow[] {
  if (!Number.isInteger(months) || months < 1) throw new RangeError(`Not a month count: ${months}`);
  const current = monthKey(today);
  return Array.from({ length: months }, (_none, index) =>
    monthWindow(addMonths(current, index - (months - 1))),
  );
}

/** The re-read window: exactly `days` civil days ending today (spec §9.1: the last seven). */
export function recentWindow(today: CivilDate, days: number = REREAD_DAYS): DateWindow {
  if (!Number.isInteger(days) || days < 1) throw new RangeError(`Not a day count: ${days}`);
  if (!isCivilDate(today)) throw new RangeError(`Not a civil date: "${today}"`);
  return { from: addDays(today, -(days - 1)), to: today };
}
