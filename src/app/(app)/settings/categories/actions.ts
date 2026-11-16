// src/app/(app)/settings/categories/actions.ts — Settings › Categories, the categories and labels
// of spec §7.2: validate → service → revalidate, as in `modules/accounts/actions.ts`.
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { TransactionError } from "@/modules/transactions/service";
import {
  archiveCategory,
  createCategory,
  createLabel,
  deleteCategory,
  deleteLabel,
  restoreCategory,
  TaxonomyError,
  updateCategory,
  updateLabel,
} from "@/modules/transactions/taxonomy";
import { requireSession } from "@/platform/auth/session";
import { mergeTwoCategories } from "./merge";
import {
  deleteWalletCategories,
  type WalletDeletionOutcome,
} from "@/platform/integrations/wallet/categories";

/**
 * The cards call these inside a transition with no error boundary, so a refusal comes back as a
 * `TaxonomyError` code the caller turns into one of its own catalogued messages.
 */
export type TaxonomyActionResult = { ok: true } | { ok: false; error: string };

export interface CategoryFormInput {
  name: string;
  /** The group's id, `""` for none (F2.5). */
  parentId: string;
  type: string;
  color: string | null;
}

export interface LabelFormInput {
  name: string;
  color: string | null;
}

/**
 * Both lists feed half the application: the Expenses filters, the Budgets rows, the Subscriptions
 * table and every category picker read the same categories, and all of them show their colour.
 */
function revalidate(): void {
  revalidatePath("/settings/categories");
  revalidatePath("/expenses");
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

export async function archiveCategoryAction(id: string): Promise<TaxonomyActionResult> {
  const ctx = await requireSession();
  return run(() => archiveCategory(ctx, id));
}

export async function restoreCategoryAction(id: string): Promise<TaxonomyActionResult> {
  const ctx = await requireSession();
  return run(() => restoreCategory(ctx, id));
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

/**
 * Deletes a category for good, here **and on Wallet** (owner, 2026-09-21).
 *
 * The two steps are orchestrated here rather than inside either service, and on purpose: the
 * taxonomy is a module and Wallet is a platform integration that already depends on that module,
 * so a service calling the other way round would close a circle. The action is the one place that
 * legitimately knows about both.
 *
 * The local delete goes first. If it fails, nothing has been destroyed anywhere; if Wallet then
 * refuses — its own records may still reference the category — the answer says so and the person
 * can finish the job there. The other order would let Wallet lose a category for a deletion that
 * never happened here.
 */
export async function deleteCategoryAction(
  id: string,
): Promise<
  | { ok: true; removed: number; uncategorised: number; wallet: WalletDeletionOutcome }
  | { ok: false; error: string }
> {
  const ctx = await requireSession();
  try {
    const deletion = await deleteCategory(ctx, id);
    const wallet = await deleteWalletCategories(ctx, deletion.externalIds);
    revalidate();
    return {
      ok: true,
      removed: deletion.removed.length,
      uncategorised: deletion.uncategorised,
      wallet,
    };
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
): Promise<{ ok: true; moved: number } | { ok: false; error: "failed" }> {
  const ctx = await requireSession();
  if (!z.uuid().safeParse(keepId).success || !z.uuid().safeParse(dropId).success) {
    return { ok: false, error: "failed" };
  }
  try {
    const { moved } = await mergeTwoCategories(ctx, { keepId, dropId });
    revalidatePath("/settings/categories");
    revalidatePath("/expenses");
    revalidatePath("/budgets");
    revalidatePath("/");
    return { ok: true, moved };
  } catch (error) {
    if (error instanceof TransactionError || error instanceof z.ZodError)
      return { ok: false, error: "failed" };
    throw error;
  }
}
