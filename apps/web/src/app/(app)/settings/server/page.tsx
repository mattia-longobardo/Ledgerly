import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireAdmin } from "@/platform/auth/session";
import { ServerScreen } from "./server-screen";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("settings.tabs"))("server") };
}

/** Admin › Server (spec §7.10): the screen reads everything it shows from `/api/v1/server`. */
export default async function SettingsServerPage() {
  await requireAdmin();
  return <ServerScreen />;
}
