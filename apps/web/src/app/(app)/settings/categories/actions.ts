// src/app/(app)/settings/categories/actions.ts — Settings › Categories, the categories and labels
// of spec §7.2: validate → service → revalidate, as in `modules/accounts/actions.ts`.
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { TransactionError } from "@ledgerly/domain/transactions";
import {
  archiveCategory,
  createCategory,
  createLabel,
  deleteLabel,
  moveCategory,
  restoreCategories,
  restoreCategory,
  TaxonomyError,
  updateCategory,
  updateLabel,
} from "@ledgerly/domain/transactions";
import { requireSession } from "@/platform/auth/session";
import { formatMoney } from "@ledgerly/domain/platform/format";
import { type MacroMoveUndo, type MacroMoveView, macroMoveView, moveToMacro, undoMoveToMacro } from "./macro";
import { mergeTwoCategories, undoMergeOfTwo } from "./merge";
import { deleteCategoryEverywhere } from "@ledgerly/api";
import type { WalletDeletionOutcome } from "@ledgerly/domain/platform/integrations/wallet";

/**
 * The cards call these inside a transition with no error boundary, so a refusal comes back as a
 * `TaxonomyError` code the caller turns into one of its own catalogued messages.
 */
type TaxonomyActionResult = { ok: true } | { ok: false; error: string };

interface CategoryFormInput {
  name: string;
  /** The group's id, `""` for none (F2.5). */
  parentId: string;
  type: string;
  color: string | null;
}

interface LabelFormInput {
  name: string;
  color: string | null;
}

/**
 * Both lists feed half the application: the Expenses filters, the Budgets rows, the Subscriptions
 * table and every category picker read the same categories, and all of them show their colour.
 */
function revalidate(): void {
  revalidatePath("/settings/categories");
  // Expenses, "To review" and the page of the categories with its details.
  revalidatePath("/expenses", "layout");
  revalidatePath("/budgets");
  revalidatePath("/subscriptions");
}

async function run(work: () => Promise<unknown>): Promise<TaxonomyActionResult> {
  try {
    await work();
    revalidate();
    return { ok: true };
  } catch (error) {
    if (error instanceof TaxonomyError) return { ok: false, error: error.code };
    throw error;
  }
}

export async function createCategoryAction(input: CategoryFormInput): Promise<TaxonomyActionResult> {
  const ctx = await requireSession();
  return run(() => createCategory(ctx, input));
}

export async function saveCategoryAction(
  id: string,
  input: CategoryFormInput,
): Promise<TaxonomyActionResult> {
  const ctx = await requireSession();
  return run(() => updateCategory(ctx, id, input));
}

export async function restoreCategoryAction(id: string): Promise<TaxonomyActionResult> {
  const ctx = await requireSession();
  return run(() => restoreCategory(ctx, id));
}

/** Archive with "Undo" (categories-and-rules.md §5.6): the ids put away, the group's children too. */
export async function archiveWithUndoAction(
  id: string,
): Promise<{ ok: true; ids: string[] } | { ok: false; error: string }> {
  const ctx = await requireSession();
  let ids: string[] = [];
  const result = await run(async () => {
    ids = await archiveCategory(ctx, id);
  });
  return result.ok ? { ok: true, ids } : result;
}

/** "Undo" of an archive: every category it put away comes back. */
export async function restoreCategoriesAction(ids: string[]): Promise<TaxonomyActionResult> {
  const ctx = await requireSession();
  return run(() => restoreCategories(ctx, ids));
}

/** "Move to another group" of the same macro; `fromId` is the group it left, for "Undo". */
export async function moveCategoryAction(
  id: string,
  parentId: string,
): Promise<{ ok: true; fromId: string } | { ok: false; error: string }> {
  const ctx = await requireSession();
  let fromId = "";
  const result = await run(async () => {
    ({ fromId } = await moveCategory(ctx, id, parentId));
  });
  return result.ok ? { ok: true, fromId } : result;
}

export async function createLabelAction(input: LabelFormInput): Promise<TaxonomyActionResult> {
  const ctx = await requireSession();
  return run(() => createLabel(ctx, input));
}

export async function saveLabelAction(id: string, input: LabelFormInput): Promise<TaxonomyActionResult> {
  const ctx = await requireSession();
  return run(() => updateLabel(ctx, id, input));
}

export async function deleteLabelAction(id: string): Promise<TaxonomyActionResult> {
  const ctx = await requireSession();
  return run(() => deleteLabel(ctx, id));
}

/** Deletes a category for good, here and at its source: `deleteCategoryEverywhere`, as the route. */
export async function deleteCategoryAction(
  id: string,
): Promise<
  | { ok: true; removed: number; uncategorised: number; wallet: WalletDeletionOutcome }
  | { ok: false; error: string }
> {
  const ctx = await requireSession();
  try {
    const { removed, uncategorised, external } = await deleteCategoryEverywhere(ctx, id);
    revalidate();
    return { ok: true, removed, uncategorised, wallet: external };
  } catch (error) {
    if (error instanceof TaxonomyError) return { ok: false, error: error.code };
    throw error;
  }
}

/**
 * "Merge" of two categories that look like the same one (rewrite plan N3): the movements, the
 * sub-categories and the budget limits of one go to the other, in one transaction. `error` is
 * `failed` whatever went wrong: the dialog has one sentence, and nothing was changed.
 */
export async function mergeCategoriesAction(
  keepId: string,
  dropId: string,
): Promise<{ ok: true; moved: number; undo: unknown } | { ok: false; error: "failed" }> {
  const ctx = await requireSession();
  if (!z.uuid().safeParse(keepId).success || !z.uuid().safeParse(dropId).success) {
    return { ok: false, error: "failed" };
  }
  try {
    const { moved, undo } = await mergeTwoCategories(ctx, { keepId, dropId });
    revalidateMerge();
    return { ok: true, moved, undo };
  } catch (error) {
    if (error instanceof TransactionError || error instanceof z.ZodError)
      return { ok: false, error: "failed" };
    throw error;
  }
}

function revalidateMerge(): void {
  revalidatePath("/settings/categories");
  revalidatePath("/expenses", "layout");
  revalidatePath("/budgets");
  revalidatePath("/");
}

/**
 * "Undo" of a merge (categories-and-rules.md §5.6), with what `mergeCategoriesAction` handed back.
 * shortcut: the state before is held by the browser, not stored; a merge of more than 100,000
 * movements cannot be undone (`mergeUndoSchema`). Store it like `category_undos` if one ever needs to.
 */
export async function undoMergeAction(
  undo: unknown,
): Promise<{ ok: true; moved: number } | { ok: false; error: "failed" }> {
  const ctx = await requireSession();
  try {
    const moved = await undoMergeOfTwo(ctx, undo);
    revalidateMerge();
    return { ok: true, moved };
  } catch (error) {
    if (error instanceof TransactionError || error instanceof z.ZodError)
      return { ok: false, error: "failed" };
    throw error;
  }
}

/** What the dialog of "Move to another section" says before the move, the amount formatted here. */
export type MacroMoveFacts = Omit<MacroMoveView, "amountCents"> & { amount: string };

export async function macroMoveFactsAction(
  id: string,
): Promise<{ ok: true; facts: MacroMoveFacts } | { ok: false; error: string }> {
  const ctx = await requireSession();
  try {
    const { amountCents, ...rest } = await macroMoveView(ctx, id);
    return { ok: true, facts: { ...rest, amount: formatMoney(amountCents, ctx.numberFormat) } };
  } catch (error) {
    if (error instanceof TaxonomyError || error instanceof TransactionError)
      return { ok: false, error: error.code };
    throw error;
  }
}

/** "Move to another section" (§5.6): the numbers change (§3.7); `undo` is what "Undo" sends back. */
export async function moveToMacroAction(
  id: string,
  place: { type: string; parentId: string | null },
): Promise<{ ok: true; undo: MacroMoveUndo } | { ok: false; error: string }> {
  const ctx = await requireSession();
  let undo: MacroMoveUndo | null = null;
  const result = await run(async () => {
    undo = await moveToMacro(ctx, id, place);
  });
  return result.ok && undo ? { ok: true, undo } : result.ok ? { ok: false, error: "failed" } : result;
}

export async function undoMoveToMacroAction(undo: unknown): Promise<TaxonomyActionResult> {
  const ctx = await requireSession();
  try {
    await undoMoveToMacro(ctx, undo);
    revalidate();
    return { ok: true };
  } catch (error) {
    if (error instanceof TaxonomyError || error instanceof TransactionError)
      return { ok: false, error: error.code };
    if (error instanceof z.ZodError) return { ok: false, error: "invalid" };
    throw error;
  }
}
