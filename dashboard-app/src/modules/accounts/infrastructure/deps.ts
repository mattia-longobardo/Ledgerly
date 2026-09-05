import type { DbClient } from "@/lib/db/client";
import { recordAudit } from "@/platform/audit/record";
import type { UseCaseDeps } from "../application/deps";
import { DrizzleAccountsRepository } from "./drizzle-accounts-repository";
import { DrizzleGroupsRepository } from "./drizzle-groups-repository";
import { DrizzleProviderLinksRepository } from "./drizzle-provider-links-repository";

/**
 * The production assembly of `UseCaseDeps`, bound to one transaction.
 *
 * Split out of `ui/deps.ts` so the HTTP API can build `UseCaseDeps` without
 * pulling in Auth.js: `ui/deps.ts` imports `require-principal`, which imports
 * `@/auth`, which drags in `next/server` — an import graph vitest's unit
 * environment cannot resolve and the API layer has no reason to need.
 */
export function accountDeps(tx: DbClient, requestId?: string | null): UseCaseDeps {
  return {
    accounts: new DrizzleAccountsRepository(tx),
    links: new DrizzleProviderLinksRepository(tx),
    groups: new DrizzleGroupsRepository(tx),
    clock: { now: () => new Date() },
    audit: (e) => recordAudit(tx, { ...e, requestId: requestId ?? null }),
  };
}
