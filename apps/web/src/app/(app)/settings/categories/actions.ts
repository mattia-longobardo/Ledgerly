// src/app/(app)/settings/categories/actions.ts — Settings › Categories, the labels of spec §7.2:
// validate → service → revalidate, as in `modules/accounts/actions.ts`. The categories' writes call
// `/api/v1` (`modules/transactions/taxonomy-calls.ts`).
"use server";

import { revalidatePath } from "next/cache";
import { createLabel, deleteLabel, TaxonomyError, updateLabel } from "@ledgerly/domain/transactions";
import { requireSession } from "@/platform/auth/session";

/**
 * The cards call these inside a transition with no error boundary, so a refusal comes back as a
 * `TaxonomyError` code the caller turns into one of its own catalogued messages.
 */
type TaxonomyActionResult = { ok: true } | { ok: false; error: string };

interface LabelFormInput {
  name: string;
  color: string | null;
}

/**
 * The labels feed half the application: the Expenses filters and the Subscriptions table read them,
 * and all of them show their colour.
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
