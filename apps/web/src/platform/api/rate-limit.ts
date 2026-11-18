/**
 * A fixed window per token, shared by every process through `rate_limit_counters` (rewrite plan
 * R1): the web, and from R4 the API, count the same window.
 *
 * A guard against a script in a loop, not a security boundary — the boundary is the token itself
 * and `userScoped(ctx)` underneath it.
 */
import {
  deleteExpiredLimits,
  type RateVerdict,
  takeSlot as takeSharedSlot,
} from "@ledgerly/domain/platform/limits";

export const WINDOW_MS = 60_000;
export const MAX_PER_WINDOW = 120;

export function takeSlot(key: string, now: Date = new Date()): Promise<RateVerdict> {
  return takeSharedSlot(`api:${key}`, { max: MAX_PER_WINDOW, windowMs: WINDOW_MS }, now);
}

/** For the tests: every window goes, so a test does not inherit another's. */
export async function resetRateLimits(): Promise<void> {
  await deleteExpiredLimits(new Date("9999-12-31T00:00:00Z"));
}
