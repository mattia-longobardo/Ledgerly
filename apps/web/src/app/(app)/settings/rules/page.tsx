import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { RulesScreen } from "./rules-screen";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings");
  return { title: `${t("tabs.rules")} · ${t("title")}` };
}

/** Settings › Rules (categories-and-rules.md §4): the screen reads `/api/v1` itself. */
export default function SettingsRulesPage() {
  return <RulesScreen />;
}
