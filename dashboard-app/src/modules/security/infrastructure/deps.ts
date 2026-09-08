import type { DbClient } from "@/lib/db/client";
import { recordAudit } from "@/platform/audit/record";
import type { UseCaseDeps } from "../application/ports";
import { DrizzleTokensRepository } from "./drizzle-tokens-repository";

/**
 * The production assembly of `UseCaseDeps`, bound to one transaction — the
 * flat shape `interestDeps` and `timeoffDeps` follow. RLS context is opened
 * once by the caller.
 *
 * `now` is a parameter rather than a hard-wired `new Date()` because this
 * module compares an expiry date against it: the API hands over `ApiDeps.now`,
 * the same clock the rate limiter and the idempotency store read, so a request
 * cannot decide "expired" against one clock and "not yet" against another.
 * Server actions take the default.
 */
export function securityDeps(
  tx: DbClient,
  requestId?: string | null,
  now: () => Date = () => new Date(),
): UseCaseDeps {
  return {
    tokens: new DrizzleTokensRepository(tx),
    clock: { now },
    audit: (e) => recordAudit(tx, { ...e, requestId: requestId ?? null }),
  };
}
