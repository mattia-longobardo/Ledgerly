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

/** A zone's offset from UTC at an instant, in milliseconds; positive east of Greenwich. */
function offsetAt(millis: number, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const at = Object.fromEntries(
    formatter.formatToParts(new Date(millis)).map((part) => [part.type, part.value]),
  );
  // `hour12: false` renders midnight as "24" in this locale, which `Date.UTC` would carry into the
  // next day: the modulo keeps it on the day the other parts name.
  const local = Date.UTC(
    Number(at.year),
    Number(at.month) - 1,
    Number(at.day),
    Number(at.hour) % 24,
    Number(at.minute),
    Number(at.second),
  );
  return local - millis;
}

/**
 * The instant a civil date begins in `timeZone`: local midnight, as a UTC instant. The counterpart
 * of {@link civilDateIn}, and the sanctioned way to turn a bare day into an instant — a provider
 * that sends a date with no time still has to be stored in a `timestamptz` column, and `§4.3`
 * forbids getting there through `toISOString()`.
 *
 * The offset is itself a function of the instant, so it is measured twice: once at the UTC guess,
 * then again at the corrected one, which is what makes a day whose offset changed overnight come
 * out right. A midnight a zone skips entirely has no instant of its own; the value returned is the
 * one the clock jumped to.
 */
export function startOfDayIn(on: CivilDate, timeZone: string): Date {
  const [year, month, day] = parts(on);
  const midnight = Date.UTC(year, month - 1, day);
  const once = midnight - offsetAt(midnight, timeZone);
  const twice = midnight - offsetAt(once, timeZone);
  // The earliest candidate that really falls on `on`. Both land on it on an ordinary day; they
  // disagree when the offset changed overnight, and when a zone skips its own midnight (Santiago
  // springs forward at 00:00) only the first one does — the second lands on the day before, which
  // is a whole day of error. Neither matching cannot happen, and taking the later of the two is
  // the safe answer if it ever did.
  for (const candidate of [Math.min(once, twice), Math.max(once, twice)]) {
    if (civilDateIn(new Date(candidate), timeZone) === on) return new Date(candidate);
  }
  return new Date(Math.max(once, twice));
}

/** A zone's offset from UTC at an instant, as "UTC+2", "UTC−3:30" or "UTC" (the timezone picker). */
export function utcOffsetLabel(timeZone: string, instant: Date): string {
  const name = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "shortOffset" })
    .formatToParts(instant)
    .find((part) => part.type === "timeZoneName")?.value;
  const offset = (name ?? "GMT").replace("GMT", "");
  return offset === "" || offset === "+0" ? "UTC" : `UTC${offset.replace("-", "−")}`;
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

/** Whole days from one civil date to another, the first excluded and the last included. */
export function daysBetween(from: CivilDate, to: CivilDate): number {
  const [fy, fm, fd] = parts(from);
  const [ty, tm, td] = parts(to);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
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

/** Whole months from `from` to `to`; negative when `to` comes first. */
export function monthsApart(from: MonthKey, to: MonthKey): number {
  const [fromYear, fromMonth] = parts(monthKey(from));
  const [toYear, toMonth] = parts(monthKey(to));
  return (toYear - fromYear) * 12 + (toMonth - fromMonth);
}
