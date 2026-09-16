import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireSession } from "@/platform/auth/session";
import { SettingsSection } from "@/ui/section";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("settings.tabs"))("integrations") };
}

export default async function SettingsIntegrationsPage() {
  await requireSession();
  const t = await getTranslations("settings.integrations");

  return (
    <div className="flex flex-col gap-6">
      <SettingsSection title={t("title")} description={t("description")}>
        <p className="text-muted">{t("states.absent")}</p>
      </SettingsSection>
    </div>
  );
}
