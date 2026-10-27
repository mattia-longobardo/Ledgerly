import { verifyOAuthQueryParams } from "@better-auth/oauth-provider";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { API_SCOPES, type ApiScope } from "@/platform/auth/oauth";
import { consentClient } from "@/platform/auth/oauth-grants";
import { requireSession } from "@/platform/auth/session";
import { readEnv } from "@/platform/env";
import { AuthCard } from "../../auth-card";
import { ConsentForm } from "./consent-form";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("auth.consent"))("title") };
}

/**
 * The consent screen of the OAuth authorize flow (docs/auth-design.md D3): a client asks, the
 * signed-in person says yes or no. Only a query the authorize endpoint signed is shown — anything
 * else is a link someone made up, and gets the "invalid request" card instead of a form.
 */
export default async function ConsentPage({ searchParams }: PageProps<"/oauth/consent">) {
  await requireSession();
  const t = await getTranslations("auth.consent");
  const params = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    for (const one of Array.isArray(value) ? value : value === undefined ? [] : [value])
      query.append(key, one);
  }
  const signed = query.toString();
  const clientId = query.get("client_id");
  const valid = clientId !== null && (await verifyOAuthQueryParams(signed, readEnv().BETTER_AUTH_SECRET));
  if (!valid) {
    return (
      <AuthCard title={t("title")} description={t("invalid")}>
        {null}
      </AuthCard>
    );
  }

  // Read from the table, not the public endpoint: the screen has to say where the code goes and
  // whether anyone vouches for the client (PERS-49 SEC-01).
  const client = await consentClient(clientId);
  if (!client) {
    return (
      <AuthCard title={t("title")} description={t("invalid")}>
        {null}
      </AuthCard>
    );
  }

  const requested = (query.get("scope") ?? "").split(" ").filter(Boolean);
  const scopes = API_SCOPES.filter((scope): scope is ApiScope => requested.includes(scope));
  const offline = requested.includes("offline_access");

  return (
    <AuthCard title={t("title")} description={t("description", { client: client.name ?? clientId })}>
      <ConsentForm
        oauthQuery={signed}
        scopes={scopes}
        offline={offline}
        hosts={client.hosts}
        verified={client.verified}
      />
    </AuthCard>
  );
}
