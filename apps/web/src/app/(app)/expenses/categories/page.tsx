import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { CategoriesBoardScreen } from "./board-screen";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("expenses.categories"))("title") };
}

/** Expenses › Categories reads everything it shows from `/api/v1` (rewrite plan R3). */
export default function CategoriesPage() {
  return <CategoriesBoardScreen />;
}
