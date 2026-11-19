"use client";

// Settings › Security, read from `/api/v1` (rewrite plan R3): the sign-in method, the second factor,
// the Client APIs, the connected apps and the sessions.
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { profile, security } from "@ledgerly/api-contract/settings";
import type { RouteOutput } from "@ledgerly/api-client";
import { API_SCOPES, type Scope, type TwoFactorPolicy } from "@ledgerly/domain/platform/auth/client";
import { civilDateIn } from "@ledgerly/format/dates";
import { formatDate } from "@ledgerly/format/format";
import { type ApiState, useApi } from "@ledgerly/ui/data";
import { Loaded } from "@ledgerly/ui/loaded";
import { SettingsGrid, SettingsSection } from "@ledgerly/ui/section";
import { type ApiClientRow, ApiClientsTable } from "./api-clients-table";
import { type ConnectedAppRow, ConnectedAppsTable } from "./connected-apps-table";
import { NewApiClient } from "./new-api-client";
import { type SessionRow, SessionsList } from "./sessions-list";
import { TwoFactorCard } from "./two-factor-card";

type Preferences = RouteOutput<typeof profile.getPreferences>;

/** The scopes a Client API or an app can hold and the screen can name. */
const isScope = (scope: string): scope is Scope => API_SCOPES.some((known) => known === scope);

/** A day as the reader writes it: the instant's civil date in their zone, in their language. */
const dayOf = (prefs: Preferences) => (instant: string) =>
  formatDate(civilDateIn(new Date(instant), prefs.timeZone), "long", prefs.locale);

/** Draws `children` once both reads are there. */
function Both<A, B>({
  first,
  second,
  children,
}: {
  first: ApiState<A>;
  second: ApiState<B>;
  children: (a: A, b: B) => ReactNode;
}) {
  return (
    <Loaded state={first}>{(one) => <Loaded state={second}>{(two) => children(one, two)}</Loaded>}</Loaded>
  );
}

function SessionsSection({
  preferences,
  current,
}: {
  preferences: ApiState<Preferences>;
  current: string | null;
}) {
  const text = useTranslations("settings");
  const sessions = useApi(security.listSessions, {});
  return (
    <SettingsSection title={text("sessions.title")} description={text("sessions.description")} padded={false}>
      <Both first={preferences} second={sessions}>
        {(prefs, { sessions: list }) => {
          const day = dayOf(prefs);
          const rows: SessionRow[] = list.map((session) => {
            const isCurrent = session.id === current;
            return {
              id: session.id,
              device:
                session.browser && session.os
                  ? `${session.browser} · ${session.os}`
                  : text("sessions.unknownDevice"),
              detail: [session.ipAddress, isCurrent && text("sessions.thisDevice")]
                .filter(Boolean)
                .join(" · "),
              status: isCurrent
                ? text("sessions.activeNow")
                : text("sessions.since", { date: day(session.createdAt) }),
              current: isCurrent,
            };
          });
          return <SessionsList sessions={rows} />;
        }}
      </Both>
    </SettingsSection>
  );
}

function ApiClientsSection({ preferences }: { preferences: ApiState<Preferences> }) {
  const text = useTranslations("settings");
  const clients = useApi(security.listApiClients, {});
  return (
    <SettingsSection
      title={text("apiClients.title")}
      description={text("apiClients.description")}
      action={<NewApiClient />}
      padded={false}
    >
      <Both first={preferences} second={clients}>
        {(prefs, { clients: list }) => {
          const day = dayOf(prefs);
          const rows: ApiClientRow[] = list.map((client) => ({
            clientId: client.clientId,
            name: client.name,
            scopes: client.scopes.filter(isScope),
            created: day(client.createdAt),
          }));
          return <ApiClientsTable clients={rows} />;
        }}
      </Both>
    </SettingsSection>
  );
}

function ConnectedAppsSection({ preferences }: { preferences: ApiState<Preferences> }) {
  const text = useTranslations("settings");
  const apps = useApi(security.listConnectedApps, {});
  return (
    <SettingsSection
      title={text("connectedApps.title")}
      description={text("connectedApps.description")}
      padded={false}
    >
      <Both first={preferences} second={apps}>
        {(prefs, { apps: list }) => {
          const day = dayOf(prefs);
          const rows: ConnectedAppRow[] = list.map((app) => ({
            clientId: app.clientId,
            name: app.name,
            hosts: app.hosts,
            verified: app.verified,
            scopes: app.scopes.filter(isScope),
            offline: app.offline,
            since: day(app.createdAt),
          }));
          return <ConnectedAppsTable apps={rows} />;
        }}
      </Both>
    </SettingsSection>
  );
}

export function SecurityScreen({
  signIn,
  currentSessionId,
  hasPassword,
  policy,
}: {
  /** How the account signs in: drawn by the server, which knows the identity provider's address. */
  signIn: ReactNode;
  currentSessionId: string | null;
  hasPassword: boolean;
  policy: TwoFactorPolicy;
}) {
  const text = useTranslations("settings");
  const person = useApi(profile.getProfile, {});
  const preferences = useApi(profile.getPreferences, {});
  return (
    <SettingsGrid>
      <SettingsSection title={text("signIn.title")} description={text("signIn.description")}>
        {signIn}
      </SettingsSection>
      {/* Password accounts only: an identity provider's user configures the second factor there. */}
      {hasPassword && person.data && (
        <SettingsSection
          title={text("twoFactor.title")}
          description={text("twoFactor.description")}
          padded={false}
        >
          <TwoFactorCard enabled={person.data.twoFactor} policy={policy} account={person.data.email} />
        </SettingsSection>
      )}
      <ApiClientsSection preferences={preferences} />
      <ConnectedAppsSection preferences={preferences} />
      <SessionsSection preferences={preferences} current={currentSessionId} />
    </SettingsGrid>
  );
}
