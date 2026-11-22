import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { categories as categoryRoutes } from "@ledgerly/api-contract/settings";
import { apiRead } from "@/platform/api-read";
import { CategoryScreen } from "./category-screen";

/**
 * The title names the category, which only the server can give before the page is drawn (no screen
 * sets `document.title`). It asks `/api/v1` (`apiRead`); a category that is not there keeps the
 * section's title, and the screen says so.
 */
export async function generateMetadata({
  params,
}: PageProps<"/expenses/categories/[id]">): Promise<Metadata> {
  const section = (await getTranslations("expenses.categories"))("title");
  const { id } = await params;
  const list = await apiRead(categoryRoutes.listCategories, { query: { archived: "true" } });
  const category = list?.categories.find((one) => one.id === id);
  return { title: category ? `${category.name} · ${section}` : section };
}

/** A category's page reads everything it shows from `/api/v1` (rewrite plan R3). */
export default async function CategoryPage({ params }: PageProps<"/expenses/categories/[id]">) {
  return <CategoryScreen id={(await params).id} />;
}
