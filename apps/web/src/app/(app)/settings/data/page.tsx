import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { DataScreen } from "./data-screen";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("settings.tabs"))("data") };
}

/** Settings › Data: the screen reads everything it shows from `/api/v1` (rewrite plan R3). */
export default function SettingsDataPage() {
  return <DataScreen />;
}
