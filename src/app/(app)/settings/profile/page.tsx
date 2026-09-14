import type { Metadata } from "next";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { getPreferences } from "@/modules/users/service";
import { hasPasswordAccount, hasSsoAccount } from "@/platform/auth/accounts";
import { getAuth } from "@/platform/auth/auth";
import { requireSession } from "@/platform/auth/session";
import { utcOffsetLabel } from "@/platform/dates";
import { SettingsSection } from "@/ui/section";
import { NameForm } from "./name-form";
import { PreferencesForm } from "./preferences-form";
import { SignInMethod } from "./sign-in-method";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings");
  return { title: `${t("tabs.profile")} · ${t("title")}` };
}

export default async function ProfilePage() {
  const ctx = await requireSession();
  const [session, sso, password, preferences] = await Promise.all([
    getAuth().api.getSession({ headers: await headers() }),
    hasSsoAccount(ctx.userId),
    hasPasswordAccount(ctx.userId),
    getPreferences(ctx),
  ]);
  const t = await getTranslations("settings");
  const now = new Date();
  const timeZones = Intl.supportedValuesOf("timeZone").map((zone) => ({
    value: zone,
    label: `${zone} (${utcOffsetLabel(zone, now)})`,
  }));
  return (
    <div className="flex flex-col gap-6">
      <SettingsSection title={t("account.title")} description={t("account.description")}>
        <NameForm
          name={session?.user.name ?? ""}
          email={session?.user.email ?? ""}
          role={ctx.role}
          sso={sso}
        />
      </SettingsSection>
      <SettingsSection title={t("signIn.title")} description={t("signIn.description")}>
        <SignInMethod sso={sso} password={password} />
      </SettingsSection>
      <SettingsSection title={t("preferences.title")} description={t("preferences.description")}>
        <PreferencesForm key={JSON.stringify(preferences)} initial={preferences} timeZones={timeZones} />
      </SettingsSection>
    </div>
  );
}
