import type { DbClient } from "@/lib/db/client";
import { recordAudit } from "@/platform/audit/record";
import type { UseCaseDeps } from "../application/ports";
import { DrizzleAllocationsRepository, DrizzleAmountVersionsRepository } from "./drizzle-allocations-repository";
import { DrizzleBudgetsRepository } from "./drizzle-budgets-repository";
import { DrizzleEventsRepository } from "./drizzle-events-repository";
import { DrizzleScopesRepository, DrizzleUsagesRepository } from "./drizzle-scopes-usages-repository";
import { drizzleOwnershipCheck } from "./ownership-check";
import { drizzleSourceBalanceSource } from "./source-balance-source";
import { drizzleTransactionsScopeSource } from "./transactions-scope-source";

export function budgetDeps(tx: DbClient, requestId?: string | null): UseCaseDeps {
  return {
    budgets: new DrizzleBudgetsRepository(tx),
    versions: new DrizzleAmountVersionsRepository(tx),
    allocations: new DrizzleAllocationsRepository(tx),
    scopes: new DrizzleScopesRepository(tx),
    usages: new DrizzleUsagesRepository(tx),
    events: new DrizzleEventsRepository(tx),
    transactions: drizzleTransactionsScopeSource(tx),
    balances: drizzleSourceBalanceSource(tx),
    ownership: drizzleOwnershipCheck(tx),
    clock: { now: () => new Date() },
    audit: (event) => recordAudit(tx, { ...event, requestId: requestId ?? null }),
  };
}
