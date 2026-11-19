import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { SecurityScreen } from "./security-screen";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings");
  return { title: `${t("tabs.security")} · ${t("title")}` };
}

/** Settings › Security reads everything it shows from `/api/v1`. */
export default function SecurityPage() {
  return <SecurityScreen />;
}
