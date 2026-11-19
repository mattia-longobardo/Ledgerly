// The zod primitives of the wire (rewrite plan R0, audit TR-2, MCP-4): what REST, MCP and the
// forms of the web app accept. The contract imports zod and nothing else (10-modularity.md §10.2),
// so the check of a civil date is its own here; the domain has its own for its input schemas.
import { z } from "zod";

const CIVIL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `YYYY-MM-DD` and a day of the calendar: no 31 April, no 29 February out of a leap year. */
function isCalendarDate(value: string): boolean {
  const match = CIVIL_DATE.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

/** A civil date on the wire; the message is the caller's when it has one. */
export const civilDate = (message?: string) => z.string().refine(isCalendarDate, message);

/** An id on the wire: a UUID, as every table keys its rows. */
export const id = () => z.uuid();

/** A moment on the wire: ISO 8601 in UTC (`Date.toISOString()`). */
export const instant = () => z.iso.datetime();

/**
 * An amount on the wire: a decimal **string** ("1234.56"), never a JSON number, which is a double
 * and would change a large amount without a word (spec §4.3).
 */
export const money = () => z.string().regex(/^-?\d+\.\d{2}$/);

/**
 * An amount a caller sends: a plain decimal string ("1234.5", "-12", "+0.005"), rounded half up at
 * the cent by the server, exactly as `POST /accounts/{id}/balances` has accepted since F8. Never a
 * JSON number; no thousands separator, exponent or currency symbol.
 */
export const amountInput = () => z.string().regex(/^\s*[+-]?\d+(\.\d+)?\s*$/);

/** A month on the wire: its first day, `YYYY-MM-01`. */
export const monthStart = () => z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-01$/);

/** A colour the person chose: `#rrggbb`. */
export const hexColor = () => z.string().regex(/^#[0-9a-fA-F]{6}$/);
