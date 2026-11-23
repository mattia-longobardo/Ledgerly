import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { sources } from "@ledgerly/api-contract/settings";
import { apiRead } from "@/platform/api-read";
import { TimeOffSettingsScreen } from "./settings-screen";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("timeoff");
  return { title: `${t("tabs.settings")} · ${t("title")}` };
}

/**
 * Time off › Settings reads everything it shows from `/api/v1` (rewrite plan R3); the way to the
 * page of the leave calendar is the plugin's that is one (`kind` of `GET /plugins`): none, no link.
 */
export default async function TimeOffSettingsPage() {
  const calendar = (await apiRead(sources.listPlugins, {}))?.plugins.find((one) => one.kind === "calendar");
  const link = calendar ? { name: calendar.name, href: `/settings/plugins/${calendar.id}` } : null;
  return <TimeOffSettingsScreen calendarLink={link} />;
}
