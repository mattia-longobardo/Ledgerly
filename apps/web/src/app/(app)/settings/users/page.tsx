import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireAdmin } from "@/platform/auth/session";
import { UsersScreen } from "./users-screen";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings");
  return { title: `${t("tabs.users")} · ${t("title")}` };
}

/** Admin › Users (spec §7.10): the page answers 404 to anyone but an admin; the screen reads `/api/v1/people`. */
export default async function SettingsUsersPage() {
  await requireAdmin();
  return <UsersScreen />;
}
