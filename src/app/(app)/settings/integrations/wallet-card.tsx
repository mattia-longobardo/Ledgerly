"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useState, useTransition } from "react";
import { Button } from "@/ui/button";
import { Field } from "@/ui/field";
import { Checkbox, Input } from "@/ui/input";
import { Modal } from "@/ui/modal";
import { notify } from "@/ui/toast";
import {
  chooseWalletAccountsAction,
  connectWalletAction,
  disconnectWalletAction,
  type WalletAccountRow,
  walletAccountsAction,
} from "./actions";
import { type ActionKind, ConnectionRow, type ConnectionRowProps, DeactivateLink } from "./connection-row";

/**
 * Everything the browser is told about the link. **No token, and no field one could travel in**
 * (spec §9.4): once saved, a credential never comes back — the form below only ever replaces it.
 * The row arrives built by the page, which owns the locale, the zone and the state.
 */
export interface WalletCardProps {
  row: ConnectionRowProps;
  connected: boolean;
  /** What "Disconnect" leaves: the accounts of Wallet here, and the ones left out. */
  leave: { accounts: number; excluded: number };
  /** The source's page, where it is turned off (plugin-settings.md §4.2). */
  deactivateHref: string;
}

/** What this card does itself, with a dialog of its own; the rest is the row's. */
const HANDLED: readonly ActionKind[] = ["connect", "replaceKey", "disconnect"];

const FORM_ID = "wallet-token-form";

/**
 * Settings › Integrations, the Budget Makers Wallet card of spec §9.1: the row every connection
 * has (ux/n2-connection-status.md §3) and the two dialogs that are this provider's own — paste a
 * token, disconnect.
 *
 * The token field is the whole point of the design here. It has no `value` and no `defaultValue`,
 * it is read once out of the submitted `FormData` into a local binding, and the dialog it lives in
 * unmounts on close — so the secret is never in React state, never in a prop and never in the DOM
 * a moment longer than the dialog is open.
 */
export function WalletCard({ row, connected, leave, deactivateHref }: WalletCardProps) {
  const t = useTranslations("settings.integrations");
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /** An action's refusal code, spelled out one branch at a time so the catalogue keys stay literal. */
  function messageFor(code: string): string {
    if (code === "rejected") return t("errors.rejected");
    if (code === "unreachable") return t("errors.unreachable");
    if (code === "empty") return t("errors.empty");
    if (code === "notConnected") return t("errors.notConnected");
    if (code === "busy") return t("errors.busy");
    if (code === "provider") return t("errors.provider");
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
      <ConnectionRow
        {...row}
        handled={HANDLED}
        disabled={pending}
        onAction={(kind) => {
          setError(null);
          if (kind === "disconnect") setDisconnecting(true);
          else setConnecting(true);
        }}
      />

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
        title={t("disconnect.title", { name: row.name })}
        description={[
          t("disconnect.description", { name: row.name, count: leave.accounts }),
          leave.excluded > 0 ? t("disconnect.excluded", { count: leave.excluded }) : "",
        ]
          .filter(Boolean)
          .join(" ")}
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
        <div className="flex flex-col gap-2 text-sm">
          {error && (
            <p role="alert" className="text-neg">
              {error}
            </p>
          )}
          <DeactivateLink href={deactivateHref} provider={row.name} />
        </div>
      </Modal>
    </div>
  );
}

/**
 * "Accounts" on the source's page (plugin-settings.md §2.2): which accounts of Wallet come into
 * Ledgerly. The list is Wallet's own, read when the person asks for it: the page never calls the
 * source by itself.
 */
export function WalletAccounts() {
  const t = useTranslations("settings.integrations");
  const plugin = useTranslations("settings.plugin");
  const [choosing, setChoosing] = useState(false);
  const [choices, setChoices] = useState<WalletAccountRow[] | null>(null);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function messageFor(code: string): string {
    if (code === "rejected") return t("errors.rejected");
    if (code === "unreachable") return t("errors.unreachable");
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
        setChoosing(false);
        notify(success);
      } catch {
        setError(t("errors.failed"));
      }
    });
  }

  function openChoice() {
    setChoosing(true);
    setChoices(null);
    startTransition(async () => {
      try {
        const result = await walletAccountsAction();
        if (!result.ok) {
          setError(messageFor(result.error));
          return;
        }
        setChoices(result.accounts);
        setPicked(new Set(result.accounts.filter((one) => one.chosen).map((one) => one.externalId)));
      } catch {
        setError(t("errors.failed"));
      }
    });
  }

  function toggle(externalId: string, on: boolean) {
    setPicked((before) => {
      const next = new Set(before);
      if (on) next.add(externalId);
      else next.delete(externalId);
      return next;
    });
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
      <p className="text-sm text-muted">{plugin("accounts.chooseHint")}</p>
      <Button size="sm" disabled={pending} onClick={openChoice}>
        {plugin("accounts.choose")}
      </Button>
      <Modal
        open={choosing}
        onOpenChange={(open) => !open && setChoosing(false)}
        title={t("choose.title")}
        description={t("choose.description")}
        width={460}
        footer={
          <>
            <Button size="sm" onClick={() => setChoosing(false)}>
              {t("choose.cancel")}
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={pending || choices === null}
              onClick={() => run(() => chooseWalletAccountsAction([...picked]), t("toasts.chosen"))}
            >
              {t("choose.save")}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-2">
          {error && (
            <p role="alert" className="text-sm text-neg">
              {error}
            </p>
          )}
          {choices === null && !error && <p className="text-sm text-muted">{t("choose.loading")}</p>}
          {choices !== null && choices.length === 0 && (
            <p className="text-sm text-muted">{t("choose.none")}</p>
          )}
          {choices?.map((one) => (
            <div key={one.externalId} className="flex flex-col">
              <Checkbox
                label={one.name}
                checked={one.here !== null || picked.has(one.externalId)}
                disabled={one.here !== null || pending}
                onChange={(event) => toggle(one.externalId, event.target.checked)}
              />
              <span className="pl-5 text-sm text-muted">
                {one.here !== null ? t("choose.here", { account: one.here }) : t("choose.notHere")}
              </span>
            </div>
          ))}
        </div>
      </Modal>
    </div>
  );
}
