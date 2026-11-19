import { getTranslations } from "next-intl/server";
import { requireSession } from "@/platform/auth/session";
import { Page } from "@/ui/shell/page";
import { SectionTabs, SectionTitle } from "@ledgerly/ui/section-tabs";
import { UnsavedChangesProvider } from "@ledgerly/ui/unsaved-changes";
import { settingsTabsFor } from "../navigation";

export default async function SettingsLayout({ children }: LayoutProps<"/settings">) {
  const ctx = await requireSession();
  const t = await getTranslations("settings");
  const tabs = settingsTabsFor(ctx.role).map((tab) => ({ href: tab.href, label: t(`tabs.${tab.id}`) }));
  return (
    <Page title={<SectionTitle tabs={tabs} />} parent={{ href: "/settings/profile", label: t("title") }}>
      {/* The whole column: each section takes a row of its own, its title and description beside
          its card as soon as the row is wide enough for both (`SettingsGrid`, spec §8.2). */}
      <div className="flex w-full flex-col gap-4">
        <h1 className="text-title font-semibold tracking-title max-md:sr-only">{t("title")}</h1>
        <SectionTabs label={t("tabs.label")} tabs={tabs} />
        {/* A form with changes not saved shows its Save and the banner; leaving asks first. */}
        <UnsavedChangesProvider>{children}</UnsavedChangesProvider>
      </div>
    </Page>
  );
}
