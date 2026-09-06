export const TZ = "Europe/Rome";

const PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Civil date in Europe/Rome as `YYYY-MM-DD`, whatever the server clock is. */
export function romeDate(d: Date = new Date()): string {
  return PARTS.format(d);
}

/** Month key pinned to the 1st, derived in Europe/Rome. */
export function monthKey(d: Date = new Date()): string {
  return `${romeDate(d).slice(0, 7)}-01`;
}

export function monthKeyOf(isoDate: string): string {
  return `${isoDate.slice(0, 7)}-01`;
}

export function addMonths(key: string, delta: number): string {
  const [y, m] = key.split("-").map(Number) as [number, number];
  const total = y * 12 + (m - 1) + delta;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`;
}

export function monthsBetween(from: string, to: string): number {
  const [fy, fm] = from.split("-").map(Number) as [number, number];
  const [ty, tm] = to.split("-").map(Number) as [number, number];
  return (ty - fy) * 12 + (tm - fm);
}

/** Inclusive ascending list of month keys. */
export function monthRange(from: string, to: string): string[] {
  const n = monthsBetween(from, to);
  if (n < 0) return [];
  return Array.from({ length: n + 1 }, (_, i) => addMonths(from, i));
}

/**
 * The instant a month key is stamped at when a historical figure is written
 * into `balance_snapshots`.
 *
 * UTC midnight of the 1st, deliberately: Europe/Rome is UTC+1/+2, so this lands
 * at 01:00 or 02:00 Rome on the same civil day and `date_trunc('month', … AT
 * TIME ZONE 'Europe/Rome')` puts it in the intended month either way — without
 * any DST arithmetic. It is also the earliest instant in the month, so a
 * backfilled row can never outrank a live capture taken later in that same
 * month; that is what keeps the Wallet-sourced current values authoritative.
 */
export function monthStartInstant(key: string): Date {
  return new Date(`${monthKeyOf(key)}T00:00:00Z`);
}

/**
 * Same rationale as `monthStartInstant`, but for an arbitrary `"YYYY-MM-DD"`
 * date rather than one pinned to a month start: UTC midnight of that date
 * lands at 01:00 or 02:00 Rome on the same civil day, so it is always a safe
 * lower bound for "on or after this Rome civil date" and — one day later —
 * a safe exclusive upper bound for "before this Rome civil date".
 */
export function dayStartInstant(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00Z`);
}

export function daysBetween(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

export function yearOf(key: string): number {
  return Number(key.slice(0, 4));
}
