import type { DbClient } from "@/lib/db/client";
import { recordAudit } from "@/platform/audit/record";
import type { UseCaseDeps } from "../application/ports";
import { DrizzleCategoriesRepository } from "./drizzle-categories-repository";
import { DrizzleLabelsRepository } from "./drizzle-labels-repository";
import { DrizzleRecurringRepository } from "./drizzle-recurring-repository";
import { DrizzleTransactionsRepository } from "./drizzle-transactions-repository";

/**
 * The production assembly of `UseCaseDeps`, bound to one transaction. Follows
 * the accounts module's flat shape: RLS context is opened exactly once by the
 * caller (`withUserContext`/`withSystemContext`), which then builds a fresh
 * deps bag bound to that transaction via `expenseDeps(tx)`.
 */
export function expenseDeps(tx: DbClient, requestId?: string | null): UseCaseDeps {
  return {
    transactions: new DrizzleTransactionsRepository(tx),
    categories: new DrizzleCategoriesRepository(tx),
    labels: new DrizzleLabelsRepository(tx),
    recurring: new DrizzleRecurringRepository(tx),
    clock: { now: () => new Date() },
    audit: (e) => recordAudit(tx, { ...e, requestId: requestId ?? null }),
  };
}
