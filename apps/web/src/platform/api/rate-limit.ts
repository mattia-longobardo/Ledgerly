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
/** A token's allowance: a client API, MCP, a script. */
export const MAX_PER_WINDOW = 120;
/**
 * The web's own session, per person (decision H57): a client screen reads 5-8 routes, so a person who
 * opens pages in a row, or the E2E suite, passes 120; 1200 still stops a page that fetches in a loop.
 */
export const SESSION_MAX_PER_WINDOW = 1200;

export function takeSlot(key: string, now: Date = new Date(), max = MAX_PER_WINDOW): Promise<RateVerdict> {
  return takeSharedSlot(`api:${key}`, { max, windowMs: WINDOW_MS }, now);
}

/** For the tests: every window goes, so a test does not inherit another's. */
export async function resetRateLimits(): Promise<void> {
  await deleteExpiredLimits(new Date("9999-12-31T00:00:00Z"));
}
