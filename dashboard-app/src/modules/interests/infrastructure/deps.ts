import type { DbClient } from "@/lib/db/client";
import { recordAudit } from "@/platform/audit/record";
import type { UseCaseDeps } from "../application/ports";
import { drizzleAccountBalanceLookup } from "./account-balance-lookup";
import { DrizzleInterestAccrualsRepository } from "./drizzle-interest-accruals-repository";
import { DrizzleInterestEntriesRepository } from "./drizzle-interest-entries-repository";
import { DrizzleInterestRulesRepository } from "./drizzle-interest-rules-repository";

/**
 * The production assembly of `UseCaseDeps`, bound to one transaction. Follows
 * the accounts module's flat shape (the same one `expenseDeps` follows): RLS
 * context is opened exactly once by the caller (`withUserContext` /
 * `withSystemContext`), which then builds a fresh deps bag bound to that
 * transaction via `interestDeps(tx)`.
 */
export function interestDeps(tx: DbClient, requestId?: string | null): UseCaseDeps {
  return {
    rules: new DrizzleInterestRulesRepository(tx),
    accruals: new DrizzleInterestAccrualsRepository(tx),
    entries: new DrizzleInterestEntriesRepository(tx),
    balances: drizzleAccountBalanceLookup(tx),
    clock: { now: () => new Date() },
    audit: (e) => recordAudit(tx, { ...e, requestId: requestId ?? null }),
  };
}
