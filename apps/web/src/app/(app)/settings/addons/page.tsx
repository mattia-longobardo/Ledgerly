import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AddonsScreen } from "./addons-screen";

export async function generateMetadata(): Promise<Metadata> {
  const text = await getTranslations("settings");
  return { title: `${text("tabs.addons")} · ${text("title")}` };
}

/** Settings › Addons (R5a, PA16) reads and writes `/api/v1/addons`. */
export default function AddonsPage() {
  return <AddonsScreen />;
}
