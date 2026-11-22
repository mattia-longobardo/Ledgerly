import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { TimeOffSettingsScreen } from "./settings-screen";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("timeoff");
  return { title: `${t("tabs.settings")} · ${t("title")}` };
}

/**
 * Time off › Settings reads everything it shows from `/api/v1` (rewrite plan R3); the way to the
 * calendar's page and its name are the page's own.
 */
export default async function TimeOffSettingsPage() {
  const integrations = await getTranslations("settings.integrations");
  const link = {
    name: integrations("providers.trek.name"),
    // The page of the leave calendar's source (`source` of `GET /connections`).
    href: "/settings/integrations/trek",
  };
  return <TimeOffSettingsScreen calendarLink={link} />;
}
