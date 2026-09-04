/**
 * Shared between `create-interest-rule.ts` and `update-interest-rule.ts` —
 * previously duplicated verbatim in both.
 */

/**
 * At most 6 decimals, matching `interest_rules.annual_rate`/`tax_rate`'s
 * `numeric(10, 6)` columns; no leading "-" — a negative rate is never valid
 * (see `dailyInterest`'s own doc comment for why).
 */
export const RATE_RE = /^\d+(\.\d{1,6})?$/;
export const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * The regex alone accepts calendar-impossible strings like "2026-13-45";
 * this rejects those by round-tripping through `Date.UTC` and checking the
 * components survived unchanged (an overflowing month/day silently rolls
 * into the next month/year instead of throwing, so a value mismatch is the
 * only signal).
 */
export function isValidDateOnly(value: string): boolean {
  const match = DATE_RE.exec(value);
  if (!match) return false;
  const [, y, m, d] = match as unknown as [string, string, string, string];
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
