import type { Metadata, Route } from "next";
import { getTranslations } from "next-intl/server";
import { codeMapView } from "@ledgerly/domain/payroll";
import { requireSession } from "@/platform/auth/session";
import { ButtonLink } from "@ledgerly/ui/button";
import { SettingsGrid, SettingsSection } from "@ledgerly/ui/section";
import { Page } from "@ledgerly/ui/shell/page";
import { TabLinks } from "@ledgerly/ui/tab-links";
import { UnsavedChangesProvider } from "@ledgerly/ui/unsaved-changes";
import { CodeMapCard } from "./code-map-card";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("payroll");
  return { title: `${t("tabs.settings")} · ${t("title")}` };
}

/**
 * Payroll › Settings (PERS-158): how a payslip is read. The code map is a rule of this module, and
 * the pension fund reads what it decides; the connection and the LLM fallback stay where every
 * connection and every server setting stay, and are only linked from here.
 */
export default async function PayrollSettingsPage() {
  const ctx = await requireSession();
  const t = await getTranslations("payroll");
  const codes = await getTranslations("settings.codeMap");
  const codeMap = await codeMapView(ctx);

  return (
    <Page title={t("tabs.settings")} parent={{ href: "/payroll", label: t("title") }}>
      <div className="flex flex-col gap-4">
        <h1 className="text-title font-semibold tracking-title max-md:sr-only">{t("title")}</h1>
        <TabLinks
          label={t("tabs.label")}
          tabs={[
            { href: "/payroll", label: t("tabs.register"), active: false },
            { href: "/payroll/settings" as Route, label: t("tabs.settings"), active: true },
          ]}
        />
      </div>
      {/* Save and Discard for the code map live in the banner, which appears with a change. */}
      <UnsavedChangesProvider>
        <SettingsGrid>
          <SettingsSection title={codes("title")} description={codes("description")} padded={false}>
            <CodeMapCard
              entries={codeMap}
            />
          </SettingsSection>
          {ctx.role === "admin" && (
            <SettingsSection title={t("settingsPage.related")} description={t("settingsPage.relatedDescription")}>
              <div className="flex flex-wrap gap-2">
                <ButtonLink href={"/settings/server" as Route} size="sm">
                  {t("settingsPage.llm")}
                </ButtonLink>
              </div>
            </SettingsSection>
          )}
        </SettingsGrid>
      </UnsavedChangesProvider>
    </Page>
  );
}
