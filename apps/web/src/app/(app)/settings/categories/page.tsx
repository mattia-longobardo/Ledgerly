import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { CategoriesScreen } from "./categories-screen";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings");
  return { title: `${t("tabs.categories")} · ${t("title")}` };
}

/** Settings › Categories: the screen reads everything it shows from `/api/v1` (rewrite plan R3). */
export default function SettingsCategoriesPage() {
  return <CategoriesScreen />;
}
