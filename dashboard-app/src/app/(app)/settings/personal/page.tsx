import Link from "next/link";
import { PageGrid, Panel } from "@/components/layout/PageGrid";
import { PageHeader } from "@/components/layout/PageHeader";
import { ThemeToggle } from "@/components/ThemeToggle";
import { SettingsSection } from "@/components/ui/SettingsSection";
import { db } from "@/lib/db";
import { DEFAULT_HOURS_PER_DAY, SETTING_KEYS, getSetting } from "@/lib/repo/settings";
import { requirePrincipalOrRedirect } from "@/platform/auth/require-principal";
import { HoursPerDayForm } from "../_components/SettingsForms";
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

  const [profile, hoursRaw] = await Promise.all([
    loadProfile(db, principal),
    getSetting<unknown>(SETTING_KEYS.hoursPerDay, DEFAULT_HOURS_PER_DAY),
  ]);

  const parsedHours = Number(hoursRaw);
  const hoursPerDay =
    Number.isFinite(parsedHours) && parsedHours > 0 ? parsedHours : DEFAULT_HOURS_PER_DAY;

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

          <SettingsSection title="Holidays budget">
            <Link
              href="/finance/budgets"
              className="inline-flex min-h-11 items-center text-body-sm font-medium text-accent transition-colors hover:text-accent-hover"
            >
              Holidays budget &rarr;
            </Link>
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
