"use client";

// Admin › Server, read from `/api/v1/server` (rewrite plan R3): the identity provider, outgoing mail,
// the AI service, the jobs and the maintenance facts.
import { useTranslations } from "next-intl";
import { profile, server } from "@ledgerly/api-contract/settings";
import type { RouteOutput } from "@ledgerly/api-client";
import { useApi } from "@ledgerly/ui/data";
import { Loaded } from "@ledgerly/ui/loaded";
import { SettingsGrid, SettingsSection } from "@ledgerly/ui/section";
import { formatInstant } from "@ledgerly/format/format";
import { DiagnosticsCard } from "./diagnostics-card";
import { JobsCard } from "./jobs-card";
import { LlmCard } from "./llm-card";
import { MaintenanceCard } from "./maintenance-card";
import { OidcCard } from "./oidc-card";
import { SmtpCard } from "./smtp-card";

type Settings = RouteOutput<typeof server.getServerSettings>;
type Preferences = RouteOutput<typeof profile.getPreferences>;

/** The facts of the instance the sections show, from `GET /server/settings`. */
interface ServerFacts {
  /** The identity provider's origin in the instance's environment: the one the CSP names. */
  environmentOrigin: string | null;
  nextVersion: string;
  /** The people and the size of the last export. */
  lastExport: { users: number; bytes: number } | null;
}

const factsOf = (settings: Settings): ServerFacts => ({
  environmentOrigin: settings.oidc.environmentOrigin,
  nextVersion: settings.maintenance.nextVersion,
  lastExport: settings.maintenance.export,
});

/** A size a person reads at a glance: whole megabytes, in their own number format. */
function megabytes(bytes: number, locale: string): string {
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(bytes / 1_048_576)} MB`;
}

const originOf = (issuer: string): string | null => {
  try {
    return new URL(issuer.trim()).origin;
  } catch {
    return null;
  }
};

function OidcSection({
  settings,
  prefs,
  facts,
}: {
  settings: Settings;
  prefs: Preferences;
  facts: ServerFacts;
}) {
  const text = useTranslations("settings.oidc");
  const { oidc } = settings;
  const time = new Intl.DateTimeFormat(prefs.locale, { timeStyle: "short", timeZone: prefs.timeZone });
  const origin = originOf(oidc.issuer);
  return (
    <SettingsSection title={text("title")} description={text("description")}>
      <OidcCard
        issuer={oidc.issuer}
        clientId={oidc.clientId}
        adminGroup={oidc.adminGroup}
        secretHint={oidc.secretHint}
        saved={oidc.saved}
        lastCheck={
          oidc.lastCheck && {
            outcome: oidc.lastCheck.outcome,
            time: time.format(new Date(oidc.lastCheck.checkedAt)),
          }
        }
        foreignOrigin={
          origin && facts.environmentOrigin && origin !== facts.environmentOrigin ? origin : null
        }
      />
    </SettingsSection>
  );
}

function MaintenanceSection({
  settings,
  prefs,
  facts,
}: {
  settings: Settings;
  prefs: Preferences;
  facts: ServerFacts;
}) {
  const text = useTranslations("settings.maintenance");
  const { maintenance } = settings;
  const moment = new Intl.DateTimeFormat(prefs.locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: prefs.timeZone,
  });
  const backup = maintenance.lastBackup;
  return (
    <SettingsSection title={text("title")} description={text("description")}>
      <MaintenanceCard
        lastBackup={
          backup && { at: moment.format(new Date(backup.at)), size: megabytes(backup.size, prefs.locale) }
        }
        schedule={text("scheduleDetail", { kept: maintenance.backupsKept })}
        retention={text("retentionDetail")}
        version={`v${maintenance.version} · Next.js ${facts.nextVersion}${maintenance.postgres ? ` · PostgreSQL ${maintenance.postgres}` : ""}`}
        lastExport={
          maintenance.lastExport && facts.lastExport
            ? {
                at: moment.format(new Date(maintenance.lastExport)),
                users: facts.lastExport.users,
                size: megabytes(facts.lastExport.bytes, prefs.locale),
              }
            : null
        }
      />
    </SettingsSection>
  );
}

function JobsSection({ prefs }: { prefs: Preferences }) {
  const text = useTranslations("settings.jobs");
  const jobs = useApi(server.listJobs, {});
  return (
    <SettingsSection title={text("title")} description={text("description")} padded={false}>
      <Loaded state={jobs}>
        {({ jobs: list }) => (
          <JobsCard
            jobs={list.map((job) => ({
              name: job.name,
              tier: job.tier,
              lastRun: job.lastRun ? formatInstant(new Date(job.lastRun.startedAt), prefs) : null,
              status: job.lastRun?.status ?? null,
              error: job.lastRun?.error ?? null,
            }))}
          />
        )}
      </Loaded>
    </SettingsSection>
  );
}

export function ServerScreen() {
  const diagnosticsText = useTranslations("settings.diagnostics");
  const smtpText = useTranslations("settings.smtp");
  const llmText = useTranslations("settings.llm");
  const preferences = useApi(profile.getPreferences, {});
  const settings = useApi(server.getServerSettings, {});
  return (
    <Loaded state={preferences}>
      {(prefs) => (
        <Loaded state={settings}>
          {(saved) => (
            <SettingsGrid>
              <OidcSection settings={saved} prefs={prefs} facts={factsOf(saved)} />
              <SettingsSection title={smtpText("title")} description={smtpText("description")}>
                <SmtpCard
                  host={saved.smtp.host}
                  port={saved.smtp.port}
                  encryption={saved.smtp.encryption}
                  user={saved.smtp.user}
                  passwordHint={saved.smtp.passwordHint}
                  from={saved.smtp.from}
                  policy={saved.smtp.policy}
                  saved={saved.smtp.saved}
                />
              </SettingsSection>
              <SettingsSection title={llmText("title")} description={llmText("description")}>
                <LlmCard current={saved.llm && { model: saved.llm.model, keyHint: saved.llm.keyHint }} />
              </SettingsSection>
              <JobsSection prefs={prefs} />
              <SettingsSection
                title={diagnosticsText("title")}
                description={diagnosticsText("description")}
                padded={false}
              >
                <DiagnosticsCard prefs={prefs} />
              </SettingsSection>
              <MaintenanceSection settings={saved} prefs={prefs} facts={factsOf(saved)} />
            </SettingsGrid>
          )}
        </Loaded>
      )}
    </Loaded>
  );
}
