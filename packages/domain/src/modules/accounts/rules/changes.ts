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

/** Each value of a series from the one before it; the first has none before it in the window. */
export function stepsOf(values: readonly (Cents | null)[]): Change[] {
  return values.map((value, index) => changeBetween(value, index === 0 ? null : (values[index - 1] ?? null)));
}

/** A chart's window: its last value from its first known one. */
export function windowChangeOf(values: readonly (Cents | null)[]): Change {
  return changeBetween(values.at(-1) ?? null, values.find((value) => value !== null) ?? null);
}

/** An account's share of a total; `null` rather than a misleading 0 % when either is unknown. */
export function shareOf(value: Cents | null, total: Cents | null): number | null {
  if (value === null || total === null || total === 0n) return null;
  return Number(value) / Number(total);
}
