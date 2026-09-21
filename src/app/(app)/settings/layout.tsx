import type { Route } from "next";
import { getTranslations } from "next-intl/server";
import { requireSession } from "@/platform/auth/session";
import { Page } from "@/ui/shell/page";
import { SettingsTabs, SettingsTitle } from "./settings-tabs";

export default async function SettingsLayout({ children }: LayoutProps<"/settings">) {
  const ctx = await requireSession();
  const t = await getTranslations("settings");
  const tabs: { href: Route; label: string }[] = [
    { href: "/settings/profile", label: t("tabs.profile") },
    { href: "/settings/security", label: t("tabs.security") },
    { href: "/settings/integrations", label: t("tabs.integrations") },
    { href: "/settings/categories", label: t("tabs.categories") },
    { href: "/settings/data", label: t("tabs.data") },
    // Admin › Users and Admin › Server (spec §7.10): only admins see them, and their pages
    // answer 404 to anyone else.
    ...(ctx.role === "admin"
      ? [
          { href: "/settings/users" as Route, label: t("tabs.users") },
          { href: "/settings/server" as Route, label: t("tabs.server") },
        ]
      : []),
  ];
  return (
    <Page title={<SettingsTitle tabs={tabs} />} parent={{ href: "/settings/profile", label: t("title") }}>
      {/* The whole column: each section takes a row of its own, its title and description beside
          its card as soon as the row is wide enough for both (`SettingsGrid`, spec §8.2). */}
      <div className="flex w-full flex-col gap-4">
        <h1 className="text-title font-semibold tracking-[-0.02em] max-md:sr-only">{t("title")}</h1>
        <SettingsTabs label={t("tabs.label")} tabs={tabs} />
        {children}
      </div>
    </Page>
  );
}
