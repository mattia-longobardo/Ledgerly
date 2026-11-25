/**
 * A person's categories as the automatic categories read them (rewrite plan, 04-now.md §4.4): the
 * ones a movement may be given, their kind and group, and the person's category for each key of the
 * default tree. Read by the cascade's service and by the import of labels.
 */
import { and, isNull } from "drizzle-orm";
import type { Ctx } from "../../../platform/context";
import { getDb } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import { categories, categoryGroupMarks } from "../schema";
import { groupCategories, type Knowledge } from "./cascade";
import { DEFAULT_CATEGORIES } from "./tables";

/** The person's categories a movement may be given, and their category for each default group. */
export async function categoriesOf(ctx: Pick<Ctx, "userId">): Promise<
  Pick<Knowledge, "groupCategory" | "categoryKind"> & {
    named: { id: string; name: string; type: "income" | "expense" }[];
    categoryGroup: Map<string, string>;
  }
> {
  const [active, marks] = await Promise.all([
    getDb()
      .select({
        id: categories.id,
        name: categories.name,
        type: categories.type,
        parentId: categories.parentId,
      })
      .from(categories)
      .where(and(userScoped(ctx).owns(categories), isNull(categories.archivedAt)))
      .orderBy(categories.name, categories.id),
    getDb()
      .select({ categoryId: categoryGroupMarks.categoryId, groupKey: categoryGroupMarks.groupKey })
      .from(categoryGroupMarks)
      .where(userScoped(ctx).owns(categoryGroupMarks))
      .orderBy(categoryGroupMarks.groupKey),
  ]);
  return {
    named: active,
    categoryKind: new Map(active.map((category) => [category.id, category.type])),
    categoryGroup: new Map(active.map((category) => [category.id, category.parentId ?? category.id])),
    groupCategory: groupCategories(
      DEFAULT_CATEGORIES,
      active,
      new Map(marks.map((mark) => [mark.categoryId, mark.groupKey])),
    ),
  };
}
