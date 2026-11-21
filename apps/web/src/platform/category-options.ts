"use client";

// The categories of a picker, from `GET /categories` (rewrite plan R3): one type, in tree order, each
// in the colour the server resolved (`displayColor`); `undefined` until the answer is in.
import { categories as categoryRoutes } from "@ledgerly/api-contract/settings";
import { useApi } from "@ledgerly/ui/data";
import type { CategoryOption } from "@ledgerly/ui/category-picker";

export function useCategoryOptions(type: "expense" | "income"): CategoryOption[] | undefined {
  const list = useApi(categoryRoutes.listCategories, { query: {} }).data;
  return list?.categories
    .filter((category) => category.type === type)
    .map((category) => ({
      id: category.id,
      name: category.name,
      color: category.displayColor,
      depth: category.depth,
    }));
}
