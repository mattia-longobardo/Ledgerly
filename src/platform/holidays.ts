import { addDays, type CivilDate, dayOfWeek } from "./dates";

export type HolidayKey =
  | "newYear"
  | "epiphany"
  | "easter"
  | "easterMonday"
  | "liberation"
  | "labour"
  | "republic"
  | "assumption"
  | "allSaints"
  | "immaculate"
  | "christmas"
  | "stStephen"
  | "patronSaint";

export interface Holiday {
  date: CivilDate;
  key: HolidayKey;
}

/** The local patron-saint holiday, from the user's preferences (e.g. Milan: 7 December). */
export interface PatronSaint {
  month: number;
  day: number;
}

const FIXED: ReadonlyArray<[number, number, HolidayKey]> = [
  [1, 1, "newYear"],
  [1, 6, "epiphany"],
  [4, 25, "liberation"],
  [5, 1, "labour"],
  [6, 2, "republic"],
  [8, 15, "assumption"],
  [11, 1, "allSaints"],
  [12, 8, "immaculate"],
  [12, 25, "christmas"],
  [12, 26, "stStephen"],
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

export function italianHolidays(year: number, patron?: PatronSaint | null): Holiday[] {
  const easter = easterSunday(year);
  const holidays: Holiday[] = [
    ...FIXED.map(([month, day, key]) => ({ date: isoDate(year, month, day), key })),
    { date: easter, key: "easter" },
    { date: addDays(easter, 1), key: "easterMonday" },
  ];
  if (patron) {
    const date = isoDate(year, patron.month, patron.day);
    if (!holidays.some((h) => h.date === date)) holidays.push({ date, key: "patronSaint" });
  }
  return holidays.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
}

export function isWeekend(date: CivilDate): boolean {
  const weekday = dayOfWeek(date);
  return weekday === 0 || weekday === 6;
}

export function isHoliday(date: CivilDate, patron?: PatronSaint | null): boolean {
  return italianHolidays(Number(date.slice(0, 4)), patron).some((h) => h.date === date);
}

/** A leave day can be booked only on a working day. */
export function isBookable(date: CivilDate, patron?: PatronSaint | null): boolean {
  return !isWeekend(date) && !isHoliday(date, patron);
}
