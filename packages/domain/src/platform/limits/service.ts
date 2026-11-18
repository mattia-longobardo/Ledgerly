import { lt, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { rateLimitCounters } from "./schema";

export interface RateVerdict {
  allowed: boolean;
  remaining: number;
  /** Seconds until the window resets, for `Retry-After`. */
  retryAfter: number;
}

/**
 * Takes one slot of `key`'s window: `max` slots every `windowMs`, the window starting at the first
 * slot. One statement, so two processes counting at once cannot both take the last slot.
 */
export async function takeSlot(
  key: string,
  limit: { max: number; windowMs: number },
  now: Date = new Date(),
): Promise<RateVerdict> {
  const resetAt = new Date(now.getTime() + limit.windowMs);
  const expired = sql`${rateLimitCounters.resetAt} <= ${now.toISOString()}::timestamptz`;
  const [row] = await getDb()
    .insert(rateLimitCounters)
    .values({ key, count: 1, resetAt })
    .onConflictDoUpdate({
      target: rateLimitCounters.key,
      set: {
        count: sql`case when ${expired} then 1 else ${rateLimitCounters.count} + 1 end`,
        resetAt: sql`case when ${expired} then excluded.reset_at else ${rateLimitCounters.resetAt} end`,
      },
    })
    .returning({ count: rateLimitCounters.count, resetAt: rateLimitCounters.resetAt });
  const retryAfter = Math.max(0, Math.ceil((row.resetAt.getTime() - now.getTime()) / 1000));
  if (row.count > limit.max) return { allowed: false, remaining: 0, retryAfter };
  return { allowed: true, remaining: limit.max - row.count, retryAfter: row.count === 1 ? 0 : retryAfter };
}

/** The windows that have run out: `housekeeping` deletes them. */
export async function deleteExpiredLimits(now: Date = new Date()): Promise<number> {
  const rows = await getDb()
    .delete(rateLimitCounters)
    .where(lt(rateLimitCounters.resetAt, now))
    .returning({ key: rateLimitCounters.key });
  return rows.length;
}
