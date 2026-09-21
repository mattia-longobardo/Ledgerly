import type { Metadata } from "next";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { describeUserAgent } from "@/modules/users/rules";
import { listOwnSessions } from "@/modules/users/service";
import { getAuth } from "@/platform/auth/auth";
import { requireSession } from "@/platform/auth/session";
import { civilDateIn } from "@/platform/dates";
import { formatDate } from "@/platform/format";
import { SettingsGrid, SettingsSection } from "@/ui/section";
import { type SessionRow, SessionsList } from "./sessions-list";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings");
  return { title: `${t("tabs.security")} · ${t("title")}` };
}

export default async function SecurityPage() {
  const ctx = await requireSession();
  const [current, sessions] = await Promise.all([
    (await getAuth()).api.getSession({ headers: await headers() }),
    listOwnSessions(ctx),
  ]);
  const t = await getTranslations("settings");

  const rows: SessionRow[] = sessions.map((session) => {
    const { browser, os } = describeUserAgent(session.userAgent);
    const isCurrent = session.id === current?.session.id;
    const date = formatDate(civilDateIn(session.createdAt, ctx.timeZone), "long", ctx.locale);
    return {
      id: session.id,
      device: browser && os ? `${browser} · ${os}` : t("sessions.unknownDevice"),
      detail: [session.ipAddress, isCurrent && t("sessions.thisDevice")].filter(Boolean).join(" · "),
      status: isCurrent ? t("sessions.activeNow") : t("sessions.since", { date }),
      current: isCurrent,
    };
  });

  return (
    <SettingsGrid>
      <SettingsSection title={t("sessions.title")} description={t("sessions.description")} padded={false}>
        <SessionsList sessions={rows} />
      </SettingsSection>
    </SettingsGrid>
  );
}
