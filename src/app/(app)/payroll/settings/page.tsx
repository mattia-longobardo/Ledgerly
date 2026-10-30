import type { Metadata, Route } from "next";
import { getTranslations } from "next-intl/server";
import { codeMapView } from "@/modules/payroll/queries";
import { REPLY_TEAMSYSTEM_CODES } from "@/modules/payroll/rules";
import { requireSession } from "@/platform/auth/session";
import { ButtonLink } from "@/ui/button";
import { SettingsGrid, SettingsSection } from "@/ui/section";
import { Page } from "@/ui/shell/page";
import { TabLinks } from "@/ui/tab-links";
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
  const seeded = new Set(REPLY_TEAMSYSTEM_CODES.map((entry) => entry.code));

  return (
    <Page title={t("tabs.settings")} parent={{ href: "/payroll", label: t("title") }}>
      <div className="flex flex-col gap-4">
        <h1 className="text-title font-semibold tracking-[-0.02em] max-md:sr-only">{t("title")}</h1>
        <TabLinks
          label={t("tabs.label")}
          tabs={[
            { href: "/payroll", label: t("tabs.register"), active: false },
            { href: "/payroll/settings" as Route, label: t("tabs.settings"), active: true },
          ]}
        />
      </div>
      <SettingsGrid>
        <SettingsSection title={codes("title")} description={codes("description")} padded={false}>
          <CodeMapCard
            entries={codeMap.map((entry) => ({
              code: entry.code,
              role: entry.role,
              note: entry.note,
              seeded: seeded.has(entry.code),
            }))}
          />
        </SettingsSection>
        <SettingsSection title={t("settingsPage.related")} description={t("settingsPage.relatedDescription")}>
          <div className="flex flex-wrap gap-2">
            <ButtonLink href="/settings/integrations" size="sm">
              {t("settingsPage.paperless")}
            </ButtonLink>
            {ctx.role === "admin" && (
              <ButtonLink href={"/settings/server" as Route} size="sm">
                {t("settingsPage.llm")}
              </ButtonLink>
            )}
          </div>
        </SettingsSection>
      </SettingsGrid>
    </Page>
  );
}
