import { romeDate } from "@/lib/time";
import type { Principal } from "@/platform/auth/principal";
import { assertPermission } from "@/platform/auth/principal";
import { figures, type BudgetFigures } from "../domain/figures";
import type { Budget, UseCaseDeps } from "./ports";
import { refreshUsages } from "./refresh-usages";
import { asOfFor } from "./validation";

export interface BudgetSummary {
  budget: Budget;
  figures: BudgetFigures;
  asOf: string;
}

/**
 * Refreshes each budget's scope-matched usages before reading them, the way
 * `getBudgetDetail` does. Without it the only surface that ever refreshed was
 * the detail page — no UI action exposes `POST /budgets/{id}/refresh` — so
 * `/finance/budgets` and the Home "Budgets" card kept showing pre-sync figures
 * indefinitely after a sync brought in matching expenses, and disagreed with
 * the detail page for the same budget.
 *
 * Sequential on purpose: `refreshUsages` opens no context of its own but does
 * write, and this is a personal dashboard with a handful of budgets, so one
 * scope query per budget in a predictable order beats fanning them out.
 */
export function listBudgets(deps: UseCaseDeps) {
  return async (principal: Principal, opts?: { includeArchived?: boolean }): Promise<BudgetSummary[]> => {
    assertPermission(principal, "budgets.read");
    const budgets = await deps.budgets.list(principal.userId, opts);
    const today = romeDate(deps.clock.now());
    const refresh = refreshUsages(deps);
    const summaries: BudgetSummary[] = [];
    for (const budget of budgets) {
      await refresh(principal, budget.id);
      const [versions, allocations, usages] = await Promise.all([
        deps.versions.listForBudget(budget.id),
        deps.allocations.listForBudget(budget.id),
        deps.usages.listForBudget(budget.id),
      ]);
      const asOf = asOfFor(budget.endDate, today);
      summaries.push({
        budget,
        figures: figures({ versions, allocations, usages, goalAmount: budget.goalAmount }, asOf),
        asOf,
      });
    }
    return summaries;
  };
}
