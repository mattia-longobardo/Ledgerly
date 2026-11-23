/**
 * The checks a page of Wallet has to pass before it is believed. `/records` is the one endpoint
 * that can hide data, and the core reads a movement missing from a re-read window as removed, so
 * every way an answer can look complete while it is not fails loudly here instead. No message
 * carries a movement or the token.
 */
import { addDays, type DateWindow, walletRecordDate } from "./days";
import { WalletError } from "./failure";
import type { WalletRecordPayload } from "./payloads";

/** One bound of `appliedRecordDateFilters`: an operator and the instant it is measured against. */
const APPLIED_FILTER = /^(gte|gt|lte|lt)\.(.+)$/;

/**
 * A list with no window to narrow (`/accounts`, `/categories`) that fills the page may be cut
 * short. A dropped account would quietly understate net worth; a dropped category would be created
 * again under the same name: both worse than a failed call.
 */
export function assertWholePage(endpoint: string, count: number, limit: number): void {
  if (count < limit) return;
  throw new WalletError("page_truncated", `Wallet filled the whole page of ${limit} on /${endpoint}`);
}

function unreadableFilter(window: DateWindow, filter: string): WalletError {
  return new WalletError(
    "payload",
    `Wallet answered /records for ${window.from}..${window.to} declaring a date filter that cannot be read ("${filter}")`,
  );
}

/** The bounds the filters declare, as instants: infinite on a side no filter bounds. */
function appliedBounds(window: DateWindow, filters: readonly string[]): { lower: number; upper: number } {
  let lower = Number.NEGATIVE_INFINITY;
  let upper = Number.POSITIVE_INFINITY;
  for (const filter of filters) {
    const bound = APPLIED_FILTER.exec(filter.trim());
    const instant = bound === null ? Number.NaN : Date.parse(bound[2]);
    if (bound === null || Number.isNaN(instant)) throw unreadableFilter(window, filter);
    if (bound[1] === "gte") lower = Math.max(lower, instant);
    if (bound[1] === "gt") lower = Math.max(lower, instant + 1);
    if (bound[1] === "lte") upper = Math.min(upper, instant + 1);
    if (bound[1] === "lt") upper = Math.min(upper, instant);
  }
  return { lower, upper };
}

/**
 * The window Wallet says it applied covers the one asked for. Both bounds have to be declared: an
 * undeclared side is the API's own default window applied invisibly, never an open-ended read.
 * `lte.<day>` comes back as `lt.<day+1>T00:00Z`, so the upper bound compared is midnight after
 * `window.to`. A wider window is harmless here, and `assertWithinWindow` refuses it the moment it
 * carries a movement from outside.
 */
export function assertWindowApplied(window: DateWindow, filters: readonly string[]): void {
  const from = Date.parse(`${window.from}T00:00:00.000Z`);
  const until = Date.parse(`${addDays(window.to, 1)}T00:00:00.000Z`);
  const { lower, upper } = appliedBounds(window, filters);
  if (Number.isFinite(lower) && Number.isFinite(upper) && lower <= from && upper >= until) return;
  const declared = filters.length === 0 ? "no date filter" : filters.join(", ");
  throw new WalletError(
    "payload",
    `Wallet answered /records for ${window.from}..${window.to} having applied ${declared}: it does not cover the window`,
  );
}

/** Every movement of a page falls inside the window: a filter can be declared and not honoured. */
export function assertWithinWindow(window: DateWindow, page: readonly WalletRecordPayload[]): void {
  for (const raw of page) {
    const day = walletRecordDate(raw.recordDate);
    if (day >= window.from && day <= window.to) continue;
    throw new WalletError(
      "payload",
      `Wallet answered /records for ${window.from}..${window.to} with a movement dated ${day}`,
    );
  }
}

/**
 * A page may come back exactly at the limit — that is what splitting is for — but never over it: a
 * provider that ignores `limit` would be narrowed to a single day, and the day blamed.
 */
export function assertLimitHonoured(count: number, limit: number): void {
  if (count <= limit) return;
  throw new WalletError(
    "payload",
    `Wallet answered /records with ${count} records for a limit of ${limit}: it does not honour the limit`,
  );
}

/**
 * A field whose name was never verified, absent from every record of a non-empty page: a wrong
 * name is likelier than an absence across a whole page, and silently reading every movement
 * without a type or a state is worse than a failure. A field explicitly `null` counts as seen.
 */
export function assertFieldSeenSomewhere(
  page: readonly WalletRecordPayload[],
  field: "recordType" | "recordState",
): void {
  if (page.length === 0) return;
  if (page.some((raw) => raw[field] !== undefined)) return;
  throw new WalletError("payload", `Every one of the ${page.length} records is missing "${field}"`);
}
