// src/app/(app)/settings/categories/source.ts — the categories of a source that gives its own, as
// the screen reads and changes them (rewrite plan N3.1; ux/n3-categories-manual.md §6.4). The
// categories and their movements are the transactions module's, the limits of the budgets are the
// budgets module's, and the name of a source is the integrations': only the application joins
// them (rule M8). A change is one transaction — the movements, the category put away and the
// limits, or nothing — and so is its "Undo".
import "server-only";
import { sourceNotes as notesOfSources } from "@ledgerly/api";
import { listSourceCategories, type SourceCategoryView } from "@ledgerly/domain/transactions";
import { colorOfCategory, listCategoriesWithUsage } from "@ledgerly/domain/transactions";
import type { Ctx } from "@ledgerly/domain/platform/context";
import { sourceNameOf } from "@/platform/integrations/registry";

import type { SourceCategoryRow } from "./source-categories";

/** The categories of one source, under the name a person reads for it. */
interface SourceCategoriesSection {
  provider: string;
  name: string;
  rows: SourceCategoryView[];
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
      section = { provider: row.provider, name: await sourceNameOf(row.provider, ctx.locale), rows: [] };
      sections.push(section);
    }
    section.rows.push(row);
  }
  return sections;
}

/**
 * "Categories of {source}" as the source's page draws it (plugin-settings.md §2.2): each category
 * of the source with the category it counts under, and the categories of its kind it may be
 * matched to. `null` while the source has given no category.
 */
export async function sourceCategoryRows(
  ctx: Pick<Ctx, "userId" | "locale">,
  provider: string,
): Promise<{ name: string; rows: SourceCategoryRow[] } | null> {
  const section = (await sourceCategorySections(ctx)).find((one) => one.provider === provider);
  if (!section) return null;
  const categories = await listCategoriesWithUsage(ctx, { includeArchived: true });
  const byId = new Map(categories.map(({ category }) => [category.id, category]));
  // What a source's category may be matched to: the categories in use, in tree order, by kind.
  const matchable = categories
    .filter(({ category }) => category.archivedAt === null)
    .map(({ category }) => ({
      id: category.id,
      name: category.name,
      color: colorOfCategory(category, byId),
      depth: (category.parentId === null ? 0 : 1) as 0 | 1,
      type: category.type,
    }));
  return {
    name: section.name,
    rows: section.rows.map((row) => {
      const counted = row.categoryId === null ? undefined : byId.get(row.categoryId);
      // The kind of a source's category is the kind of the category it counts under.
      const type = counted?.type ?? "expense";
      return {
        id: row.id,
        name: row.name,
        nested: row.groupName !== null && row.groupName !== row.name,
        count: row.count,
        isNew: row.isNew,
        choice: row.choice,
        category:
          row.choice === "matched" && counted
            ? { id: counted.id, name: counted.name, color: colorOfCategory(counted, byId) }
            : null,
        // Its own macro, or Transfers: a source's category may count as transfers (§2.4).
        options: matchable.filter((option) => option.type === type || option.type === "transfer"),
      };
    }),
  };
}

/** For each category: "From {source}: {names}", where the names say more than the category's own. */
export const sourceNotes = (ctx: Pick<Ctx, "userId" | "locale">) => notesOfSources(ctx, sourceNameOf);

// The use cases of a change live in `apps/api`, with the routes; the screen's views stay here.
export { setSourceCategory, undoSourceCategoryChange } from "@ledgerly/api";
