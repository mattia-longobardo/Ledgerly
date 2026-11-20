import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { getCategory, TaxonomyError } from "@ledgerly/domain/transactions";
import { requireSession } from "@/platform/auth/session";
import { CategoryScreen } from "./category-screen";

/**
 * The title names the category, which only a server read can give before the page is drawn (no
 * screen sets `document.title`). M10: a necessary server read, for the title only, as on an
 * account's page; a category that is not there keeps the section's title, and the screen says so.
 */
export async function generateMetadata({
  params,
}: PageProps<"/expenses/categories/[id]">): Promise<Metadata> {
  const ctx = await requireSession();
  const section = (await getTranslations("expenses.categories"))("title");
  try {
    return { title: `${(await getCategory({ userId: ctx.userId }, (await params).id)).name} · ${section}` };
  } catch (error) {
    if (error instanceof TaxonomyError) return { title: section };
    throw error;
  }
}

/** A category's page reads everything it shows from `/api/v1` (rewrite plan R3). */
export default async function CategoryPage({ params }: PageProps<"/expenses/categories/[id]">) {
  return <CategoryScreen id={(await params).id} />;
}
