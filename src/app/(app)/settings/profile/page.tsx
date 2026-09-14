import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { getPreferences } from "@/modules/users/service";
import { getAuth } from "@/platform/auth/auth";
import { OIDC_PROVIDER_ID } from "@/platform/auth/provider";
import { requireSession } from "@/platform/auth/session";
import { SettingsSection } from "@/ui/section";
import { NameForm } from "./name-form";
import { PreferencesForm } from "./preferences-form";

export default async function ProfilePage() {
  const ctx = await requireSession();
  const requestHeaders = await headers();
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  const accounts = await getAuth().api.listUserAccounts({ headers: requestHeaders });
  const t = await getTranslations("settings");
  return (
    <div className="flex flex-col gap-6">
      <SettingsSection title={t("account.title")} description={t("account.description")}>
        <NameForm
          name={session?.user.name ?? ""}
          email={session?.user.email ?? ""}
          sso={accounts.some((a) => a.providerId === OIDC_PROVIDER_ID)}
        />
      </SettingsSection>
      <SettingsSection title={t("preferences.title")} description={t("preferences.description")}>
        <PreferencesForm initial={await getPreferences(ctx)} timeZones={Intl.supportedValuesOf("timeZone")} />
      </SettingsSection>
    </div>
  );
}
