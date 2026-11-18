// src/app/(app)/settings/categories/source-actions.ts — the Server Actions of "Categories of
// {source}": validate → use case (`source.ts`) → revalidate, nothing else.
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { keepSourceCategory, SourceCategoryError } from "@ledgerly/domain/transactions";
import { requireSession } from "@/platform/auth/session";
import { setSourceCategory, undoSourceCategoryChange } from "./source";

function revalidate(): void {
  revalidatePath("/settings/categories");
  revalidatePath("/settings/integrations", "layout");
  revalidatePath("/expenses");
  revalidatePath("/budgets");
  revalidatePath("/");
}

type SourceCategoryResult =
  | {
      ok: true;
      name: string;
      categoryName: string;
      choice: "added" | "matched";
      macro?: { from: "income" | "expense" | "transfer"; to: "income" | "expense" | "transfer" } | null;
      moved: number;
      undoId: string | null;
    }
  | { ok: false };

const choice = z.object({ id: z.uuid(), categoryId: z.uuid().nullable() });

/** Sets where a source's category counts: another category of the person, or its own (`null`). */
export async function setSourceCategoryAction(
  id: string,
  categoryId: string | null,
): Promise<SourceCategoryResult> {
  const ctx = await requireSession();
  const input = choice.safeParse({ id, categoryId });
  if (!input.success) return { ok: false };
  try {
    const change = await setSourceCategory(ctx, input.data);
    revalidate();
    return { ok: true, ...change };
  } catch (error) {
    if (error instanceof SourceCategoryError) return { ok: false };
    throw error;
  }
}

export async function undoSourceCategoryAction(undoId: string): Promise<{ ok: boolean }> {
  const ctx = await requireSession();
  if (!z.uuid().safeParse(undoId).success) return { ok: false };
  try {
    const undone = await undoSourceCategoryChange(ctx, undoId);
    revalidate();
    return { ok: undone !== null };
  } catch (error) {
    if (error instanceof SourceCategoryError) return { ok: false };
    throw error;
  }
}

/** "Keep as it is" on a new category of the source: it stays added, and is no longer "New". */
export async function keepSourceCategoryAction(id: string): Promise<{ ok: boolean }> {
  const ctx = await requireSession();
  if (!z.uuid().safeParse(id).success) return { ok: false };
  await keepSourceCategory(ctx, id);
  revalidatePath("/settings/categories");
  return { ok: true };
}
