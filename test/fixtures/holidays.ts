// The Italian public holidays computed, for the tests only (R5g, decision ST-20): the app no longer
// computes any country's holidays; a person keeps the calendars they subscribe to.
import { addDays, type CivilDate } from "@domain/shared/dates";

const FIXED: ReadonlyArray<[number, number]> = [
  [1, 1],
  [1, 6],
  [4, 25],
  [5, 1],
  [6, 2],
  [8, 15],
  [11, 1],
  [12, 8],
  [12, 25],
  [12, 26],
];

function isoDate(year: number, month: number, day: number): CivilDate {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Easter Sunday in the Gregorian calendar (anonymous Gregorian algorithm). */
export function easterSunday(year: number): CivilDate {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return isoDate(year, month, day);
}

/** The holidays of an Italian year, with a patron saint's day when given. */
export function italianHolidays(
  year: number,
  patron?: { month: number; day: number } | null,
): { date: CivilDate }[] {
  const easter = easterSunday(year);
  const dates = new Set([
    ...FIXED.map(([month, day]) => isoDate(year, month, day)),
    easter,
    addDays(easter, 1),
    ...(patron ? [isoDate(year, patron.month, patron.day)] : []),
  ]);
  return [...dates].sort().map((date) => ({ date }));
}
