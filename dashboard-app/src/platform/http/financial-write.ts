import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { DbClient } from "@/lib/db/client";
import { idempotencyKeys } from "@/lib/db/schema";
import { withUserContext } from "@/platform/db/context";
import { ApiError } from "./errors";

const TTL_MS = 24 * 60 * 60 * 1000;

export function requireIdempotencyKey(key: string | undefined): string {
  if (!key) throw new ApiError(428, "validation_failed", "Idempotency-Key header is required");
  return key;
}

/**
 * A POST that creates a financial record must not create two rows for one
 * `Idempotency-Key`. The plain `idempotency()` middleware (`./idempotency.ts`)
 * cannot guarantee that: it reads the replay cache, runs the handler, and
 * writes the cache back in three separate transactions, so two concurrent
 * requests with the same key (or a client retry racing a crash between the
 * handler's commit and the cache write) can both pass the "not yet cached"
 * check and both insert. `onConflictDoUpdate` on the cache row then hides
 * the duplicate instead of preventing it.
 *
 * This helper closes that window: the mutation, its audit/event rows, and
 * the idempotency row all commit in **one** transaction, serialized per
 * `(namespace, principalId, key)` by a transaction-scoped
 * `pg_advisory_xact_lock` taken **before** the cache read — a concurrent
 * waiter is guaranteed to see the winner's commit and recheck the request
 * hash against it, rather than proceeding from a stale cache miss. The lock
 * is released automatically when the transaction ends (commit or rollback),
 * so a failed write never wedges the key.
 *
 * `namespace` scopes both the advisory lock id and the persisted cache row,
 * so two modules can't collide on the same numeric lock space by
 * coincidence (e.g. `"funds"`, `"budgets"`), and — just as importantly —
 * can't collide on the same `idempotency_keys` row when a caller happens to
 * reuse the same literal `Idempotency-Key` value across two different
 * endpoints. `idempotencyKeys`' primary key is `(principalId, key)` with no
 * namespace column (no migration for one in this phase), so the row is
 * scoped by storing `${namespace}:${key}` as `key` instead of the raw
 * value — internal only: the caller-facing `Idempotency-Key` header value
 * is never itself prefixed, only how the row is addressed here.
 *
 * A client retrying with a key issued before this change (funds' rows,
 * predating the `budgets` namespace and this prefix) will not match the old
 * unprefixed row and will re-execute rather than replay — a one-time,
 * short-lived (24h TTL) gap at the deploy boundary, not an ongoing risk.
 */
export async function runFinancialWrite<T extends object>(
  deps: { db: DbClient; now(): Date },
  namespace: string,
  principalId: string,
  request: { key: string | undefined; method: string; path: string; body: string },
  write: (tx: DbClient) => Promise<T>,
  status = 201,
): Promise<{ body: T; status: number }> {
  const key = requireIdempotencyKey(request.key);
  const storedKey = `${namespace}:${key}`;
  const requestHash = createHash("sha256").update(`${request.method} ${request.path}\n${request.body}`).digest("hex");
  const lockId = createHash("sha256").update(JSON.stringify([namespace, principalId, key])).digest().readBigInt64BE();

  return withUserContext(deps.db, { userId: principalId }, async (tx) => {
    // Transaction-scoped PostgreSQL serialization also works across processes.
    // Take it before the cache read: a waiter must see the prior commit and
    // recheck its hash, rather than proceeding from a stale cache miss.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${lockId.toString()}::bigint)`);
    const [existing] = await tx.select().from(idempotencyKeys)
      .where(and(eq(idempotencyKeys.principalId, principalId), eq(idempotencyKeys.key, storedKey)))
      .limit(1);
    if (existing && existing.expiresAt > deps.now()) {
      if (existing.requestHash !== requestHash) {
        throw new ApiError(422, "idempotency_key_reused", "Idempotency-Key was already used with a different request");
      }
      if (existing.statusCode !== null) return { body: existing.responseBody as T, status: existing.statusCode };
    }

    // Errors escape the transaction, rolling back both the write and replay
    // state. New 4xx/5xx outcomes are not cached; only committed successes
    // consume a key.
    const body = await write(tx);
    const outcome = {
      requestHash,
      statusCode: status,
      responseBody: body,
      expiresAt: new Date(deps.now().getTime() + TTL_MS),
    };
    await tx.insert(idempotencyKeys).values({ principalId, key: storedKey, ...outcome })
      .onConflictDoUpdate({ target: [idempotencyKeys.principalId, idempotencyKeys.key], set: outcome });
    return { body, status };
  });
}
