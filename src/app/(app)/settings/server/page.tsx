import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { identityProviderUrl } from "@/platform/auth/provider";
import { requireAdmin } from "@/platform/auth/session";
import { BACKUPS_KEPT, lastBackup, postgresVersion } from "@/platform/backup/service";
import { lastExport } from "@/platform/export/jobs";
import { issuerOrigin } from "@/platform/settings/oidc";
import { APP_VERSION, NEXT_VERSION } from "@/platform/version";
import { llmFallbackView, oidcView, smtpView } from "@/platform/settings/service";
import { SettingsGrid, SettingsSection } from "@/ui/section";
import { LlmCard } from "./llm-card";
import { MaintenanceCard } from "./maintenance-card";
import { OidcCard } from "./oidc-card";
import { SmtpCard } from "./smtp-card";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("settings.tabs"))("server") };
}

/** Admin › Server (spec §7.10): the identity provider, outgoing mail and the OpenAI fallback. */
export default async function SettingsServerPage() {
  const ctx = await requireAdmin();
  const [t, tOidc, tSmtp, tMaintenance, oidc, smtp, llm, exported] = await Promise.all([
    getTranslations("settings.llm"),
    getTranslations("settings.oidc"),
    getTranslations("settings.smtp"),
    getTranslations("settings.maintenance"),
    oidcView(ctx),
    smtpView(ctx),
    llmFallbackView(ctx),
    lastExport(),
  ]);
  const [backup, postgres] = await Promise.all([lastBackup(), postgresVersion()]);

  // Formatted here, in the user's zone and language, so the card renders the same string on the
  // server and in the browser (the design's "last check 07:10").
  const time = new Intl.DateTimeFormat(ctx.locale, { timeStyle: "short", timeZone: ctx.timeZone });
  const moment = new Intl.DateTimeFormat(ctx.locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: ctx.timeZone,
  });
  const envOrigin = identityProviderUrl()?.origin ?? null;
  const origin = issuerOrigin(oidc.issuer);

  return (
    <SettingsGrid>
      <SettingsSection title={tOidc("title")} description={tOidc("description")}>
        <OidcCard
          issuer={oidc.issuer}
          clientId={oidc.clientId}
          adminGroup={oidc.adminGroup}
          secretHint={oidc.secretHint}
          saved={oidc.saved}
          lastCheck={
            oidc.lastCheck && {
              outcome: oidc.lastCheck.outcome,
              time: time.format(oidc.lastCheck.checkedAt),
            }
          }
          foreignOrigin={origin && envOrigin && origin !== envOrigin ? origin : null}
        />
      </SettingsSection>
      <SettingsSection title={tSmtp("title")} description={tSmtp("description")}>
        <SmtpCard
          host={smtp.host}
          port={smtp.port}
          encryption={smtp.encryption}
          user={smtp.user}
          passwordHint={smtp.passwordHint}
          from={smtp.from}
          policy={smtp.policy}
          saved={smtp.saved}
        />
      </SettingsSection>
      <SettingsSection title={t("title")} description={t("description")}>
        <LlmCard current={llm && { model: llm.model, keyHint: llm.keyHint }} />
      </SettingsSection>
      <SettingsSection title={tMaintenance("title")} description={tMaintenance("description")}>
        <MaintenanceCard
          lastBackup={backup && { at: moment.format(backup.at), size: megabytes(backup.bytes, ctx.locale) }}
          schedule={tMaintenance("scheduleDetail", { kept: BACKUPS_KEPT })}
          retention={tMaintenance("retentionDetail")}
          version={`v${APP_VERSION} · Next.js ${NEXT_VERSION}${postgres ? ` · PostgreSQL ${postgres}` : ""}`}
          lastExport={
            exported && {
              at: moment.format(exported.at),
              users: exported.users,
              size: megabytes(exported.bytes, ctx.locale),
            }
          }
        />
      </SettingsSection>
    </SettingsGrid>
  );
}

/** A size a person reads at a glance: whole megabytes, in their own number format. */
function megabytes(bytes: number, locale: string): string {
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(bytes / 1_048_576)} MB`;
}
