"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, type ReactNode, useState, useTransition } from "react";
import { Button } from "@/ui/button";
import { Field } from "@/ui/field";
import { Input } from "@/ui/input";
import { ActionMenu } from "@/ui/menu";
import { Modal } from "@/ui/modal";
import { notify } from "@/ui/toast";
import {
  connectPaperlessAction,
  disconnectPaperlessAction,
  syncPaperlessNowAction,
  testPaperlessAction,
} from "./actions";
import { ConnectionRow, type ConnectionState } from "./connection-row";

/** The same four states the Wallet card has; the names are the `states.*` catalogue keys. */
export type PaperlessCardState = ConnectionState;

/**
 * Everything the browser is told about the Paperless link. **No token and no URL**: both live in
 * the sealed credential column (spec §9.4), like Trek's. Replacing the link means stating them
 * again.
 */
export interface PaperlessCardProps {
  state: PaperlessCardState;
  lastSync: string | null;
  /** The connection's own sync schedule control (D7); the fixed label when there is no link. */
  schedule?: ReactNode;
}

const FORM_ID = "paperless-token-form";

/**
 * Settings › Integrations, the Paperless card (docs/auth-design.md D5): Ledgerly reads the payslips
 * (and, if named, the Cometa documents) that Paperless has filed, with the token of a read-only
 * Paperless user, at the time the person chose (D7). The token field follows the Trek card's rule:
 * no value, read once out of `FormData`, in a dialog that unmounts on close.
 */
export function PaperlessCard({ state, lastSync, schedule }: PaperlessCardProps) {
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
    if (code === "types") return t("paperless.typesMissing");
    if (code === "notAllowed") return t("errors.notAllowed");
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
    const input = {
      baseUrl: String(form.get("baseUrl") ?? ""),
      token: String(form.get("token") ?? ""),
      payslipType: String(form.get("payslipType") ?? ""),
      cometaOperationsType: String(form.get("cometaOperationsType") ?? ""),
      cometaPositionType: String(form.get("cometaPositionType") ?? ""),
    };
    run(() => connectPaperlessAction(input), connected ? t("toasts.replaced") : t("toasts.connected"));
  }

  return (
    <div className="flex flex-col">
      <ConnectionRow
        name={t("providers.paperless.name")}
        role={t("providers.paperless.role")}
        state={state}
        lastSync={lastSync}
        schedule={schedule}
        actions={
          <>
            {connected && (
              <Button
                size="sm"
                disabled={pending}
                onClick={() => {
                  setError(null);
                  run(syncPaperlessNowAction, t("toasts.synced"));
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
                label={t("providers.paperless.name")}
                items={[
                  {
                    label: t("actions.test"),
                    onSelect: () => {
                      setError(null);
                      run(testPaperlessAction, t("toasts.tested"));
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
          </>
        }
      />

      {!connected && (
        <p className="border-t border-border px-4 py-2.5 text-sm text-muted">{t("paperless.notLinked")}</p>
      )}

      {error && !connecting && !disconnecting && (
        <p role="alert" className="border-t border-border px-4 py-2.5 text-sm text-neg">
          {error}
        </p>
      )}

      <Modal
        open={connecting}
        onOpenChange={(open) => !open && setConnecting(false)}
        title={t("paperless.connectTitle")}
        description={t("paperless.connectDescription")}
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
            <Field label={t("paperless.baseUrl")} htmlFor="paperless-url" hint={t("paperless.baseUrlHint")}>
              <Input
                id="paperless-url"
                name="baseUrl"
                type="url"
                inputMode="url"
                defaultValue="http://paperless-ngx:8000"
                autoComplete="off"
                spellCheck={false}
                required
                autoFocus
              />
            </Field>
            <Field label={t("paperless.token")} htmlFor="paperless-token" hint={t("paperless.tokenHint")}>
              <Input
                id="paperless-token"
                name="token"
                type="password"
                className="font-mono"
                autoComplete="off"
                spellCheck={false}
                required
              />
            </Field>
            <Field
              label={t("paperless.payslipType")}
              htmlFor="paperless-payslip"
              hint={t("paperless.payslipTypeHint")}
            >
              <Input
                id="paperless-payslip"
                name="payslipType"
                defaultValue="Payroll"
                autoComplete="off"
                required
              />
            </Field>
            <Field
              label={t("paperless.cometaOperationsType")}
              htmlFor="paperless-cometa-ops"
              hint={t("paperless.optionalHint")}
            >
              <Input id="paperless-cometa-ops" name="cometaOperationsType" autoComplete="off" />
            </Field>
            <Field
              label={t("paperless.cometaPositionType")}
              htmlFor="paperless-cometa-pos"
              hint={t("paperless.optionalHint")}
            >
              <Input id="paperless-cometa-pos" name="cometaPositionType" autoComplete="off" />
            </Field>
          </form>
        )}
      </Modal>

      <Modal
        open={disconnecting}
        onOpenChange={(open) => !open && setDisconnecting(false)}
        title={t("disconnect.title")}
        description={t("paperless.disconnectDescription")}
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
              onClick={() => run(disconnectPaperlessAction, t("toasts.disconnected"))}
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
