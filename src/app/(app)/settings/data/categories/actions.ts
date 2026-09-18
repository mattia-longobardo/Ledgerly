// src/app/(app)/settings/data/categories/actions.ts — Settings › Data, the categories and labels
// of spec §7.2: validate → service → revalidate, as in `modules/accounts/actions.ts`.
"use server";

import { revalidatePath } from "next/cache";
import {
  archiveCategory,
  createCategory,
  createLabel,
  deleteLabel,
  restoreCategory,
  TaxonomyError,
  updateCategory,
  updateLabel,
} from "@/modules/transactions/taxonomy";
import { requireSession } from "@/platform/auth/session";

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

/** Both lists feed Expenses too: its filters and its category card read the same rows. */
function revalidate(): void {
  revalidatePath("/settings/data");
  revalidatePath("/expenses");
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
