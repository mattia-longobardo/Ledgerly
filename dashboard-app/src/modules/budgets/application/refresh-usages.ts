import { romeDate } from "@/lib/time";
import type { Principal } from "@/platform/auth/principal";
import { assertPermission } from "@/platform/auth/principal";
import { scopeMatches, usageAmount } from "../domain/scopes";
import { NotFoundError } from "./errors";
import type { UseCaseDeps } from "./ports";

export interface RefreshUsagesResult {
  inserted: number;
  updated: number;
  deleted: number;
}

/**
 * R6-3. Usages are derived state, never user intent, so this asserts
 * `budgets.read` (not `budgets.write`) — requiring write would 403 the
 * detail page for a viewer. It still records an audit row and a
 * `budget_events` row, but only when something actually changed, so a
 * repeated view of an unchanged budget doesn't spam either log.
 *
 * A budget with no scopes matches nothing: `scopeMatches` returns `false`
 * for every transaction when `scopes` is empty, so `rows` is empty and any
 * previously scope-matched usages are deleted by `replaceScopeMatched`
 * rather than silently kept.
 */
export function refreshUsages(deps: UseCaseDeps) {
  return async (principal: Principal, budgetId: string): Promise<RefreshUsagesResult> => {
    assertPermission(principal, "budgets.read");
    const budget = await deps.budgets.get(principal.userId, budgetId);
    if (!budget) throw new NotFoundError();

    const from = budget.startDate;
    const to = budget.endDate ?? romeDate(deps.clock.now());
    const [scopes, expenses] = await Promise.all([
      deps.scopes.listForBudget(budgetId),
      // `currency` filters: a transaction in another currency must not be
      // counted into this budget's `used` at face value.
      deps.transactions.listExpenses(principal.userId, { from, to, currency: budget.currency }),
    ]);

    const rows = expenses
      .filter((tx) => scopeMatches(scopes, tx))
      .map((tx) => ({ transactionId: tx.id, amount: usageAmount(tx), occurredAt: tx.occurredAt }))
      .filter((row): row is { transactionId: string; amount: string; occurredAt: string } => row.amount !== null);

    const result = await deps.usages.replaceScopeMatched(budgetId, rows);
    if (result.inserted > 0 || result.updated > 0 || result.deleted > 0) {
      await deps.audit({
        actorUserId: principal.userId,
        action: "budgets.usages_refreshed",
        entityType: "budget",
        entityId: budgetId,
        after: result,
      });
      await deps.events.add({ budgetId, kind: "usages_refreshed", detail: { ...result }, actorUserId: principal.userId });
    }
    return result;
  };
}
