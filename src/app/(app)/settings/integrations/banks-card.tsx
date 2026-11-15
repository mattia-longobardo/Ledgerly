"use client";

import type { Route } from "next";
import { useTranslations } from "next-intl";
import { type FormEvent, useEffect, useState, useTransition } from "react";
import { NULL_DISPLAY } from "@/platform/format";
import { Button, ButtonLink, LinkButton } from "@/ui/button";
import { Field } from "@/ui/field";
import { Input, Textarea } from "@/ui/input";
import { ActionMenu } from "@/ui/menu";
import { Modal } from "@/ui/modal";
import { notify } from "@/ui/toast";
import type { Tone } from "@/ui/tone";
import { ConnectionRow } from "./connection-row";
import {
  disconnectBankAction,
  type PluginActionResult,
  removeBankCredentialsAction,
  saveBankCredentialsAction,
} from "./plugin-actions";

/** A bank's connection as its row says it (§5.1). `pending` joins with the choice of the accounts. */
export type BankRowState = "active" | "error" | "expired";

/**
 * Everything the browser is told about the section (ux/n1-plugin-bank.md §3.1). **Never a value of
 * the credentials** (§1.3): that they are saved, since when, and whether the provider refuses them.
 */
export interface BanksCardProps {
  pluginId: string;
  credentials: { saved: boolean; savedAt: string | null; invalid: boolean };
  returnAddress: string;
  banks: {
    id: string;
    name: string;
    state: BankRowState;
    accounts: number;
    lastSync: string | null;
    validUntil: string | null;
  }[];
  /** Opens "Replace key" at once: where the procedure sends a person whose key was refused. */
  openReplace: boolean;
}

const FORM_ID = "bank-credentials-form";
const CONNECT: Route = "/banks/connect";

const STATUS: Record<BankRowState, { tone: Tone; dot: string }> = {
  active: { tone: "pos", dot: "bg-pos" },
  error: { tone: "neg", dot: "bg-neg" },
  expired: { tone: "neg", dot: "bg-neg" },
};

/**
 * Settings › Integrations, the section "Banks" (§3-§5): the guide to the person's own application
 * while there are no credentials, then the credentials' row and one row per bank.
 *
 * The two secret fields have no `value` and no `defaultValue`; they are read once from the
 * submitted form and the form unmounts with its dialog, so a secret is never in React state, never
 * in a prop, and in the DOM only while the dialog is open.
 */
export function BanksCard({ pluginId, credentials, returnAddress, banks, openReplace }: BanksCardProps) {
  const t = useTranslations("settings.banks");
  const common = useTranslations("common");
  const [dialog, setDialog] = useState<"new" | "replace" | "remove" | null>(
    openReplace && credentials.saved ? "replace" : null,
  );
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();
  const [formKey, setFormKey] = useState(0);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const replacing = dialog === "replace";
  const leaving = banks.find((bank) => bank.id === disconnecting) ?? null;

  /** A refusal's code as its sentence, one branch at a time so the catalogue keys stay literal. */
  function messageFor(code: string): string {
    if (code === "missing") return t("errors.missing");
    if (code === "key_format") return t("errors.keyFormat");
    if (code === "credentials_invalid") return t("errors.credentialsInvalid");
    if (code === "write_not_allowed") return t("errors.writeNotAllowed");
    if (code === "unreachable") return t("errors.unreachable");
    if (code === "plugin_down") return t("errors.pluginDown");
    return t("errors.failed");
  }

  function run(work: () => Promise<PluginActionResult>, success: string, onRefusal?: () => void) {
    startTransition(async () => {
      let result: PluginActionResult;
      try {
        result = await work();
      } catch {
        result = { ok: false, error: "failed" };
      }
      if (!result.ok) {
        setError(messageFor(result.error));
        onRefusal?.();
        return;
      }
      setError(null);
      setDialog(null);
      setDisconnecting(null);
      notify(success);
    });
  }

  function open(next: "new" | "replace" | "remove") {
    setError(null);
    setDialog(next);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Read once and handed to the action: nothing typed here is kept where it can be drawn again.
    const form = new FormData(event.currentTarget);
    run(
      () => saveBankCredentialsAction(pluginId, form),
      replacing ? t("toasts.replaced") : t("toasts.saved"),
      // After a refusal the fields come back empty (§4.1): a new form, whose first field takes
      // the focus as it mounts.
      () => setFormKey((key) => key + 1),
    );
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(returnAddress);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const credentialsDialog = (
    <Modal
      open={dialog === "new" || dialog === "replace"}
      onOpenChange={(isOpen) => !isOpen && setDialog(null)}
      title={replacing ? t("replace.title") : t("credentials.title")}
      description={replacing ? t("replace.description") : t("credentials.description")}
      width={520}
      footer={
        <>
          <Button size="sm" disabled={pending} onClick={() => setDialog(null)}>
            {common("cancel")}
          </Button>
          <Button type="submit" form={FORM_ID} variant="primary" size="sm" disabled={pending}>
            {pending ? t("credentials.checking") : replacing ? t("replace.submit") : t("credentials.submit")}
          </Button>
        </>
      }
    >
      {(dialog === "new" || dialog === "replace") && (
        <form key={formKey} id={FORM_ID} onSubmit={onSubmit} className="flex flex-col gap-3">
          {error && (
            <p role="alert" className="text-sm text-neg">
              {error} {replacing && t("replace.unchanged")}
            </p>
          )}
          <Field
            label={t("credentials.appId")}
            htmlFor="bank-app-id"
            hint={replacing ? t("credentials.appIdKeep") : t("credentials.appIdHint")}
          >
            <Input
              id="bank-app-id"
              name="applicationId"
              type="password"
              className="font-mono"
              autoComplete="off"
              spellCheck={false}
              data-1p-ignore
              data-lpignore="true"
              required={!replacing}
              disabled={pending}
              autoFocus
            />
          </Field>
          <Field label={t("credentials.key")} htmlFor="bank-private-key" hint={t("credentials.keyHint")}>
            <Textarea
              id="bank-private-key"
              name="privateKey"
              rows={6}
              className="font-mono text-sm"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              data-1p-ignore
              data-lpignore="true"
              disabled={pending}
            />
          </Field>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="bank-key-file" className="text-sm font-medium">
              {t("credentials.keyFile")}
            </label>
            <input
              id="bank-key-file"
              name="keyFile"
              type="file"
              accept=".pem,.key,.txt"
              disabled={pending}
              className="focus-ring rounded-ctl text-sm file:mr-3 file:h-7 file:rounded-ctl file:border file:border-border file:bg-card file:px-2.5 file:text-sm file:font-medium"
            />
          </div>
          <p className="text-sm text-muted">{t("credentials.readOnlyNote")}</p>
        </form>
      )}
    </Modal>
  );

  if (!credentials.saved) {
    return (
      <div className="flex flex-col gap-3.5 p-4" data-testid="banks-card" data-view="setup">
        <p>{t("setup.intro")}</p>
        <ol className="flex list-decimal flex-col gap-2 pl-5">
          <li>
            {t.rich("setup.step1", {
              link: (chunks) => (
                <a
                  href="https://enablebanking.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="focus-ring rounded-[3px] text-accent underline underline-offset-2"
                >
                  {chunks}
                  <span className="sr-only"> {t("setup.newTab")}</span>
                </a>
              ),
            })}
          </li>
          <li>
            {t("setup.step2")}
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <Input
                readOnly
                value={returnAddress}
                aria-label={t("setup.returnAddress")}
                className="min-w-0 flex-1 basis-64 font-mono text-sm"
              />
              <Button size="sm" onClick={copy}>
                <span aria-live="polite">{copied ? t("setup.copied") : t("setup.copy")}</span>
              </Button>
            </div>
          </li>
          <li>{t("setup.step3")}</li>
        </ol>
        <div>
          <Button variant="primary" size="sm" onClick={() => open("new")}>
            {t("setup.open")}
          </Button>
        </div>
        {credentialsDialog}
      </div>
    );
  }

  return (
    <div className="flex flex-col" data-testid="banks-card" data-view={banks.length > 0 ? "banks" : "ready"}>
      {credentials.invalid && (
        <p role="status" className="m-4 mb-0 rounded-ctl bg-warn-bg px-3 py-2 text-sm text-warn">
          {t("invalidKey")} <LinkButton onClick={() => open("replace")}>{t("actions.replaceKey")}</LinkButton>
        </p>
      )}

      <div className="flex flex-wrap items-start justify-between gap-x-5 gap-y-3 px-4 py-3.5">
        <div className="min-w-0">
          <div className="font-semibold">{t("application.name")}</div>
          <p className="mt-0.5 text-sm text-muted">
            {t("application.savedOn", { date: credentials.savedAt ?? NULL_DISPLAY })}
          </p>
          {banks.length > 0 && <p className="mt-0.5 text-sm text-muted">{t("application.removeBlocked")}</p>}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" disabled={pending} onClick={() => open("replace")}>
            {t("actions.replaceKey")}
          </Button>
          {banks.length === 0 && (
            <ActionMenu
              label={t("application.name")}
              items={[{ label: t("application.remove"), onSelect: () => open("remove"), danger: true }]}
            />
          )}
        </div>
      </div>

      {banks.length === 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2 border-t border-border px-4 py-3.5">
          <p className="text-muted">{t("empty")}</p>
          {credentials.invalid ? (
            <Button variant="primary" size="sm" disabled>
              {t("connect")}
            </Button>
          ) : (
            <ButtonLink href={CONNECT} variant="primary" size="sm">
              {t("connect")}
            </ButtonLink>
          )}
        </div>
      ) : (
        <>
          <ul className="flex flex-col">
            {banks.map((bank) => (
              <li key={bank.id} className="border-t border-border" data-testid="bank-row">
                <ConnectionRow
                  name={bank.name}
                  role={
                    bank.validUntil === null
                      ? t("row.role", { count: bank.accounts })
                      : `${t("row.role", { count: bank.accounts })} · ${t("row.validUntil", { date: bank.validUntil })}`
                  }
                  state="active"
                  status={{ word: t(`states.${bank.state}`), ...STATUS[bank.state] }}
                  lastSync={bank.lastSync}
                  lastSyncLabel={t("row.lastSync")}
                  scheduleLabel={t("row.schedule")}
                  schedule={<div className="mt-0.5 font-medium">{NULL_DISPLAY}</div>}
                  actions={
                    <ActionMenu
                      label={bank.name}
                      items={[
                        {
                          label: t("actions.disconnect"),
                          onSelect: () => {
                            setError(null);
                            setDisconnecting(bank.id);
                          },
                          danger: true,
                        },
                      ]}
                    />
                  }
                />
                {bank.state === "expired" && (
                  <p className="border-t border-border px-4 py-2.5 text-sm text-neg">{t("detail.expired")}</p>
                )}
              </li>
            ))}
          </ul>
          <p className="border-t border-border px-4 py-2.5 text-sm text-muted">{t("oneBank")}</p>
        </>
      )}

      {credentialsDialog}

      <Modal
        open={dialog === "remove"}
        onOpenChange={(isOpen) => !isOpen && setDialog(null)}
        title={t("remove.title")}
        description={t("remove.description")}
        width={420}
        footer={
          <>
            <Button size="sm" onClick={() => setDialog(null)}>
              {t("remove.cancel")}
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={pending}
              onClick={() => run(() => removeBankCredentialsAction(pluginId), t("toasts.removed"))}
            >
              {t("remove.confirm")}
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

      <Modal
        open={leaving !== null}
        onOpenChange={(isOpen) => !isOpen && setDisconnecting(null)}
        title={t("disconnect.title", { bank: leaving?.name ?? "" })}
        description={t("disconnect.description")}
        width={420}
        footer={
          <>
            <Button size="sm" onClick={() => setDisconnecting(null)}>
              {t("disconnect.cancel")}
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={pending}
              onClick={() => {
                if (leaving === null) return;
                const { id, name } = leaving;
                run(() => disconnectBankAction(pluginId, id), t("toasts.disconnected", { bank: name }));
              }}
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
