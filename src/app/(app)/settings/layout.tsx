import type { Route } from "next";
import { getTranslations } from "next-intl/server";
import { Page } from "@/ui/shell/page";
import { SettingsTabs } from "./settings-tabs";

export default async function SettingsLayout({ children }: LayoutProps<"/settings">) {
  const t = await getTranslations("settings");
  return (
    <Page title={t("title")}>
      <h1 className="text-title font-semibold tracking-[-0.02em] max-md:hidden">{t("title")}</h1>
      <SettingsTabs
        label={t("tabs.label")}
        tabs={[
          { href: "/settings/profile" as Route, label: t("tabs.profile") },
          { href: "/settings/security" as Route, label: t("tabs.security") },
        ]}
      />
      {children}
    </Page>
  );
}
