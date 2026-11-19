import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ProfileScreen } from "./profile-screen";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings");
  return { title: `${t("tabs.profile")} · ${t("title")}` };
}

/** Settings › Profile reads everything it shows from `/api/v1`. */
export default function ProfilePage() {
  return <ProfileScreen />;
}
