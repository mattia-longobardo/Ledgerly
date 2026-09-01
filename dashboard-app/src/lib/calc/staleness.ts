import { DISPLAY_STALENESS_MS } from "@/lib/contracts";
import { daysBetween, monthKeyOf, romeDate } from "@/lib/time";

/** The display budgets only: a refresh gate is a job's business, not a badge's. */
export type StalenessSource = keyof typeof DISPLAY_STALENESS_MS;

export interface StalenessInfo {
  source: StalenessSource;
  capturedAt: Date | null;
  ageMs: number | null;
  maxAgeMs: number;
  stale: boolean;
}

export type SnapshotGrace = "due" | "in_grace" | "missed";

function asDate(value: Date | string | number | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Never captured counts as stale. Age exactly equal to the budget is still fresh. */
export function isStale(
  capturedAt: Date | string | null | undefined,
  maxAgeMs: number,
  now: Date = new Date(),
): boolean {
  const d = asDate(capturedAt);
  if (d === null) return true;
  return now.getTime() - d.getTime() > maxAgeMs;
}

export function classify(
  capturedAt: Date | string | null | undefined,
  source: StalenessSource,
  now: Date = new Date(),
): StalenessInfo {
  const d = asDate(capturedAt);
  const maxAgeMs = DISPLAY_STALENESS_MS[source];
  return {
    source,
    capturedAt: d,
    ageMs: d === null ? null : now.getTime() - d.getTime(),
    maxAgeMs,
    stale: isStale(d, maxAgeMs, now),
  };
}

/**
 * The snapshot for month M fires at 23:59 on the 1st of M, so the whole due day
 * still counts as 'due'; the grace window is the days that follow it.
 */
export function snapshotGrace(
  missingMonth: string,
  now: Date = new Date(),
  graceDays = 3,
): SnapshotGrace {
  const elapsed = daysBetween(monthKeyOf(missingMonth), romeDate(now));
  if (elapsed < 1) return "due";
  return elapsed <= graceDays ? "in_grace" : "missed";
}
