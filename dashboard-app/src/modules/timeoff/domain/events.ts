import { toHours } from "./units";

/**
 * The part of an event the domain reasons about. `TimeoffEvent` in the ports
 * extends it with the identifiers and the sync state the repositories carry.
 */
export interface EventLike {
  id: string;
  date: string;
  fraction: string;
  typeCode: string;
  status: string;
  origin: string;
  pendingOp: string;
  note: string | null;
}

/**
 * "Taken" is derived, never stored (Phase 7 scope cut: no approval workflow).
 * A cancelled event stays cancelled whatever the calendar says; everything
 * strictly before today has happened, and today itself is still planned.
 */
export function statusAt(event: EventLike, today: string): "planned" | "taken" | "cancelled" {
  if (event.status === "cancelled") return "cancelled";
  return event.date < today ? "taken" : "planned";
}

/**
 * Planned hours per calendar month for one type, keyed `"YYYY-MM"`.
 * Cancelled events are excluded — they are a record of an intention that was
 * dropped, not of time off.
 */
export function plannedByMonth(
  events: readonly EventLike[],
  typeCode: string,
  hoursPerDay: string,
): Map<string, string> {
  const byMonth = new Map<string, string>();
  for (const event of events) {
    if (event.typeCode !== typeCode) continue;
    if (event.status === "cancelled") continue;
    const month = event.date.slice(0, 7);
    const hours = toHours(event.fraction, hoursPerDay);
    const running = byMonth.get(month);
    byMonth.set(month, running === undefined ? hours : addHours(running, hours));
  }
  return byMonth;
}

function addHours(a: string, b: string): string {
  // Both sides are already two-decimal strings produced by `toHours`, so this
  // is the same hundredths arithmetic without a second parse helper.
  const cents = (value: string) => BigInt(value.replace(".", ""));
  const total = (cents(a) + cents(b)).toString().padStart(3, "0");
  return `${total.slice(0, -2)}.${total.slice(-2)}`;
}

/** Days still ahead (today included), ascending, cancelled ones dropped. */
export function upcoming<T extends EventLike>(
  events: readonly T[],
  today: string,
  limit?: number,
): T[] {
  const ahead = events
    .filter((event) => event.date >= today && event.status !== "cancelled")
    .sort((a, b) => a.date.localeCompare(b.date));
  return limit === undefined ? ahead : ahead.slice(0, limit);
}
