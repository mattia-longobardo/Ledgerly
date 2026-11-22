import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { NotificationsScreen } from "./notifications-screen";

export async function generateMetadata(): Promise<Metadata> {
  const text = await getTranslations("settings");
  return { title: `${text("tabs.notifications")} · ${text("title")}` };
}

/** Settings › Alerts (R5e) reads and writes `/api/v1/notification-preferences`. */
export default function NotificationsPage() {
  return <NotificationsScreen />;
}
