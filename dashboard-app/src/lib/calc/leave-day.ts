/**
 * The leave-day vocabulary, with no dependencies.
 *
 * These three declarations describe Trek's domain but need no Trek client, and
 * that separation is load-bearing: `@/lib/clients/trek` reaches for `node:crypto`
 * and for the file-mounted credential in `@/lib/env`, so a client component that
 * imports a *value* from it drags `node:fs` into the browser bundle and the
 * build fails. Types alone are erased and would be harmless; `isWeekendBlocked`
 * is not. Everything usable from both sides of the server/client boundary lives
 * here, and the client re-exports it so server code has one import to reach for.
 */

/**
 * Trek's only two fractions. Any other value is coerced to 1 server-side, so
 * this union is the whole domain — not a simplification of it.
 *
 * NOTE FOR ANY FUTURE AM/PM FEATURE: Trek has nowhere to put it. Storing "which
 * half" locally would mean storing something that can never round-trip, so this
 * app deliberately does not model it either.
 */
export type LeaveFraction = 1 | 0.5;

/** `comp` is recuperi/flex time; Trek's stats count it separately from vacation. */
export type LeaveKind = "vacation" | "comp";

/**
 * Mirrors the plan's `block_weekends` rule so the UI can refuse a Saturday or a
 * Sunday before a pointless round trip.
 *
 * Trek computes this in UTC straight from the date string (`weekend_days='0,6'`
 * = Sunday and Saturday), so this parses the string the same way. Using a local
 * `Date` would shift the boundary in Europe/Rome and disagree with the server
 * on exactly the dates that matter.
 */
export function isWeekendBlocked(isoDate: string): boolean {
  const day = new Date(`${isoDate}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

/**
 * True only for a real calendar day written `YYYY-MM-DD`.
 *
 * The regex alone is not enough, and the gap is not theoretical: `2026-02-31`
 * matches it, `new Date("2026-02-31T00:00:00Z")` rolls over to 3 March (so
 * `isWeekendBlocked` answers about the WRONG day, or `NaN`), and Postgres then
 * refuses the cast — a client input mistake surfacing as `500 internal`. Same
 * implementation as `isRealDate` in the budgets and funds API schemas; it
 * lives here because the timeoff API, the page and the use case all need it
 * and this file is the one they can all reach.
 */
export function isRealDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return date.getUTCFullYear() === Number(match[1])
    && date.getUTCMonth() + 1 === Number(match[2])
    && date.getUTCDate() === Number(match[3]);
}
