// The writes of "Categories of {source}" to `/api/v1/source-categories` (rewrite plan R3), with the
// answers of the Server Actions they replace: the change, or `{ ok: false }` for any refusal.
import {
  categories as categoryRoutes,
  categoryBoard,
  labels as labelRoutes,
} from "@ledgerly/api-contract/settings";
import { movements, review, spending } from "@ledgerly/api-contract/transactions";
import { budgets as budgetRoutes } from "@ledgerly/api-contract/budgets";
import { ApiError, call } from "@ledgerly/api-client";
import { invalidate } from "@ledgerly/ui/data";

/** Where a source's category counts changes the totals of the expenses, the budgets and the categories. */
function changed(): void {
  invalidate(
    labelRoutes.listSourceCategories,
    categoryRoutes.listCategories,
    categoryRoutes.getCategorySummary,
    categoryBoard.getCategoriesBoard,
    movements.getTransactionsView,
    movements.listTransactions,
    spending.getSpending,
    spending.getSpendingBreakdown,
    spending.getSpendingSeries,
    review.getReview,
    budgetRoutes.getBudgetsView,
    budgetRoutes.getBudgetsOverview,
    budgetRoutes.getBudget,
  );
}

/** A refusal is `{ ok: false }`, as the action answered; a failure of the server throws. */
async function attempt<T extends object>(
  work: () => Promise<T>,
): Promise<({ ok: true } & T) | { ok: false }> {
  try {
    const done = await work();
    changed();
    return { ok: true, ...done };
  } catch (error) {
    if (error instanceof ApiError && error.status < 500) return { ok: false };
    throw error;
  }
}

export const SOURCE_CATEGORY_CALLS = {
  set: (id: string, categoryId: string | null) =>
    attempt(() => call(labelRoutes.setSourceCategory, { params: { id }, body: { categoryId } })),
  undo: (undoId: string) =>
    attempt(async () => {
      await call(labelRoutes.undoSourceCategory, { params: { undoId } });
      return {};
    }),
  keep: (id: string) =>
    attempt(async () => {
      await call(labelRoutes.keepSourceCategory, { params: { id } });
      return {};
    }),
};
