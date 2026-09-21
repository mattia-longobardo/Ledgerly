import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { identityProviderUrl } from "@/platform/auth/provider";
import { requireAdmin } from "@/platform/auth/session";
import { issuerOrigin } from "@/platform/settings/oidc";
import { llmFallbackView, oidcView, smtpView } from "@/platform/settings/service";
import { SettingsGrid, SettingsSection } from "@/ui/section";
import { LlmCard } from "./llm-card";
import { OidcCard } from "./oidc-card";
import { SmtpCard } from "./smtp-card";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("settings.tabs"))("server") };
}

/** Admin › Server (spec §7.10): the identity provider, outgoing mail and the OpenAI fallback. */
export default async function SettingsServerPage() {
  const ctx = await requireAdmin();
  const [t, tOidc, tSmtp, oidc, smtp, llm] = await Promise.all([
    getTranslations("settings.llm"),
    getTranslations("settings.oidc"),
    getTranslations("settings.smtp"),
    oidcView(ctx),
    smtpView(ctx),
    llmFallbackView(ctx),
  ]);

  // Formatted here, in the user's zone and language, so the card renders the same string on the
  // server and in the browser (the design's "last check 07:10").
  const time = new Intl.DateTimeFormat(ctx.locale, { timeStyle: "short", timeZone: ctx.timeZone });
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
    </SettingsGrid>
  );
}
