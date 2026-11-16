// src/app/(app)/settings/categories/source.ts — the categories of a source that gives its own, as
// the screen reads and changes them (rewrite plan N3.1; ux/n3-categories-manual.md §6.4). The
// categories and their movements are the transactions module's, the limits of the budgets are the
// budgets module's, and the name of a source is the integrations': only the application joins
// them (rule M8). A change is one transaction — the movements, the category put away and the
// limits, or nothing — and so is its "Undo".
import "server-only";
import { limitsSnapshot, type LimitsSnapshot, mergeLimits, restoreLimits } from "@/modules/budgets/service";
import {
  chooseSourceCategory,
  listSourceCategories,
  type SourceCategoryChange,
  type SourceCategoryHooks,
  type SourceCategoryView,
  sourceNamesByCategory,
  undoSourceCategory,
} from "@/modules/transactions/source-categories";
import type { Ctx } from "@/platform/context";
import { monthKey, today } from "@/platform/dates";
import { getDb } from "@/platform/db/client";
import { labelOf } from "@/platform/integrations/registry";

type Who = Pick<Ctx, "userId" | "timeZone">;

/** The categories of one source, under the name a person reads for it. */
export interface SourceCategoriesSection {
  provider: string;
  name: string;
  rows: SourceCategoryView[];
}

async function nameOf(provider: string, locale: Ctx["locale"]): Promise<string> {
  return (await labelOf({ provider, instanceKey: "" }, locale)).provider;
}

/** One section for each source that has given a category, in the order of the sources' ids. */
export async function sourceCategorySections(
  ctx: Pick<Ctx, "userId" | "locale">,
): Promise<SourceCategoriesSection[]> {
  const rows = await listSourceCategories(ctx);
  const sections: SourceCategoriesSection[] = [];
  for (const row of rows) {
    let section = sections.find((one) => one.provider === row.provider);
    if (!section) {
      section = { provider: row.provider, name: await nameOf(row.provider, ctx.locale), rows: [] };
      sections.push(section);
    }
    section.rows.push(row);
  }
  return sections;
}

/** For each category: "From {source}: {names}", where the names say more than the category's own. */
export async function sourceNotes(
  ctx: Pick<Ctx, "userId" | "locale">,
): Promise<Map<string, { source: string; names: string[] }>> {
  const byCategory = await sourceNamesByCategory(ctx);
  const notes = new Map<string, { source: string; names: string[] }>();
  for (const [categoryId, entry] of byCategory) {
    notes.set(categoryId, { source: await nameOf(entry.provider, ctx.locale), names: entry.names });
  }
  return notes;
}

/** The budgets' side of a change: the limits of a category put away go to the one that stays. */
function limitHooks(ctx: Who): SourceCategoryHooks {
  const month = monthKey(today(ctx.timeZone));
  return {
    async onArchive({ keepId, dropId }, tx) {
      const before = await limitsSnapshot(ctx, [keepId, dropId], month, tx);
      const summed = await mergeLimits(ctx, { keepId, dropId, month }, tx);
      return summed > 0 ? before : null;
    },
    onRestore: (limits, tx) => restoreLimits(ctx, limits as LimitsSnapshot, tx),
  };
}

/** Matches a source's category to a category of the person, or adds it back as its own (`null`). */
export async function setSourceCategory(
  ctx: Who,
  input: { id: string; categoryId: string | null },
): Promise<SourceCategoryChange> {
  return getDb().transaction((tx) => chooseSourceCategory(ctx, input, tx, limitHooks(ctx)));
}

/** "Undo" of the last change. `null` when it can no longer be undone. */
export async function undoSourceCategoryChange(ctx: Who, undoId: string): Promise<{ moved: number } | null> {
  return getDb().transaction((tx) => undoSourceCategory(ctx, undoId, tx, limitHooks(ctx)));
}
