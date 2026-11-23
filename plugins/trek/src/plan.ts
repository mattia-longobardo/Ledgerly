/**
 * The pure part of a write: from what Trek holds and what the core wants, the fewest toggles.
 *
 * `toggle_vacay_entry` is a toggle, not an idempotent PUT:
 *
 *     no entry on that date                      → INSERT  ("added")
 *     an entry with a different fraction or kind  → UPDATE  ("updated")
 *     an entry with the same fraction and kind    → DELETE  ("removed")
 *
 * So the two no-op cases below are exactly the ones where firing a request does the opposite of
 * what was asked, and they are decided by a tested function rather than by control flow wrapped
 * around a `fetch`.
 */

/** The only two fractions Trek represents. */
export type TrekFraction = 0.5 | 1;
/** The only two kinds Trek knows (spec §9.2). */
type TrekKind = "vacation" | "comp";

export interface TrekEntry {
  id: number;
  /** Whose entry it is, when Trek says; the reads keep only the token owner's. */
  userId: number | null;
  date: string;
  note: string;
  fraction: TrekFraction;
  kind: TrekKind;
}

export interface DesiredDay {
  date: string;
  fraction: TrekFraction;
  kind: TrekKind;
}

type ToggleOp = "insert" | "update" | "delete";
export type ToggleAction = "added" | "updated" | "removed";

export interface TogglePlanStep {
  date: string;
  op: ToggleOp;
  /**
   * Exactly what goes in the tool's arguments. For a delete these are the entry's **current**
   * fraction and kind: toggling with identical values is the only way Trek removes a day, since it
   * exposes no delete tool at all.
   */
  fraction: TrekFraction;
  kind: TrekKind;
  /** What Trek holds for that date right now; `null` when it holds nothing. */
  from: { fraction: TrekFraction; kind: TrekKind } | null;
}

interface TogglePlan {
  steps: TogglePlanStep[];
  /** Days Trek already agrees with. Toggling these would **delete** them. */
  unchanged: string[];
  /** Removals for days Trek no longer holds. Toggling these would **recreate** them. */
  alreadyAbsent: string[];
}

/** What the server must report back if a step's reading of the world was right. */
export function expectedAction(operation: ToggleOp): ToggleAction {
  if (operation === "insert") return "added";
  if (operation === "update") return "updated";
  return "removed";
}

/**
 * Reduces "what we want" to the fewest toggles, given what Trek holds. `removals` is an explicit
 * list and never "whatever is missing from `desired`": a caller owns only part of a year, and
 * inferring deletions from absence would delete every day it simply did not mention.
 */
export function planToggles(
  current: readonly TrekEntry[],
  desired: readonly DesiredDay[],
  removals: readonly string[] = [],
): TogglePlan {
  const byDate = new Map<string, TrekEntry>();
  for (const entry of current) byDate.set(entry.date, entry);
  const plan: TogglePlan = { steps: [], unchanged: [], alreadyAbsent: [] };

  for (const want of desired) {
    const has = byDate.get(want.date);
    if (has === undefined) plan.steps.push({ ...want, op: "insert", from: null });
    else if (has.fraction === want.fraction && has.kind === want.kind) plan.unchanged.push(want.date);
    else plan.steps.push({ ...want, op: "update", from: { fraction: has.fraction, kind: has.kind } });
  }

  for (const date of removals) {
    const has = byDate.get(date);
    if (has === undefined) {
      plan.alreadyAbsent.push(date);
      continue;
    }
    // Identical values on purpose: that is what makes Trek remove the row.
    const pair = { fraction: has.fraction, kind: has.kind };
    plan.steps.push({ date, op: "delete", ...pair, from: pair });
  }
  return plan;
}
