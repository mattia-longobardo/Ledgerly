// What changed and what share: the figures every screen of accounts shows next to a balance. One
// rule here, so `/api/v1` answers them and a screen never works them out (rewrite plan R3).
import type { Cents } from "../../../shared/money";

export interface Change {
  cents: Cents | null;
  /** The change as a fraction of the earlier value; `null` when there is nothing to compare to. */
  fraction: number | null;
}

/** What changed between two known values. Either one unknown makes the change unknown, not zero. */
export function changeBetween(current: Cents | null, earlier: Cents | null): Change {
  if (current === null || earlier === null) return { cents: null, fraction: null };
  const cents = current - earlier;
  return { cents, fraction: earlier === 0n ? null : Number(cents) / Math.abs(Number(earlier)) };
}

/** An account's share of a total; `null` rather than a misleading 0 % when either is unknown. */
export function shareOf(value: Cents | null, total: Cents | null): number | null {
  if (value === null || total === null || total === 0n) return null;
  return Number(value) / Number(total);
}
