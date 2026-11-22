import type { Metadata } from "next";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { fetchConsent } from "@/platform/auth/remote";
import { requireSession } from "@/platform/auth/session";
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
  // The signature and the client's row are the server's (`/api/web/consent`, rewrite plan R4).
  const view = await fetchConsent(signed, await headers());
  if (!view) {
    return (
      <AuthCard title={t("title")} description={t("invalid")}>
        {null}
      </AuthCard>
    );
  }

  return (
    <AuthCard title={t("title")} description={t("description", { client: view.clientName })}>
      <ConsentForm
        oauthQuery={signed}
        scopes={view.scopes}
        offline={view.offline}
        hosts={view.hosts}
        verified={view.verified}
      />
    </AuthCard>
  );
}
