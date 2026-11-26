// The automatic categories' calls to `/api/v1` (rewrite plan R3): «Confirm», a choice for a group, its
// «Undo», the similar movements, the merge proposals and the default groups, with the answers of the
// Server Actions they replace. The similar movements come back with their day and amount formatted.
import { categories, categoryBoard, profile } from "@ledgerly/api-contract/settings";
import { movements, review, rules, spending } from "@ledgerly/api-contract/transactions";
import { ApiError, call } from "@ledgerly/api-client";
import { parseCents } from "@ledgerly/format/cents";
import { formatDate, formatMoney, numberStyle } from "@ledgerly/format/format";
import { invalidate, read } from "@ledgerly/ui/data";
import type { CategoryCommands } from "./ui/category-actions";

type Plain = { ok: true; count: number } | { ok: false; error: string };

/** What a category given to movements changes: the lists, the totals, «To review», the rules' counts. */
function changed(): void {
  invalidate(
    movements.getTransactionsView,
    movements.listTransactions,
    movements.getTransaction,
    spending.getSpending,
    spending.getSpendingBreakdown,
    spending.getSpendingSeries,
    review.getReview,
    rules.listRules,
    categories.listCategories,
    categories.getCategorySummary,
    categoryBoard.getCategoriesBoard,
    categoryBoard.getMergeProposals,
  );
}

/** A refusal of the use case as its code; a failure of the server throws, as the action did. */
function refused(error: unknown): { ok: false; error: string } {
  if (error instanceof ApiError && error.status < 500)
    return { ok: false, error: error.reason ?? error.code };
  throw error;
}

async function writing<T extends object>(
  work: () => Promise<T>,
): Promise<({ ok: true } & T) | { ok: false; error: string }> {
  try {
    const done = await work();
    changed();
    return { ok: true, ...done };
  } catch (error) {
    return refused(error);
  }
}

export const CATEGORY_CALLS: CategoryCommands = {
  confirm: (ids) => writing(() => call(review.confirmCategories, { body: { ids } })),
  choose: (ids, categoryId) => writing(() => call(review.chooseCategory, { body: { ids, categoryId } })),
  undo: (undoId) => writing(() => call(review.undoCategories, { params: { undoId } })),

  async similar(id, categoryId) {
    let similar;
    try {
      similar = await call(review.listSimilarMovements, { params: { id }, query: { categoryId } });
    } catch (error) {
      refused(error);
      // A movement or a category that is not there has no similar ones.
      return { text: "", rows: [] };
    }
    const prefs = await read(profile.getPreferences, {});
    const style = numberStyle(prefs);
    return {
      text: similar.text,
      rows: similar.rows.map((row) => ({
        id: row.id,
        date: formatDate(row.on, "long", prefs.locale),
        amount: formatMoney(parseCents(row.amount), style),
        categoryId: row.categoryId,
        suggestedCategoryId: row.suggestedCategoryId,
        automatic: row.automatic,
      })),
    };
  },

  async likely(id) {
    try {
      const { top } = await call(review.getCategorySuggestions, { params: { id } });
      return top;
    } catch {
      // The top of the picker is a help, never an error: a giroconto or a failure lists none.
      return [];
    }
  },
};

/** «They are different», and its «Undo». */
export async function dismissMerge(firstId: string, secondId: string, dismissed: boolean): Promise<Plain> {
  try {
    await call(dismissed ? review.dismissMergeProposal : review.restoreMergeProposal, {
      body: { firstId, secondId },
    });
    invalidate(review.getReview, categories.listCategories, categoryBoard.getMergeProposals);
    return { ok: true, count: 1 };
  } catch (error) {
    return refused(error);
  }
}

/** The default groups a person chose; the pass of the cascade runs after the answer, on the server. */
export const createDefaultGroups = (keys: string[]): Promise<Plain> =>
  writing(() => call(review.createDefaultGroups, { body: { keys } }));
