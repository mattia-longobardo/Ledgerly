import type { Metadata } from "next";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { getPreferences } from "@ledgerly/domain/users";
import { hasSsoAccount } from "@ledgerly/domain/platform/auth";
import { getAuth } from "@ledgerly/domain/platform/auth";
import { requireSession } from "@/platform/auth/session";
import { utcOffsetLabel } from "@ledgerly/domain/shared/dates";
import { mailPolicy } from "@ledgerly/domain/platform/settings";
import { SettingsGrid, SettingsSection } from "@/ui/section";
import { NameForm } from "./name-form";
import { PreferencesForm } from "./preferences-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings");
  return { title: `${t("tabs.profile")} · ${t("title")}` };
}

export default async function ProfilePage() {
  const ctx = await requireSession();
  const [session, sso, preferences, policy] = await Promise.all([
    (await getAuth()).api.getSession({ headers: await headers() }),
    hasSsoAccount(ctx.userId),
    getPreferences(ctx),
    mailPolicy(),
  ]);
  const t = await getTranslations("settings");
  const now = new Date();
  const timeZones = Intl.supportedValuesOf("timeZone").map((zone) => ({
    value: zone,
    label: `${zone} (${utcOffsetLabel(zone, now)})`,
  }));

  return (
    <SettingsGrid>
      <SettingsSection title={t("account.title")} description={t("account.description")}>
        <NameForm
          name={session?.user.name ?? ""}
          email={session?.user.email ?? ""}
          role={ctx.role}
          sso={sso}
        />
      </SettingsSection>
      <SettingsSection title={t("preferences.title")} description={t("preferences.description")}>
        <PreferencesForm
          key={JSON.stringify(preferences)}
          initial={preferences}
          timeZones={timeZones}
          summaryBlocked={!policy.monthlySummary}
        />
      </SettingsSection>
    </SettingsGrid>
  );
}
