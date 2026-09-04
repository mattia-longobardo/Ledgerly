import { sql } from "drizzle-orm";
import type { MiddlewareHandler } from "hono";
import type { DbClient } from "@/lib/db/client";
import type { Principal } from "@/platform/auth/principal";
import { withUserContext } from "@/platform/db/context";
import { ApiError } from "./errors";

export function rateLimit(deps: {
  db: DbClient;
  now(): Date;
  limit?: number;
}): MiddlewareHandler<{ Variables: { principal: Principal } }> {
  const limit = deps.limit ?? 300;
  return async (c, next) => {
    const start = new Date(Math.floor(deps.now().getTime() / 60_000) * 60_000);
    const principalId = c.get("principal").userId;
    // `rate_limit_windows` carries FORCE ROW LEVEL SECURITY since migration
    // 0009, so the upsert has to run where `app.user_id` is set — on the bare
    // pool the WITH CHECK clause rejects every insert.
    const count = await withUserContext(deps.db, { userId: principalId }, async (tx) => {
      const res = await tx.execute<{ count: number }>(sql`
        INSERT INTO rate_limit_windows (principal_id, window_start, count)
        VALUES (${principalId}, ${start}, 1)
        ON CONFLICT (principal_id, window_start) DO UPDATE SET count = rate_limit_windows.count + 1
        RETURNING count`);
      return Number(res.rows[0]?.count ?? 0);
    });
    c.header("RateLimit-Limit", String(limit));
    c.header("RateLimit-Remaining", String(Math.max(0, limit - count)));
    if (count > limit) throw new ApiError(429, "rate_limited", "Too many requests; try again in a minute");
    await next();
  };
}
