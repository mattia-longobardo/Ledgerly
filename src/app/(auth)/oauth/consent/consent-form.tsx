"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import type { ApiScope } from "@/platform/auth/oauth";
import { Button } from "@/ui/button";

/**
 * Allow or deny. The answer goes to Better Auth's `/oauth2/consent` with the signed query, and the
 * browser follows the redirect it returns — back to the client, with a code or with `access_denied`.
 */
export function ConsentForm({
  oauthQuery,
  scopes,
  offline,
}: {
  oauthQuery: string;
  scopes: ApiScope[];
  offline: boolean;
}) {
  const t = useTranslations("auth.consent");
  const scopeHint = useTranslations("settings.tokens.scopeHints");
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function answer(accept: boolean) {
    setPending(true);
    setFailed(false);
    try {
      const response = await fetch("/api/auth/oauth2/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accept, oauth_query: oauthQuery }),
      });
      const body = (await response.json()) as { url?: string };
      if (!response.ok || typeof body.url !== "string") throw new Error("consent failed");
      window.location.assign(body.url);
    } catch {
      setFailed(true);
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {failed && (
        <p role="alert" className="rounded-lg bg-neg-bg px-3 py-2 text-sm text-neg">
          {t("failed")}
        </p>
      )}
      <div>
        <p className="text-sm font-medium">{t("scopes")}</p>
        <ul className="mt-1.5 flex list-disc flex-col gap-1 pl-5 text-sm text-muted">
          {scopes.map((scope) => (
            <li key={scope}>
              <span className="font-medium text-fg">{scope}</span> — {scopeHint(scope)}
            </li>
          ))}
          {offline && <li>{t("offline")}</li>}
          {scopes.length === 0 && !offline && <li>{t("identity")}</li>}
        </ul>
      </div>
      <div className="flex gap-2">
        <Button variant="primary" className="flex-1" disabled={pending} onClick={() => answer(true)}>
          {t("allow")}
        </Button>
        <Button className="flex-1" disabled={pending} onClick={() => answer(false)}>
          {t("deny")}
        </Button>
      </div>
    </div>
  );
}
