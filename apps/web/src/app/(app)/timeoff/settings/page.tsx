import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { sourceHref } from "@/app/(app)/settings/integrations/connection-view";
import { TREK_PROVIDER } from "@ledgerly/domain/platform/integrations";
import { TimeOffSettingsScreen } from "./settings-screen";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("timeoff");
  return { title: `${t("tabs.settings")} · ${t("title")}` };
}

/**
 * Time off › Settings reads everything it shows from `/api/v1` (rewrite plan R3). The way to Trek's
 * page and its name come from the registry of the providers, which only the server holds
 * (plugin-settings.md §2.2); it reads no data.
 */
export default async function TimeOffSettingsPage() {
  const integrations = await getTranslations("settings.integrations");
  const link = {
    name: integrations("providers.trek.name"),
    href: sourceHref(TREK_PROVIDER) ?? "/settings/integrations",
  };
  return <TimeOffSettingsScreen calendarLink={link} />;
}
