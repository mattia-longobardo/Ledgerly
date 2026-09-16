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
import {
  connectWalletAction,
  disconnectWalletAction,
  syncWalletNowAction,
  testWalletAction,
} from "./actions";

/**
 * What the card says the link is, including the state the database has no row for. The names are
 * the `settings.integrations.states.*` keys, so the label is a lookup rather than a branch.
 */
export type WalletCardState = "absent" | "active" | "error" | "revoked";

/**
 * Everything the browser is told about the link. **No token, and no field one could travel in**
 * (spec §9.4): once saved, a credential never comes back — the form below only ever replaces it.
 * `lastSync` arrives formatted, because the page owns the locale and the time zone.
 */
export interface WalletCardProps {
  state: WalletCardState;
  lastSync: string | null;
}

const DOT: Record<WalletCardState, string> = {
  absent: "bg-faint",
  active: "bg-pos",
  error: "bg-neg",
  revoked: "bg-faint",
};

const STATUS_TONE: Record<WalletCardState, Tone> = {
  absent: "muted",
  active: "pos",
  error: "neg",
  revoked: "muted",
};

const FORM_ID = "wallet-token-form";

/**
 * Settings › Integrations, the Budget Makers Wallet card of spec §9.1: state, last sync, schedule,
 * and the four things a user can do with the link — paste a token, prove it works, sync now
 * (spec §10.3), disconnect.
 *
 * The token field is the whole point of the design here. It has no `value` and no `defaultValue`,
 * it is read once out of the submitted `FormData` into a local binding, and the dialog it lives in
 * unmounts on close — so the secret is never in React state, never in a prop and never in the DOM
 * a moment longer than the dialog is open.
 */
export function WalletCard({ state, lastSync }: WalletCardProps) {
  const t = useTranslations("settings.integrations");
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const connected = state !== "absent";

  /** An action's refusal code, spelled out one branch at a time so the catalogue keys stay literal. */
  function messageFor(code: string): string {
    if (code === "rejected") return t("errors.rejected");
    if (code === "unreachable") return t("errors.unreachable");
    if (code === "empty") return t("errors.empty");
    if (code === "notConnected") return t("errors.notConnected");
    return t("errors.failed");
  }

  /** Runs one action, reporting a refusal in place and announcing a success as a toast. */
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
    // Read, trimmed by the action, and dropped when this handler returns: the token is not kept
    // anywhere this component can render it.
    const token = String(new FormData(event.currentTarget).get("token") ?? "");
    run(() => connectWalletAction(token), connected ? t("toasts.replaced") : t("toasts.connected"));
  }

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3.5">
        <div className="min-w-0 flex-1 basis-56">
          <div className="flex items-center gap-2">
            <span aria-hidden className={cn("size-[7px] shrink-0 rounded-full", DOT[state])} />
            <span className="min-w-0 truncate font-semibold">{t("providers.wallet.name")}</span>
            <span className={cn("text-sm font-medium whitespace-nowrap", TONE_TEXT[STATUS_TONE[state]])}>
              {t(`states.${state}`)}
            </span>
          </div>
          <p className="mt-0.5 text-sm text-muted">{t("providers.wallet.role")}</p>
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
                run(syncWalletNowAction, t("toasts.synced"));
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
              label={t("providers.wallet.name")}
              items={[
                {
                  label: t("actions.test"),
                  onSelect: () => {
                    setError(null);
                    run(testWalletAction, t("toasts.tested"));
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

      {/* The first pass fetches a year (spec §9.1), which is worth saying before it is asked for
          and while it has not happened yet. */}
      {lastSync === null && (
        <p className="border-t border-border px-4 py-2.5 text-sm text-muted">{t("firstSync")}</p>
      )}

      {error && !connecting && !disconnecting && (
        <p role="alert" className="border-t border-border px-4 py-2.5 text-sm text-neg">
          {error}
        </p>
      )}

      <Modal
        open={connecting}
        onOpenChange={(open) => !open && setConnecting(false)}
        title={t("connect.title")}
        description={t("connect.description")}
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
        {/* Mounted with the dialog and unmounted with it, so closing the dialog is also what
            discards the pasted secret. */}
        {connecting && (
          <form id={FORM_ID} onSubmit={onSubmit} className="flex flex-col gap-3">
            {error && (
              <p role="alert" className="text-sm text-neg">
                {error}
              </p>
            )}
            <Field label={t("connect.token")} htmlFor="wallet-token" hint={t("connect.tokenHint")}>
              <Input
                id="wallet-token"
                name="token"
                type="password"
                className="font-mono"
                autoComplete="off"
                spellCheck={false}
                required
                autoFocus
              />
            </Field>
          </form>
        )}
      </Modal>

      <Modal
        open={disconnecting}
        onOpenChange={(open) => !open && setDisconnecting(false)}
        title={t("disconnect.title")}
        description={t("disconnect.description")}
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
              onClick={() => run(disconnectWalletAction, t("toasts.disconnected"))}
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
