import type { Metadata } from "next";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { describeUserAgent } from "@/modules/users/rules";
import { listOwnSessions } from "@/modules/users/service";
import { hasPasswordAccount, hasSsoAccount } from "@/platform/auth/accounts";
import { getAuth } from "@/platform/auth/auth";
import { requireSession } from "@/platform/auth/session";
import { civilDateIn } from "@/platform/dates";
import { formatDate } from "@/platform/format";
import { readEnv } from "@/platform/env";
import { listApiClients } from "@/platform/auth/api-clients";
import { listConnectedApps } from "@/platform/auth/oauth-grants";
import { SettingsGrid, SettingsSection } from "@/ui/section";
import { type ApiClientRow, ApiClientsTable } from "./api-clients-table";
import { type ConnectedAppRow, ConnectedAppsTable } from "./connected-apps-table";
import { NewApiClient } from "./new-api-client";
import { type SessionRow, SessionsList } from "./sessions-list";
import { TwoFactorCard } from "./two-factor-card";
import { SignInMethod } from "./sign-in-method";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings");
  return { title: `${t("tabs.security")} · ${t("title")}` };
}

export default async function SecurityPage() {
  const ctx = await requireSession();
  const [current, sessions, clients, apps, hasPassword, sso] = await Promise.all([
    (await getAuth()).api.getSession({ headers: await headers() }),
    listOwnSessions(ctx),
    listApiClients(ctx),
    listConnectedApps(ctx),
    hasPasswordAccount(ctx.userId),
    hasSsoAccount(ctx.userId),
  ]);
  const t = await getTranslations("settings");

  const day = (at: Date) => formatDate(civilDateIn(at, ctx.timeZone), "long", ctx.locale);

  const clientRows: ApiClientRow[] = clients.map((client) => ({
    clientId: client.clientId,
    name: client.name,
    scopes: client.scopes,
    created: day(client.createdAt),
  }));

  const appRows: ConnectedAppRow[] = apps.map((app) => ({
    clientId: app.clientId,
    name: app.name,
    hosts: app.hosts,
    verified: app.verified,
    scopes: app.scopes,
    offline: app.offline,
    since: day(app.createdAt),
  }));

  const rows: SessionRow[] = sessions.map((session) => {
    const { browser, os } = describeUserAgent(session.userAgent);
    const isCurrent = session.id === current?.session.id;
    return {
      id: session.id,
      device: browser && os ? `${browser} · ${os}` : t("sessions.unknownDevice"),
      detail: [session.ipAddress, isCurrent && t("sessions.thisDevice")].filter(Boolean).join(" · "),
      status: isCurrent ? t("sessions.activeNow") : t("sessions.since", { date: day(session.createdAt) }),
      current: isCurrent,
    };
  });

  return (
    <SettingsGrid>
      <SettingsSection title={t("signIn.title")} description={t("signIn.description")}>
        <SignInMethod sso={sso} password={hasPassword} />
      </SettingsSection>
      {/* Password accounts only: an Authentik user's second factor is configured in Authentik. */}
      {hasPassword && current && (
        <SettingsSection title={t("twoFactor.title")} description={t("twoFactor.description")} padded={false}>
          <TwoFactorCard
            enabled={current.user.twoFactorEnabled === true}
            policy={readEnv().TWO_FACTOR_POLICY}
            account={current.user.email}
          />
        </SettingsSection>
      )}
      <SettingsSection
        title={t("apiClients.title")}
        description={t("apiClients.description")}
        action={<NewApiClient />}
        padded={false}
      >
        <ApiClientsTable clients={clientRows} />
      </SettingsSection>
      <SettingsSection
        title={t("connectedApps.title")}
        description={t("connectedApps.description")}
        padded={false}
      >
        <ConnectedAppsTable apps={appRows} />
      </SettingsSection>
      <SettingsSection title={t("sessions.title")} description={t("sessions.description")} padded={false}>
        <SessionsList sessions={rows} />
      </SettingsSection>
    </SettingsGrid>
  );
}
