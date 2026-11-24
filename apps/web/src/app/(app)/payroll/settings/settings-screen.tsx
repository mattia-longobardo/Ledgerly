"use client";

// Payroll › Settings (PERS-158), read from `/api/v1` (rewrite plan R3): how a payslip is read. The
// code map is a rule of this module, and the pension fund reads what it decides; the connection and
// the LLM fallback stay where every connection and every server setting stay, and are only linked
// from here. The code map is `GET /payroll/codes`; the employer (R5g, E6) is `GET /payroll/employer`.
import { useTranslations } from "next-intl";
import { codes as codeRoutes } from "@ledgerly/api-contract/payroll";
import { ButtonLink } from "@ledgerly/ui/button";
import { useApi } from "@ledgerly/ui/data";
import { Loaded } from "@ledgerly/ui/loaded";
import { SettingsGrid, SettingsSection } from "@ledgerly/ui/section";
import { Page } from "@ledgerly/ui/shell/page";
import { TabLinks } from "@ledgerly/ui/tab-links";
import { UnsavedChangesProvider } from "@ledgerly/ui/unsaved-changes";
import { EmployerSection } from "@/modules/payroll/client";
import { CodeMapCard } from "./code-map-card";

/** `admin`: the server settings, where the LLM fallback is, are a link of an admin's only. */
export function PayrollSettingsScreen({ admin }: { admin: boolean }) {
  const text = useTranslations("payroll");
  const codeText = useTranslations("settings.codeMap");
  const read = useApi(codeRoutes.listPayrollCodes, {});

  return (
    <Page title={text("tabs.settings")} parent={{ href: "/payroll", label: text("title") }}>
      <div className="flex flex-col gap-4">
        <h1 className="text-title font-semibold tracking-title max-md:sr-only">{text("title")}</h1>
        <TabLinks
          label={text("tabs.label")}
          tabs={[
            { href: "/payroll", label: text("tabs.register"), active: false },
            { href: "/payroll/settings", label: text("tabs.settings"), active: true },
          ]}
        />
      </div>
      {/* Save and Discard for the code map live in the banner, which appears with a change. */}
      <UnsavedChangesProvider>
        <SettingsGrid>
          <EmployerSection />
          <SettingsSection title={codeText("title")} description={codeText("description")} padded={false}>
            <Loaded state={read}>{(view) => <CodeMapCard entries={view.codes} />}</Loaded>
          </SettingsSection>
          {admin && (
            <SettingsSection title={text("settingsPage.related")} description={text("settingsPage.relatedDescription")}>
              <div className="flex flex-wrap gap-2">
                <ButtonLink href="/settings/server" size="sm">
                  {text("settingsPage.llm")}
                </ButtonLink>
              </div>
            </SettingsSection>
          )}
        </SettingsGrid>
      </UnsavedChangesProvider>
    </Page>
  );
}
