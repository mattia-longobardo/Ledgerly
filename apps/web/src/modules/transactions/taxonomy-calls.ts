// The calls of the categories' board to `/api/v1` (rewrite plan R3): create, change, move, merge,
// archive, restore, delete and «Move to another section», each with its «Undo»; and the labels. Each
// keeps the answer of the Server Action it replaces, so the board and the cards read one shape;
// a refusal comes back as the use case's code (`duplicate`, `invalid_parent`, `not_found`…).
import { budgets as budgetRoutes } from "@ledgerly/api-contract/budgets";
import { categories, categoryBoard, labels, profile } from "@ledgerly/api-contract/settings";
import { movements, review, rules, spending } from "@ledgerly/api-contract/transactions";
import { ApiError, call, type RouteOutput } from "@ledgerly/api-client";
import { parseCents } from "@ledgerly/format/cents";
import { formatMoney, numberStyle } from "@ledgerly/format/format";
import { invalidate, read } from "@ledgerly/ui/data";

type Refusal = { ok: false; error: string };
type Done<T extends object = object> = ({ ok: true } & T) | Refusal;
type Undo = Record<string, unknown>;

/** A category as the board's forms send it: `""` is «no group». */
export interface CategoryFormInput {
  name: string;
  parentId: string;
  type: "income" | "expense" | "transfer";
  color: string | null;
}

/** What «Move to another section» says before the move, the amount formatted in the person's format. */
export type MacroMoveFacts = Omit<RouteOutput<typeof categories.getMacroMove>, "amount"> & {
  amount: string;
};

/** The categories feed half the application: the lists, the totals, the budgets and every picker. */
function changed(): void {
  invalidate(
    categories.listCategories,
    categories.getCategorySummary,
    categoryBoard.getCategoriesBoard,
    labels.listLabels,
    labels.listSourceCategories,
    movements.getTransactionsView,
    movements.listTransactions,
    movements.getTransaction,
    movements.getTransactionFacets,
    spending.getSpending,
    spending.getSpendingBreakdown,
    spending.getSpendingSeries,
    review.getReview,
    rules.listRules,
    budgetRoutes.listBudgets,
    budgetRoutes.getBudgetsView,
    budgetRoutes.getBudgetsOverview,
    budgetRoutes.getBudget,
  );
}

/** The use case's code: the route names it as the refusal's reason, or as the refusal itself. */
function refused(error: unknown): Refusal {
  if (error instanceof ApiError && error.status < 500)
    return { ok: false, error: error.reason ?? error.code };
  throw error;
}

async function writing<T extends object>(work: () => Promise<T>): Promise<Done<T>> {
  try {
    const done = await work();
    changed();
    return { ok: true, ...done };
  } catch (error) {
    return refused(error);
  }
}

/** A merge says one sentence whatever went wrong: `failed`. */
async function merging<T extends object>(work: () => Promise<T>): Promise<Done<T>> {
  const result = await writing(work);
  return result.ok ? result : { ok: false, error: "failed" };
}

const bodyOf = (input: CategoryFormInput) => ({ ...input, parentId: input.parentId || null });

export const createCategory = (input: CategoryFormInput) =>
  writing(async () => {
    await call(categories.createCategory, { body: bodyOf(input) });
    return {};
  });

export const saveCategory = (id: string, input: CategoryFormInput) =>
  writing(async () => {
    await call(categories.updateCategory, { params: { id }, body: bodyOf(input) });
    return {};
  });

/** Archive with «Undo»: the ids put away, the group's children too. */
export const archiveCategory = (id: string) =>
  writing(() => call(categories.archiveCategory, { params: { id } }));

/** One category back, or every one an archive put away («Undo»). */
export const restoreCategories = (ids: string[]) =>
  writing(async () => {
    await call(categories.restoreCategories, { body: { ids } });
    return {};
  });

/** «Move to another group» of the same macro; `fromId` is the group it left, for «Undo». */
export const moveCategory = (id: string, parentId: string) =>
  writing(() => call(categories.moveCategory, { params: { id }, body: { parentId } }));

export const mergeCategories = (keepId: string, dropId: string) =>
  merging(() => call(categories.mergeCategories, { body: { keepId, dropId } }));

/** «Undo» of a merge, with what the merge answered (the state before is held here, not stored). */
export const undoMerge = (undo: Undo) => merging(() => call(categories.undoMerge, { body: { undo } }));

/** Deletes a category for good, here and at its source; `external` says what the source did. */
export const deleteCategory = (id: string) =>
  writing(async () => {
    const { removed, uncategorised, external } = await call(categories.deleteCategory, { params: { id } });
    return { removed, uncategorised, external };
  });

export async function macroMoveFacts(id: string): Promise<Done<{ facts: MacroMoveFacts }>> {
  try {
    const { amount, ...rest } = await call(categories.getMacroMove, { params: { id } });
    const style = numberStyle(await read(profile.getPreferences, {}));
    return { ok: true, facts: { ...rest, amount: formatMoney(parseCents(amount), style) } };
  } catch (error) {
    return refused(error);
  }
}

/** «Move to another section»: the numbers change; `undo` is what «Undo» sends back. */
export const moveToMacro = (
  id: string,
  place: { type: CategoryFormInput["type"]; parentId: string | null },
) => writing(() => call(categories.moveToMacro, { params: { id }, body: place }));

export const undoMoveToMacro = (undo: Undo) =>
  writing(async () => {
    await call(categories.undoMoveToMacro, { body: { undo } });
    return {};
  });

/** A label as the card's form sends it. */
interface LabelFormInput {
  name: string;
  color: string | null;
}

export const createLabel = (input: LabelFormInput) =>
  writing(async () => {
    await call(labels.createLabel, { body: input });
    return {};
  });

export const saveLabel = (id: string, input: LabelFormInput) =>
  writing(async () => {
    await call(labels.updateLabel, { params: { id }, body: input });
    return {};
  });

export const deleteLabel = (id: string) =>
  writing(async () => {
    await call(labels.deleteLabel, { params: { id } });
    return {};
  });
