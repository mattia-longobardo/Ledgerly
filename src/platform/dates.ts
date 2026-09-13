/** A calendar date with no time and no timezone: "YYYY-MM-DD". */
export type CivilDate = string;
/** The first day of a month: "YYYY-MM-01". */
export type MonthKey = string;

const CIVIL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}

export function isCivilDate(value: string): boolean {
  const match = CIVIL_DATE.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

function parts(date: CivilDate): [number, number, number] {
  if (!isCivilDate(date)) throw new RangeError(`Not a civil date: "${date}"`);
  const [year, month, day] = date.split("-").map(Number);
  return [year, month, day];
}

function fromUtcMillis(millis: number): CivilDate {
  const d = new Date(millis);
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** The civil date of an instant as seen in `timeZone` (an IANA name). */
export function civilDateIn(instant: Date, timeZone: string): CivilDate {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const byType = Object.fromEntries(formatter.formatToParts(instant).map((p) => [p.type, p.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

/** "Today" for a user. The only sanctioned way to obtain the current civil date. */
export function today(timeZone: string, now: Date = new Date()): CivilDate {
  return civilDateIn(now, timeZone);
}

export function monthKey(date: CivilDate): MonthKey {
  const [year, month] = parts(date);
  return `${pad(year, 4)}-${pad(month)}-01`;
}

export function addDays(date: CivilDate, days: number): CivilDate {
  const [year, month, day] = parts(date);
  return fromUtcMillis(Date.UTC(year, month - 1, day + days));
}

export function addMonths(month: MonthKey, months: number): MonthKey {
  const [year, m] = parts(month);
  return fromUtcMillis(Date.UTC(year, m - 1 + months, 1));
}

export function lastDayOfMonth(month: MonthKey): CivilDate {
  return addDays(addMonths(monthKey(month), 1), -1);
}

/** Every month from `from` to `to`, both included; empty when `from` is after `to`. */
export function monthsBetween(from: MonthKey, to: MonthKey): MonthKey[] {
  const result: MonthKey[] = [];
  for (let cursor = monthKey(from); cursor <= monthKey(to); cursor = addMonths(cursor, 1)) {
    result.push(cursor);
  }
  return result;
}

/** 0 = Sunday … 6 = Saturday. */
export function dayOfWeek(date: CivilDate): number {
  const [year, month, day] = parts(date);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}
