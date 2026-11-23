/** Civil dates ("YYYY-MM-DD", no time, no zone) and the windows `/records` is read by. */
import { WalletError } from "./failure";

const CIVIL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;
/**
 * The widest window this plugin reads or splits: above the year a first link asks for, and the
 * bound of the splitter's recursion.
 */
const MAX_WINDOW_DAYS = 400;

/** A closed window of civil dates, both ends included. */
export interface DateWindow {
  from: string;
  to: string;
}

export function isCivilDate(value: string): boolean {
  const match = CIVIL_DATE.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

/**
 * The day of a `recordDate`, from the first ten characters of Wallet's own text: never derived from
 * a `Date`, where a timestamp near midnight would shift it by a day.
 */
export function walletRecordDate(recordDate: string): string {
  const day = recordDate.trim().slice(0, 10);
  if (!isCivilDate(day)) throw new WalletError("payload", "Wallet answered a record date that is not a day");
  return day;
}

/** Civil-date arithmetic in UTC, where a day is always 24 hours. */
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** The span of a window in days (0 for one day), or `null` for a window this plugin does not read. */
export function windowDays(window: DateWindow): number | null {
  if (!isCivilDate(window.from) || !isCivilDate(window.to)) return null;
  const days = (Date.parse(window.to) - Date.parse(window.from)) / DAY_MS;
  return days < 0 || days > MAX_WINDOW_DAYS ? null : days;
}

/**
 * The two disjoint halves of a window, or `null` for a single day, which cannot be split: what a
 * full page of records does instead of failing.
 */
export function splitWindow(window: DateWindow): [DateWindow, DateWindow] | null {
  const days = windowDays(window) ?? 0;
  if (days === 0) return null;
  const middle = addDays(window.from, Math.floor(days / 2));
  return [
    { from: window.from, to: middle },
    { from: addDays(middle, 1), to: window.to },
  ];
}
