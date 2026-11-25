// "Categories of {source}" as the source's page draws it (plugin-settings.md §2.2), from `/api/v1`:
// each category of the source with the category it counts under, and the categories of its kind it
// may be matched to, in the colour the server gives each one. `null` while the source gave none.
import type { categories as categoryRoutes, labels as labelRoutes } from "@ledgerly/api-contract/settings";
import type { RouteOutput } from "@ledgerly/api-client";
import type { SourceCategoryRow } from "../finance/source-categories";

type SourceCategory = RouteOutput<typeof labelRoutes.listSourceCategories>["sourceCategories"][number];
type Category = RouteOutput<typeof categoryRoutes.listCategories>["categories"][number];

/** The rows of one source, from the answers of `/source-categories` and `/categories?archived=true`. */
export function sourceCategoryRowsOf(
  provider: string,
  sourceCategories: readonly Pick<
    SourceCategory,
    "id" | "provider" | "sourceName" | "name" | "groupName" | "choice" | "categoryId" | "isNew" | "count"
  >[],
  categories: readonly Pick<Category, "id" | "name" | "type" | "displayColor" | "depth" | "archivedAt">[],
): { name: string; rows: SourceCategoryRow[] } | null {
  const own = sourceCategories.filter((row) => row.provider === provider);
  if (own.length === 0) return null;
  const byId = new Map(categories.map((category) => [category.id, category]));
  // What a source's category may be matched to: the categories in use, in tree order, by kind.
  const matchable = categories
    .filter((category) => category.archivedAt === null)
    .map((category) => ({
      id: category.id,
      name: category.name,
      color: category.displayColor,
      depth: category.depth,
      type: category.type,
    }));
  return {
    name: own[0].sourceName,
    rows: own.map((row) => {
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
            ? { id: counted.id, name: counted.name, color: counted.displayColor }
            : null,
        // Its own macro (§2.4).
        options: matchable.filter((option) => option.type === type),
      };
    }),
  };
}
