import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { utcOffsetLabel } from "@ledgerly/domain/shared/dates";
import { mailPolicy } from "@ledgerly/domain/platform/settings";
import { ProfileScreen } from "./profile-screen";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings");
  return { title: `${t("tabs.profile")} · ${t("title")}` };
}

/**
 * The screen reads the person and the preferences from `/api/v1`. Two values are still the server's
 * until the contract carries them: the zones labelled with their offset (the label is the domain's
 * date code, which `packages/ui` may not import) and whether an admin turned the monthly summary off
 * for the instance (only an admin may read the mail settings).
 */
export default async function ProfilePage() {
  const now = new Date();
  const timeZones = Intl.supportedValuesOf("timeZone").map((zone) => ({
    value: zone,
    label: `${zone} (${utcOffsetLabel(zone, now)})`,
  }));
  const policy = await mailPolicy();
  return <ProfileScreen timeZones={timeZones} summaryBlocked={!policy.monthlySummary} />;
}
