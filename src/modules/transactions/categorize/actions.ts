// modules/transactions/categorize/actions.ts — the Server Actions of the automatic categories
// (rewrite plan N3; ux/n3-categories-manual.md §2-§7): validate → service → revalidate. A page
// gets from here a state, a category, the code of a reason and what its sentence names — never a
// confidence, a threshold or a model.
"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { requireSession } from "@/platform/auth/session";
import { formatDate, formatMoney } from "@/platform/format";
import { categorisableAccountIds, TransactionError } from "../service";
import {
  changeCategories,
  createDefaultGroups,
  dismissMergeProposal,
  restoreMergeProposal,
  similarTo,
  undoChange,
} from "./review";
import { categorise, isPreparing } from "./service";

type Session = Awaited<ReturnType<typeof requireSession>>;

export type ChangeResult = { ok: true; count: number; undoId: string | null } | { ok: false; error: string };
export type PlainResult = { ok: true; count: number } | { ok: false; error: string };

function failed(error: unknown): { ok: false; error: string } {
  if (error instanceof TransactionError) return { ok: false, error: error.code };
  if (error instanceof z.ZodError) return { ok: false, error: "invalid" };
  throw error;
}

function revalidate(): void {
  revalidatePath("/expenses");
  revalidatePath("/expenses/review");
  revalidatePath("/budgets");
  revalidatePath("/");
}

/**
 * A person confirmed or chose: those are new labels. The cascade learns from them and reads the
 * movements still waiting, after the answer has gone — nobody waits for a training.
 */
function learnAfter(ctx: Session): void {
  after(async () => {
    await categorise(ctx, await categorisableAccountIds(ctx));
  });
}

const idsSchema = z.array(z.uuid()).min(1).max(5000);

/** "Confirm": an automatic category or a suggestion becomes the person's own choice. */
export async function confirmCategoriesAction(ids: string[]): Promise<ChangeResult> {
  const ctx = await requireSession();
  try {
    const done = await changeCategories(ctx, idsSchema.parse(ids), { kind: "confirm" });
    revalidate();
    if (done.count > 0) learnAfter(ctx);
    return { ok: true, ...done };
  } catch (error) {
    return failed(error);
  }
}

/** The category chosen for a group, or for the movements similar to one: all of them or none. */
export async function chooseCategoryAction(ids: string[], categoryId: string | null): Promise<ChangeResult> {
  const ctx = await requireSession();
  try {
    const chosen = z.uuid().nullable().parse(categoryId);
    const done = await changeCategories(ctx, idsSchema.parse(ids), { kind: "set", categoryId: chosen });
    revalidate();
    if (done.count > 0) learnAfter(ctx);
    return { ok: true, ...done };
  } catch (error) {
    return failed(error);
  }
}

/** "Undo" of one of the two actions above. */
export async function undoCategoriesAction(undoId: string): Promise<PlainResult> {
  const ctx = await requireSession();
  try {
    const count = await undoChange(ctx, undoId);
    revalidate();
    return { ok: true, count };
  } catch (error) {
    return failed(error);
  }
}

/** A movement similar to the one just filed, as the dialog lists it: every text already formatted. */
export interface SimilarView {
  id: string;
  date: string;
  amount: string;
  /** The category it has now, by id; `null` for none. The dialog knows the names and the colours. */
  categoryId: string | null;
  suggestedCategoryId: string | null;
  automatic: boolean;
}

/**
 * The movements with the same text as `id` that Ledgerly may give `categoryId` to (decision K3).
 * A read: nothing is written until the person says "Apply".
 */
export async function similarMovementsAction(
  id: string,
  categoryId: string,
): Promise<{ text: string; rows: SimilarView[] }> {
  const ctx = await requireSession();
  if (!z.uuid().safeParse(id).success || !z.uuid().safeParse(categoryId).success)
    return { text: "", rows: [] };
  const similar = await similarTo(ctx, id, categoryId);
  return {
    text: similar.text,
    rows: similar.rows.map((row) => ({
      id: row.id,
      date: formatDate(row.on, "long", ctx.locale),
      amount: formatMoney(row.amountCents, ctx.numberFormat),
      categoryId: row.categoryId,
      suggestedCategoryId: row.suggestedCategoryId,
      automatic: row.automatic,
    })),
  };
}

const pairSchema = z.tuple([z.uuid(), z.uuid()]);

/** "They are different", and its "Undo". */
export async function dismissMergeAction(a: string, b: string, dismissed: boolean): Promise<PlainResult> {
  const ctx = await requireSession();
  try {
    const [first, second] = pairSchema.parse([a, b]);
    if (dismissed) await dismissMergeProposal(ctx, first, second);
    else await restoreMergeProposal(ctx, first, second);
    revalidatePath("/settings/categories");
    revalidatePath("/expenses/review");
    return { ok: true, count: 1 };
  } catch (error) {
    return failed(error);
  }
}

/**
 * The default groups a person chose, then a pass of the cascade: with groups, the tables can give
 * categories to the movements that were waiting. The pass runs after the answer; the page that
 * waits for it asks `categoriesPreparingAction`.
 */
export async function createDefaultGroupsAction(keys: string[]): Promise<PlainResult> {
  const ctx = await requireSession();
  try {
    const count = await createDefaultGroups(
      ctx,
      z.array(z.string().max(40)).min(1).max(20).parse(keys),
      ctx.locale,
    );
    revalidate();
    revalidatePath("/settings/categories");
    learnAfter(ctx);
    return { ok: true, count };
  } catch (error) {
    return failed(error);
  }
}

/** Whether a pass of the cascade is running for the person. */
export async function categoriesPreparingAction(): Promise<boolean> {
  return isPreparing(await requireSession());
}
