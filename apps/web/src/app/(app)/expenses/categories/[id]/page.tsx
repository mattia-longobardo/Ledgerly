import type { Metadata } from "next";
import { cache } from "react";
import { getTranslations } from "next-intl/server";
import { categories as categoryRoutes } from "@ledgerly/api-contract/settings";
import { apiRead } from "@/platform/api-read";
import { CategoryScreen } from "./category-screen";

/**
 * The title names the category, which only the server can give before the page is drawn (no screen
 * sets `document.title`). It asks `/api/v1` (`apiRead`); a category that is not there keeps the
 * section's title, and the screen says so. The page waits for the same read (`cache`), so the title is
 * there when the page is: the metadata is streamed, and a slower read would leave the document untitled.
 */
const titleOf = cache((id: string) =>
  Promise.all([
    getTranslations("expenses.categories"),
    apiRead(categoryRoutes.listCategories, { query: { archived: "true" } }),
  ]).then(([text, list]) => {
    const name = list?.categories.find((one) => one.id === id)?.name;
    return name === undefined ? text("title") : `${name} · ${text("title")}`;
  }),
);

export async function generateMetadata({
  params,
}: PageProps<"/expenses/categories/[id]">): Promise<Metadata> {
  const title = await params.then(({ id }) => titleOf(id));
  return { title };
}

/** A category's page reads everything it shows from `/api/v1` (rewrite plan R3). */
export default async function CategoryPage({ params }: PageProps<"/expenses/categories/[id]">) {
  const { id } = await params;
  // The title's read first: the screen is drawn once the document has its title.
  return titleOf(id).then(() => <CategoryScreen id={id} />);
}
