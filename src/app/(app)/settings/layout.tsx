import type { Route } from "next";
import { getTranslations } from "next-intl/server";
import { Page } from "@/ui/shell/page";
import { SettingsTabs, SettingsTitle } from "./settings-tabs";

export default async function SettingsLayout({ children }: LayoutProps<"/settings">) {
  const t = await getTranslations("settings");
  const tabs: { href: Route; label: string }[] = [
    { href: "/settings/profile", label: t("tabs.profile") },
    { href: "/settings/security", label: t("tabs.security") },
    { href: "/settings/data", label: t("tabs.data") },
  ];
  return (
    <Page title={<SettingsTitle tabs={tabs} />} parent={{ href: "/settings/profile", label: t("title") }}>
      <h1 className="text-title font-semibold tracking-[-0.02em] max-md:sr-only">{t("title")}</h1>
      <SettingsTabs label={t("tabs.label")} tabs={tabs} />
      {children}
    </Page>
  );
}
