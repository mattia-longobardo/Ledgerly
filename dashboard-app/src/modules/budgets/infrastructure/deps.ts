import { and, eq } from "drizzle-orm";
import type { DbClient } from "@/lib/db/client";
import { accounts, funds } from "@/lib/db/schema";
import { recordAudit } from "@/platform/audit/record";
import type { SourceLabels, UseCaseDeps } from "../application/ports";
import { DrizzleAllocationsRepository, DrizzleAmountVersionsRepository } from "./drizzle-allocations-repository";
import { DrizzleBudgetsRepository } from "./drizzle-budgets-repository";
import { DrizzleEventsRepository } from "./drizzle-events-repository";
import { DrizzleScopesRepository, DrizzleUsagesRepository } from "./drizzle-scopes-usages-repository";
import { drizzleOwnershipCheck } from "./ownership-check";
import { drizzleSourceBalanceSource } from "./source-balance-source";
import { drizzleTransactionsScopeSource } from "./transactions-scope-source";

function drizzleSourceLabels(db: DbClient): SourceLabels {
  return {
    async accountName(userId, id) {
      const [row] = await db.select({ name: accounts.name }).from(accounts).where(and(eq(accounts.userId, userId), eq(accounts.id, id))).limit(1);
      return row?.name ?? null;
    },

    async fundName(userId, id) {
      const [row] = await db.select({ name: funds.name }).from(funds).where(and(eq(funds.userId, userId), eq(funds.id, id))).limit(1);
      return row?.name ?? null;
    },
  };
}

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
    labels: drizzleSourceLabels(tx),
  };
}
