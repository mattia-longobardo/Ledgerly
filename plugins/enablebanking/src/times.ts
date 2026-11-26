/**
 * The day and the time of a movement as some banks write them in its text. Enable Banking gives
 * dates only (`booking_date`, `value_date`, `transaction_date`): the text is the one place a time
 * is. One entry per wording of a bank; a text no entry reads gives nothing, and the movement keeps
 * its dates. A new bank is one more entry here, with its test.
 */

interface Wording {
  /** The zone the bank writes its times in. */
  timeZone: string;
  /** Groups: day, month, year, hours, minutes. */
  pattern: RegExp;
}

const WORDINGS: readonly Wording[] = [
  // ING Italia, card payments and some transfers: "… del 12/11/2026 alle ore 14:32 …".
  { timeZone: "Europe/Rome", pattern: /\bdel (\d{2})\/(\d{2})\/(\d{4}) alle ore (\d{2})[:.](\d{2})\b/i },
];

const MINUTE_MS = 60_000;
const HALF_DAY_MS = 12 * 60 * MINUTE_MS;

interface TextTime {
  /** The day of the operation, in the bank's zone (`YYYY-MM-DD`). */
  day: string;
  /** The instant of the operation, ISO 8601 in UTC. */
  instant: string;
}

/** The zone's offset from UTC at an instant, in milliseconds. */
function offsetAt(moment: number, timeZone: string): number {
  const name = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
    .formatToParts(moment)
    .find((part) => part.type === "timeZoneName")?.value;
  const found = /([+-])(\d{2}):(\d{2})/.exec(name ?? "");
  if (found === null) return 0;
  return (found[1] === "-" ? -1 : 1) * (Number(found[2]) * 60 + Number(found[3])) * MINUTE_MS;
}

/**
 * The instant of a wall-clock time in a zone. The offsets half a day either side are the two the
 * day can have. A time the clock repeats (autumn) is its first occurrence; a time the clock skips
 * (spring) moves forward by the gap — the same answer as the core's `wallClockIn`.
 */
function instantIn(wallClock: number, timeZone: string): number {
  const before = wallClock - offsetAt(wallClock - HALF_DAY_MS, timeZone);
  const after = wallClock - offsetAt(wallClock + HALF_DAY_MS, timeZone);
  const real = [before, after].filter((candidate) => wallClock - candidate === offsetAt(candidate, timeZone));
  return real.length > 0 ? Math.min(...real) : before;
}

/** The day and the instant a bank wrote in the text, or `null` when no known wording is there. */
export function timeFromText(text: string): TextTime | null {
  for (const { timeZone, pattern } of WORDINGS) {
    const found = pattern.exec(text);
    if (found === null) continue;
    const [, day, month, year, hours, minutes] = found.map(Number);
    const wallClock = Date.UTC(year, month - 1, day, hours, minutes);
    const read = new Date(wallClock);
    // A day or a time that does not exist (31/04, 24:00) is not a time the bank gave.
    const exists =
      read.getUTCFullYear() === year &&
      read.getUTCMonth() === month - 1 &&
      read.getUTCDate() === day &&
      hours < 24 &&
      minutes < 60;
    if (!exists) continue;
    return {
      day: read.toISOString().slice(0, 10),
      instant: new Date(instantIn(wallClock, timeZone)).toISOString(),
    };
  }
  return null;
}
