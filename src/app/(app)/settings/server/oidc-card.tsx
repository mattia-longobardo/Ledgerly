"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, useId, useState, useTransition } from "react";
import type { OidcProbeOutcome } from "@/platform/settings/oidc-probe";
import { Button } from "@/ui/button";
import { Field } from "@/ui/field";
import { Input } from "@/ui/input";
import { notify } from "@/ui/toast";
import { removeOidcAction, saveOidcAction, testOidcAction } from "./actions";

export interface OidcCardProps {
  issuer: string;
  clientId: string;
  adminGroup: string;
  secretHint: string;
  /** false while the values still come from `.env.homelab` (plan F8 §3.4.3). */
  saved: boolean;
  /** The recorded verdict of the last "Test connection", already formatted for this user. */
  lastCheck: { outcome: OidcProbeOutcome; time: string } | null;
  /**
   * The issuer's origin when it is *not* the one in the environment file. The CSP is written by
   * the proxy, which runs on the edge runtime and cannot read the database, so `form-action` still
   * names the environment's origin: an issuer moved to another host needs `OIDC_DISCOVERY_URL`
   * moved with it. Saying so here is cheaper than a broken sign-in nobody can explain.
   */
  foreignOrigin: string | null;
}

/** Admin › Server › Authentik (spec §5.1, design row 884). */
export function OidcCard({
  issuer,
  clientId,
  adminGroup,
  secretHint,
  saved,
  lastCheck,
  foreignOrigin,
}: OidcCardProps) {
  const t = useTranslations("settings.oidc");
  const id = useId();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    startTransition(async () => {
      const result = await saveOidcAction({
        issuer: String(data.get("issuer") ?? ""),
        clientId: String(data.get("clientId") ?? ""),
        clientSecret: String(data.get("clientSecret") ?? ""),
        adminGroup: String(data.get("adminGroup") ?? ""),
      });
      if (!result.ok) {
        setError(t(`errors.${result.error}`));
        return;
      }
      setError(null);
      (form.elements.namedItem("clientSecret") as HTMLInputElement).value = "";
      notify(result.signedEveryoneOut ? t("savedSignedOut") : t("saved"));
      // A changed issuer took this session with it: the refresh lands on /sign-in, which is
      // exactly what the card warned would happen.
      router.refresh();
    });
  }

  function onTest() {
    setTesting(true);
    startTransition(async () => {
      await testOidcAction();
      setTesting(false);
      router.refresh();
    });
  }

  function onRemove() {
    startTransition(async () => {
      await removeOidcAction();
      notify(t("removed"));
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5" noValidate>
      {!saved && (
        <p className="text-sm text-muted" data-testid="oidc-source">
          {t("fromEnv")}
        </p>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-x-4">
        <div className="sm:col-span-2">
          <Field label={t("issuer")} htmlFor={`${id}-issuer`} hint={t("issuerHint")}>
            <Input
              id={`${id}-issuer`}
              name="issuer"
              type="url"
              defaultValue={issuer}
              autoComplete="off"
              required
            />
          </Field>
        </div>
        <Field label={t("clientId")} htmlFor={`${id}-client`}>
          <Input id={`${id}-client`} name="clientId" defaultValue={clientId} autoComplete="off" required />
        </Field>
        <Field
          label={t("clientSecret")}
          htmlFor={`${id}-secret`}
          hint={secretHint ? t("clientSecretKeep") : undefined}
        >
          <Input
            id={`${id}-secret`}
            name="clientSecret"
            type="password"
            autoComplete="off"
            placeholder={secretHint ? `•••• ${secretHint}` : undefined}
          />
        </Field>
        <div className="sm:col-span-2">
          <Field label={t("adminGroup")} htmlFor={`${id}-group`} hint={t("adminGroupHint")}>
            <Input
              id={`${id}-group`}
              name="adminGroup"
              defaultValue={adminGroup}
              autoComplete="off"
              required
            />
          </Field>
        </div>
      </div>
      {foreignOrigin && (
        <p className="text-sm text-warn" data-testid="oidc-origin-warning">
          {t("originWarning", { origin: foreignOrigin })}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-neg">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        <p
          className={
            lastCheck?.outcome === "ok" ? "text-sm font-medium text-pos" : "text-sm font-medium text-muted"
          }
          data-testid="oidc-status"
        >
          {lastCheck
            ? `${t(`test.${lastCheck.outcome}`)} · ${t("lastCheck", { time: lastCheck.time })}`
            : t("notChecked")}
        </p>
        <div className="flex gap-2">
          {saved && (
            <Button variant="danger" size="sm" onClick={onRemove} disabled={pending}>
              {t("remove")}
            </Button>
          )}
          <Button size="sm" onClick={onTest} disabled={pending}>
            {testing ? t("test.running") : t("test.action")}
          </Button>
          <Button type="submit" size="sm" variant="primary" disabled={pending}>
            {t("save")}
          </Button>
        </div>
      </div>
    </form>
  );
}
