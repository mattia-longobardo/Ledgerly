import type { Metadata } from "next";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { describeUserAgent } from "@/modules/users/rules";
import { listOwnSessions } from "@/modules/users/service";
import { hasPasswordAccount } from "@/platform/auth/accounts";
import { getAuth } from "@/platform/auth/auth";
import { requireSession } from "@/platform/auth/session";
import { civilDateIn } from "@/platform/dates";
import { formatDate, NULL_DISPLAY } from "@/platform/format";
import { readEnv } from "@/platform/env";
import { listApiClients } from "@/platform/auth/api-clients";
import { listConnectedApps } from "@/platform/auth/oauth-grants";
import { listTokens } from "@/platform/tokens/service";
import { SettingsGrid, SettingsSection } from "@/ui/section";
import { type ApiClientRow, ApiClientsTable } from "./api-clients-table";
import { type ConnectedAppRow, ConnectedAppsTable } from "./connected-apps-table";
import { NewApiClient } from "./new-api-client";
import { type SessionRow, SessionsList } from "./sessions-list";
import { type TokenRow, TokensTable } from "./tokens-table";
import { TwoFactorCard } from "./two-factor-card";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings");
  return { title: `${t("tabs.security")} · ${t("title")}` };
}

export default async function SecurityPage() {
  const ctx = await requireSession();
  const [current, sessions, tokens, clients, apps, hasPassword] = await Promise.all([
    (await getAuth()).api.getSession({ headers: await headers() }),
    listOwnSessions(ctx),
    listTokens(ctx),
    listApiClients(ctx),
    listConnectedApps(ctx),
    hasPasswordAccount(ctx.userId),
  ]);
  const t = await getTranslations("settings");

  const day = (at: Date) => formatDate(civilDateIn(at, ctx.timeZone), "long", ctx.locale);

  const tokenRows: TokenRow[] = tokens.map((token) => ({
    id: token.id,
    name: token.name,
    prefix: token.prefix,
    scopes: token.scopes,
    expires: token.expiresAt ? day(token.expiresAt) : t("tokens.expiry.never"),
    lastUsed: token.lastUsedAt ? day(token.lastUsedAt) : NULL_DISPLAY,
    state: token.state,
  }));

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
      {/* D4: the personal tokens still work until T5, but no new one is minted. The section shows
          only while one exists, so it disappears by itself once the last is revoked. */}
      {tokenRows.length > 0 && (
        <SettingsSection title={t("tokens.title")} description={t("tokens.legacyDescription")} padded={false}>
          <TokensTable tokens={tokenRows} />
        </SettingsSection>
      )}
      <SettingsSection title={t("sessions.title")} description={t("sessions.description")} padded={false}>
        <SessionsList sessions={rows} />
      </SettingsSection>
    </SettingsGrid>
  );
}
