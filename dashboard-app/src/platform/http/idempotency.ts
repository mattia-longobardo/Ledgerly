import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { MiddlewareHandler } from "hono";
import type { DbClient } from "@/lib/db/client";
import { idempotencyKeys } from "@/lib/db/schema";
import type { Principal } from "@/platform/auth/principal";
import { ApiError } from "./errors";

const TTL_MS = 24 * 60 * 60 * 1000;

export function idempotency(deps: {
  db: DbClient;
  now(): Date;
}): MiddlewareHandler<{ Variables: { principal: Principal } }> {
  return async (c, next) => {
    const key = c.req.header("idempotency-key");
    if (!key) throw new ApiError(428, "validation_failed", "Idempotency-Key header is required");
    const principalId = c.get("principal").userId;
    const raw = await c.req.raw.clone().text();
    const requestHash = createHash("sha256").update(`${c.req.method} ${c.req.path}\n${raw}`).digest("hex");

    const [existing] = await deps.db
      .select()
      .from(idempotencyKeys)
      .where(and(eq(idempotencyKeys.principalId, principalId), eq(idempotencyKeys.key, key)))
      .limit(1);
    if (existing && existing.expiresAt > deps.now()) {
      if (existing.requestHash !== requestHash) {
        throw new ApiError(422, "idempotency_key_reused", "Idempotency-Key was already used with a different request");
      }
      if (existing.statusCode !== null) return c.json(existing.responseBody as object, existing.statusCode as 200);
    }

    await next();

    const res = c.res.clone();
    const body = await res.json().catch(() => null);
    await deps.db
      .insert(idempotencyKeys)
      .values({
        principalId,
        key,
        requestHash,
        statusCode: res.status,
        responseBody: body,
        expiresAt: new Date(deps.now().getTime() + TTL_MS),
      })
      .onConflictDoUpdate({
        target: [idempotencyKeys.principalId, idempotencyKeys.key],
        set: { statusCode: res.status, responseBody: body },
      });
  };
}
