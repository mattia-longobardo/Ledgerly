import { PageGrid, Panel } from "@/components/layout/PageGrid";
import { PageHeader } from "@/components/layout/PageHeader";
import { ThemeToggle } from "@/components/ThemeToggle";
import { SettingsSection } from "@/components/ui/SettingsSection";
import { effectiveRate } from "@/lib/calc/vacation-fund";
import { db } from "@/lib/db";
import { SETTING_KEYS, getSetting } from "@/lib/repo/settings";
import { balance as ledgerBalance, ledger, rates } from "@/lib/repo/vacation";
import { monthKey } from "@/lib/time";
import { requirePrincipalOrRedirect } from "@/platform/auth/require-principal";
import { DEFAULT_HOURS_PER_DAY } from "../../_lib/vacation";
import { HoursPerDayForm, VacationSetupForm } from "../_components/SettingsForms";
import { loadProfile } from "../_lib/load-settings";

export const dynamic = "force-dynamic";
export const metadata = { title: "Personal" };

const COLUMN = "flex flex-col gap-10";

/** One row of the profile list: label on the left, value on the right. */
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-h-11 items-center gap-3 py-2 hairline-b">
      <dt className="min-w-0 flex-1 text-body-sm text-fg-muted">{label}</dt>
      <dd className="shrink-0 text-body text-fg">{value}</dd>
    </div>
  );
}

export default async function PersonalSettingsPage() {
  const principal = await requirePrincipalOrRedirect();
  const now = monthKey(new Date());

  const [profile, rateRows, entries, balance, hoursRaw] = await Promise.all([
    loadProfile(db, principal),
    rates(),
    ledger(),
    ledgerBalance(),
    getSetting<unknown>(SETTING_KEYS.hoursPerDay, DEFAULT_HOURS_PER_DAY),
  ]);

  const parsedHours = Number(hoursRaw);
  const hoursPerDay =
    Number.isFinite(parsedHours) && parsedHours > 0 ? parsedHours : DEFAULT_HOURS_PER_DAY;
  const rate = effectiveRate(rateRows, now);
  const hasInitialValue = entries.some((e) => e.entryType === "initial");

  return (
    <>
      <PageHeader title="Personal" />
      <PageGrid className="pt-5">
        <Panel span={6} ariaLabel="Personal settings" bodyClassName={COLUMN}>
          <SettingsSection
            title="Profile"
            footnote="Editing your profile arrives with account management in a later release."
          >
            <dl className="hairline-t">
              <Row label="Display name" value={profile.displayName} />
              <Row label="Email" value={profile.email ?? "Not set"} />
              <Row label="Locale" value={profile.locale} />
              <Row label="Time zone" value={profile.timezone} />
              <Row label="Currency" value={profile.currency} />
            </dl>
          </SettingsSection>

          <SettingsSection
            title="Vacation fund"
            footnote="The vacation fund becomes a Budget in a later release; the figures carry over."
          >
            <VacationSetupForm
              monthlyAmount={rate === null ? "" : String(rate).replace(".", ",")}
              effectiveFrom={now.slice(0, 7)}
              hasInitialValue={hasInitialValue}
              currentMonth={now.slice(0, 7)}
              balance={balance}
            />
          </SettingsSection>

          <SettingsSection title="Leave">
            <HoursPerDayForm hoursPerDay={hoursPerDay} />
          </SettingsSection>

          <SettingsSection title="Theme">
            <ThemeToggle variant="segmented" className="max-w-xs" />
          </SettingsSection>
        </Panel>
      </PageGrid>
    </>
  );
}
