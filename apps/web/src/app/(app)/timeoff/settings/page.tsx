import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { sources } from "@ledgerly/api-contract/settings";
import { apiRead } from "@/platform/api-read";
import { statusOf } from "../../settings/plugins/plugin-model";
import { TimeOffSettingsScreen } from "./settings-screen";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("timeoff");
  return { title: `${t("tabs.settings")} · ${t("title")}` };
}

/**
 * Time off › Settings reads everything it shows from `/api/v1` (rewrite plan R3); the leave calendar
 * is the plugin that is one (`kind` of `GET /plugins`), with its state: none, no row.
 */
export default async function TimeOffSettingsPage() {
  const calendar = (await apiRead(sources.listPlugins, {}))?.plugins.find((one) => one.kind === "calendar");
  const words = await getTranslations("settings.plugins");
  // Its state in a word, and the step it needs (PERS-615 §4): «Activate», «Clean up», or its page.
  const link = calendar
    ? {
        id: calendar.id,
        name: calendar.name,
        href: `/settings/plugins/${calendar.id}`,
        state: calendar.pluginState,
        word: words(`states.${statusOf(calendar)}`),
      }
    : null;
  return <TimeOffSettingsScreen calendarLink={link} />;
}
