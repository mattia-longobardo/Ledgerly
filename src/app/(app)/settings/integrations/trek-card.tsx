"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useState, useTransition } from "react";
import { Button } from "@/ui/button";
import { cn } from "@/ui/cn";
import { Field } from "@/ui/field";
import { Input } from "@/ui/input";
import { ActionMenu } from "@/ui/menu";
import { Modal } from "@/ui/modal";
import { notify } from "@/ui/toast";
import { TONE_TEXT, type Tone } from "@/ui/tone";
import { connectTrekAction, disconnectTrekAction, syncTrekNowAction, testTrekAction } from "./actions";

/** The same four states the Wallet card has; the names are the `states.*` catalogue keys. */
export type TrekCardState = "absent" | "active" | "error" | "revoked";

/**
 * Everything the browser is told about the Trek link. **No token and no URL**: both live in the
 * sealed credential column, which only `readCredentials` opens and only inside a Server Action
 * (spec §9.4), so neither this component nor the page that renders it can leak one. Replacing the
 * link means stating both again, which is the honest cost of never sending them to the browser.
 */
export interface TrekCardProps {
  state: TrekCardState;
  lastSync: string | null;
  /** Days still waiting to reach Trek: the one number that says the two calendars disagree. */
  pending: number;
}

const DOT: Record<TrekCardState, string> = {
  absent: "bg-faint",
  active: "bg-pos",
  error: "bg-neg",
  revoked: "bg-faint",
};

const STATUS_TONE: Record<TrekCardState, Tone> = {
  absent: "muted",
  active: "pos",
  error: "neg",
  revoked: "muted",
};

const FORM_ID = "trek-token-form";

/**
 * Settings › Integrations, the Trek card of spec §9.2: state, last pass, schedule, and the four
 * things a user can do with the link — paste a URL and a token, prove they work, sync now, unlink.
 *
 * The credential is a **machine client** (OAuth 2.1, `client_credentials`): Trek's static tokens
 * are deprecated and its own instance already refuses them. The secret field carries no `value`
 * and no `defaultValue`, is read once out of the submitted `FormData`, and lives in a dialog that
 * unmounts on close: it is never in React state, never in a prop, and never in the DOM a moment
 * longer than the dialog is open.
 */
export function TrekCard({ state, lastSync, pending: waiting }: TrekCardProps) {
  const t = useTranslations("settings.integrations");
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const connected = state !== "absent";

  function messageFor(code: string): string {
    if (code === "rejected") return t("errors.rejected");
    if (code === "unreachable") return t("errors.unreachable");
    if (code === "empty") return t("errors.empty");
    if (code === "notConnected") return t("errors.notConnected");
    if (code === "busy") return t("errors.busy");
    if (code === "provider") return t("errors.provider");
    return t("errors.failed");
  }

  function run(work: () => Promise<{ ok: true } | { ok: false; error: string }>, success: string) {
    startTransition(async () => {
      try {
        const result = await work();
        if (!result.ok) {
          setError(messageFor(result.error));
          return;
        }
        setError(null);
        setConnecting(false);
        setDisconnecting(false);
        notify(success);
      } catch {
        setError(t("errors.failed"));
      }
    });
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Read, trimmed by the action, and dropped when this handler returns.
    const form = new FormData(event.currentTarget);
    const url = String(form.get("baseUrl") ?? "");
    const clientId = String(form.get("clientId") ?? "");
    const clientSecret = String(form.get("clientSecret") ?? "");
    run(
      () => connectTrekAction(url, clientId, clientSecret),
      connected ? t("toasts.replaced") : t("toasts.connected"),
    );
  }

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3.5">
        <div className="min-w-0 flex-1 basis-56">
          <div className="flex items-center gap-2">
            <span aria-hidden className={cn("size-[7px] shrink-0 rounded-full", DOT[state])} />
            <span className="min-w-0 truncate font-semibold">{t("providers.trek.name")}</span>
            <span className={cn("text-sm font-medium whitespace-nowrap", TONE_TEXT[STATUS_TONE[state]])}>
              {t(`states.${state}`)}
            </span>
          </div>
          <p className="mt-0.5 text-sm text-muted">{t("providers.trek.role")}</p>
        </div>

        <div className="text-sm">
          <div className="text-muted">{t("fields.lastSync")}</div>
          <div className="mt-0.5 font-medium whitespace-nowrap">{lastSync ?? t("fields.never")}</div>
        </div>

        <div className="text-sm">
          <div className="text-muted">{t("fields.schedule")}</div>
          <div className="mt-0.5 font-medium whitespace-nowrap">{t("schedule")}</div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {connected && (
            <Button
              size="sm"
              disabled={pending}
              onClick={() => {
                setError(null);
                run(syncTrekNowAction, t("toasts.synced"));
              }}
            >
              {t("actions.sync")}
            </Button>
          )}
          <Button
            size="sm"
            variant={connected ? "secondary" : "primary"}
            disabled={pending}
            onClick={() => {
              setError(null);
              setConnecting(true);
            }}
          >
            {t("actions.configure")}
          </Button>
          {connected && (
            <ActionMenu
              label={t("providers.trek.name")}
              items={[
                {
                  label: t("actions.test"),
                  onSelect: () => {
                    setError(null);
                    run(testTrekAction, t("toasts.tested"));
                  },
                },
                {
                  label: t("actions.disconnect"),
                  onSelect: () => {
                    setError(null);
                    setDisconnecting(true);
                  },
                  danger: true,
                },
              ]}
            />
          )}
        </div>
      </div>

      {/* The one number worth showing on this card: days the app holds that Trek has not been
          told about yet. Zero is the normal state and says nothing, so it is not shown. */}
      {connected && waiting > 0 && (
        <p className="border-t border-border px-4 py-2.5 text-sm text-muted">
          {t("trek.pending", { count: waiting })}
        </p>
      )}

      {!connected && (
        <p className="border-t border-border px-4 py-2.5 text-sm text-muted">{t("trek.notLinked")}</p>
      )}

      {error && !connecting && !disconnecting && (
        <p role="alert" className="border-t border-border px-4 py-2.5 text-sm text-neg">
          {error}
        </p>
      )}

      <Modal
        open={connecting}
        onOpenChange={(open) => !open && setConnecting(false)}
        title={t("trek.connectTitle")}
        description={t("trek.connectDescription")}
        width={460}
        footer={
          <>
            <Button size="sm" onClick={() => setConnecting(false)}>
              {t("connect.cancel")}
            </Button>
            <Button type="submit" form={FORM_ID} variant="primary" size="sm" disabled={pending}>
              {connected ? t("connect.replace") : t("connect.submit")}
            </Button>
          </>
        }
      >
        {/* Mounted with the dialog and unmounted with it, so closing it discards the pasted token. */}
        {connecting && (
          <form id={FORM_ID} onSubmit={onSubmit} className="flex flex-col gap-3">
            {error && (
              <p role="alert" className="text-sm text-neg">
                {error}
              </p>
            )}
            <Field label={t("trek.baseUrl")} htmlFor="trek-url" hint={t("trek.baseUrlHint")}>
              <Input
                id="trek-url"
                name="baseUrl"
                type="url"
                inputMode="url"
                placeholder="https://trek.example.com"
                autoComplete="off"
                spellCheck={false}
                required
                autoFocus
              />
            </Field>
            <Field label={t("trek.clientId")} htmlFor="trek-client-id" hint={t("trek.clientIdHint")}>
              <Input
                id="trek-client-id"
                name="clientId"
                className="font-mono"
                autoComplete="off"
                spellCheck={false}
                required
              />
            </Field>
            <Field
              label={t("trek.clientSecret")}
              htmlFor="trek-client-secret"
              hint={t("trek.clientSecretHint")}
            >
              <Input
                id="trek-client-secret"
                name="clientSecret"
                type="password"
                className="font-mono"
                autoComplete="off"
                spellCheck={false}
                required
              />
            </Field>
          </form>
        )}
      </Modal>

      <Modal
        open={disconnecting}
        onOpenChange={(open) => !open && setDisconnecting(false)}
        title={t("disconnect.title")}
        description={t("trek.disconnectDescription")}
        width={420}
        footer={
          <>
            <Button size="sm" onClick={() => setDisconnecting(false)}>
              {t("disconnect.cancel")}
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={pending}
              onClick={() => run(disconnectTrekAction, t("toasts.disconnected"))}
            >
              {t("disconnect.confirm")}
            </Button>
          </>
        }
      >
        {error ? (
          <p role="alert" className="text-sm text-neg">
            {error}
          </p>
        ) : (
          <span />
        )}
      </Modal>
    </div>
  );
}
