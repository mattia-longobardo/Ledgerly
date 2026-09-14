import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { describeUserAgent } from "@/modules/users/rules";
import { listOwnSessions } from "@/modules/users/service";
import { getAuth } from "@/platform/auth/auth";
import { requireSession } from "@/platform/auth/session";
import { civilDateIn } from "@/platform/dates";
import { formatDate } from "@/platform/format";
import { SettingsSection } from "@/ui/section";
import { PasswordForm } from "./password-form";
import { type SessionRow, SessionsList } from "./sessions-list";

export default async function SecurityPage() {
  const ctx = await requireSession();
  const requestHeaders = await headers();
  const auth = getAuth();
  const [current, sessions, accounts] = await Promise.all([
    auth.api.getSession({ headers: requestHeaders }),
    listOwnSessions(ctx),
    auth.api.listUserAccounts({ headers: requestHeaders }),
  ]);
  const hasPassword = accounts.some((a) => a.providerId === "credential");
  const t = await getTranslations("settings");

  const rows: SessionRow[] = sessions.map((session) => {
    const { browser, os } = describeUserAgent(session.userAgent);
    const date = formatDate(civilDateIn(session.createdAt, ctx.timeZone), "long", ctx.locale);
    return {
      id: session.id,
      device: browser && os ? `${browser} · ${os}` : t("sessions.unknownDevice"),
      detail: [session.ipAddress, t("sessions.since", { date })].filter(Boolean).join(" · "),
      current: session.id === current?.session.id,
    };
  });

  return (
    <div className="flex flex-col gap-6">
      <SettingsSection title={t("password.title")} description={t("password.description")}>
        {hasPassword ? <PasswordForm /> : <p className="text-muted">{t("password.ssoOnly")}</p>}
      </SettingsSection>
      <SettingsSection title={t("sessions.title")} description={t("sessions.description")}>
        <SessionsList sessions={rows} />
      </SettingsSection>
    </div>
  );
}
