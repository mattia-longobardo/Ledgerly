import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { DbClient } from "@/lib/db/client";
import { idempotencyKeys } from "@/lib/db/schema";
import { withUserContext } from "@/platform/db/context";
import { ApiError } from "@/platform/http/errors";

const TTL_MS = 24 * 60 * 60 * 1000;

export function requireFundIdempotencyKey(key: string | undefined): string {
  if (!key) throw new ApiError(428, "validation_failed", "Idempotency-Key header is required");
  return key;
}

/** The Funds mutation, audit event and durable replay share one transaction. */
export async function runFundFinancialWrite<T extends object>(
  deps: { db: DbClient; now(): Date },
  principalId: string,
  request: { key: string | undefined; method: string; path: string; body: string },
  write: (tx: DbClient) => Promise<T>,
): Promise<{ body: T; status: number }> {
  const key = requireFundIdempotencyKey(request.key);
  const requestHash = createHash("sha256").update(`${request.method} ${request.path}\n${request.body}`).digest("hex");
  const lockId = createHash("sha256").update(JSON.stringify(["funds", principalId, key])).digest().readBigInt64BE();

  return withUserContext(deps.db, { userId: principalId }, async (tx) => {
    // Transaction-scoped PostgreSQL serialization also works across processes.
    // Take it before the cache read: a waiter must see the prior commit and
    // recheck its hash, rather than proceeding from a stale cache miss.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${lockId.toString()}::bigint)`);
    const [existing] = await tx.select().from(idempotencyKeys)
      .where(and(eq(idempotencyKeys.principalId, principalId), eq(idempotencyKeys.key, key)))
      .limit(1);
    if (existing && existing.expiresAt > deps.now()) {
      if (existing.requestHash !== requestHash) {
        throw new ApiError(422, "idempotency_key_reused", "Idempotency-Key was already used with a different request");
      }
      if (existing.statusCode !== null) return { body: existing.responseBody as T, status: existing.statusCode };
    }

    // Errors escape the transaction, rolling back both money and replay state.
    // New 4xx/5xx outcomes are not cached; only committed successes consume a key.
    const body = await write(tx);
    const outcome = {
      requestHash,
      statusCode: 201,
      responseBody: body,
      expiresAt: new Date(deps.now().getTime() + TTL_MS),
    };
    await tx.insert(idempotencyKeys).values({ principalId, key, ...outcome })
      .onConflictDoUpdate({ target: [idempotencyKeys.principalId, idempotencyKeys.key], set: outcome });
    return { body, status: 201 };
  });
}
