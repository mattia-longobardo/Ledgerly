import { sql } from "drizzle-orm";
import type { MiddlewareHandler } from "hono";
import type { DbClient } from "@/lib/db/client";
import type { Principal } from "@/platform/auth/principal";
import { withUserContext } from "@/platform/db/context";
import { ApiError } from "./errors";

export interface WindowConsumption {
  /** Hits recorded in this window, including this one. */
  count: number;
  limit: number;
  remaining: number;
  /** `count` has gone past `limit` — the caller answers 429. */
  exceeded: boolean;
}

/**
 * Counts one hit against the fixed one-minute window `now` falls in, and says
 * whether that put the caller over `limit`.
 *
 * `key` is a uuid because `rate_limit_windows.principal_id` is: for an
 * authenticated request it is the user id, and for an inbound webhook — which
 * has no principal at all — it is the receiving `integration_connections.id`
 * (Ruling P9-1). The two id spaces are uuidv7 and never collide, so one table
 * serves both without a discriminator column.
 *
 * `db` must ALREADY carry a context: `rate_limit_windows` has FORCE ROW LEVEL
 * SECURITY since migration 0009, and its policy admits the row only when
 * `principal_id = app_current_user_id()` or `app_is_system()`. On the bare pool
 * the WITH CHECK clause rejects every insert. The two callers differ on which
 * context that is — `rateLimit` below opens a user context for the principal,
 * `handleWebhook` is already inside a system context — which is exactly why
 * this function opens neither.
 */
export async function consumeWindow(
  db: DbClient,
  key: string,
  limit: number,
  now: Date,
): Promise<WindowConsumption> {
  const start = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
  const res = await db.execute<{ count: number }>(sql`
    INSERT INTO rate_limit_windows (principal_id, window_start, count)
    VALUES (${key}, ${start}, 1)
    ON CONFLICT (principal_id, window_start) DO UPDATE SET count = rate_limit_windows.count + 1
    RETURNING count`);
  const count = Number(res.rows[0]?.count ?? 0);
  return { count, limit, remaining: Math.max(0, limit - count), exceeded: count > limit };
}

/**
 * Generic over the caller's env, constrained to what this middleware actually
 * reads (`principal`), rather than fixed to `{ Variables: { principal:
 * Principal } }` with the call site casting the result to fit. A cast at the
 * call site (`as unknown as MiddlewareHandler<ApiEnv>`) would silence a type
 * error today and silently swallow a real one tomorrow, if this middleware
 * ever grows to read a second `Variables` key the caller's env does not
 * carry; a generic constraint keeps that check live. The default type
 * parameter keeps every existing call site — which passes no explicit env —
 * working exactly as before.
 */
export function rateLimit<E extends { Variables: { principal: Principal } } = { Variables: { principal: Principal } }>(
  deps: {
    db: DbClient;
    now(): Date;
    limit?: number;
  },
): MiddlewareHandler<E> {
  const limit = deps.limit ?? 300;
  return async (c, next) => {
    const principalId = c.get("principal").userId;
    const window = await withUserContext(deps.db, { userId: principalId }, (tx) =>
      consumeWindow(tx, principalId, limit, deps.now()),
    );
    c.header("RateLimit-Limit", String(window.limit));
    c.header("RateLimit-Remaining", String(window.remaining));
    if (window.exceeded) throw new ApiError(429, "rate_limited", "Too many requests; try again in a minute");
    await next();
  };
}
