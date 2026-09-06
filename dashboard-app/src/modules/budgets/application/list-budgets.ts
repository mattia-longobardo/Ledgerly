import { romeDate } from "@/lib/time";
import type { Principal } from "@/platform/auth/principal";
import { assertPermission } from "@/platform/auth/principal";
import { figures, type BudgetFigures } from "../domain/figures";
import type { Budget, UseCaseDeps } from "./ports";

export interface BudgetSummary {
  budget: Budget;
  figures: BudgetFigures;
  asOf: string;
}

/** `asOf = min(endDate ?? today, today)` — a closed budget's figures stop moving at its end date. */
function asOfFor(endDate: string | null, today: string): string {
  return endDate !== null && endDate < today ? endDate : today;
}

export function listBudgets(deps: UseCaseDeps) {
  return async (principal: Principal, opts?: { includeArchived?: boolean }): Promise<BudgetSummary[]> => {
    assertPermission(principal, "budgets.read");
    const budgets = await deps.budgets.list(principal.userId, opts);
    const today = romeDate(deps.clock.now());
    return Promise.all(
      budgets.map(async (budget) => {
        const [versions, allocations, usages] = await Promise.all([
          deps.versions.listForBudget(budget.id),
          deps.allocations.listForBudget(budget.id),
          deps.usages.listForBudget(budget.id),
        ]);
        const asOf = asOfFor(budget.endDate, today);
        return {
          budget,
          figures: figures({ versions, allocations, usages, goalAmount: budget.goalAmount }, asOf),
          asOf,
        };
      }),
    );
  };
}
