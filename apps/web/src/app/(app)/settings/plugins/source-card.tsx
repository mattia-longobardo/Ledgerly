"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { type FormEvent, useState, useTransition } from "react";
import { Button } from "@ledgerly/ui/button";
import { Field } from "@ledgerly/ui/field";
import { Input } from "@ledgerly/ui/input";
import { Modal } from "@ledgerly/ui/modal";
import { notify } from "@ledgerly/ui/toast";
import { connectCore, disconnectCore } from "./core-calls";
import { type ActionKind, ConnectionRow, type ConnectionRowProps, DeactivateLink } from "./connection-row";

/** One field of the credential, as the plugin's manifest describes it: never a value. */
export interface CredentialField {
  name: string;
  type: "text" | "secret" | "multiline" | "choice";
  required: boolean;
  label: string;
  help: string | null;
}

/**
 * Everything the browser is told about the connection of a plugin read by an engine of the core (a
 * source read with a token, a leave calendar; rewrite plan R5c). **No credential, and no field one
 * could travel in** (spec §9.4): once saved, a credential never comes back — the form below only
 * ever replaces it. The fields are the manifest's; the row arrives built by the page.
 */
export interface SourceCardProps {
  row: ConnectionRowProps;
  /** The provider's id, for its first credential: the row's id is the connection's once it exists. */
  provider: string;
  connected: boolean;
  fields: readonly CredentialField[];
  /** A leave calendar: «Disconnect» completes the removals still waiting, and the days waiting show. */
  calendar: boolean;
  /** What "Disconnect" leaves: the accounts here and the ones left out (a source of accounts). */
  leave: { accounts: number; excluded: number };
  /** Days still waiting to reach a calendar: the one number that says the two disagree. */
  pendingDays: number;
  /** The source's page, where it is turned off (plugin-settings.md §4.2). */
  deactivateHref: string;
}

/** What this card does itself, with a dialog of its own; the rest is the row's. */
const HANDLED: readonly ActionKind[] = ["connect", "replaceKey", "disconnect"];

const FORM_ID = "source-credential-form";

/** The fields of the form: a secret is a password field, never prefilled. */
function CredentialFields({ fields }: { fields: readonly CredentialField[] }) {
  return fields.map((field, index) => (
    <Field
      key={field.name}
      label={field.label}
      htmlFor={`credential-${field.name}`}
      hint={field.help ?? undefined}
    >
      <Input
        id={`credential-${field.name}`}
        name={field.name}
        type={field.type === "secret" ? "password" : "text"}
        className={field.type === "secret" ? "font-mono" : undefined}
        autoComplete="off"
        spellCheck={false}
        required={field.required}
        autoFocus={index === 0}
      />
    </Field>
  ));
}

/** The words of «Disconnect»: what a source of accounts leaves, or what a calendar completes. */
function useDisconnectText(props: Pick<SourceCardProps, "row" | "calendar" | "leave">): string {
  const text = useTranslations("settings.integrations");
  const { row, calendar, leave } = props;
  if (calendar) return text("disconnect.calendar", { provider: row.name });
  return [
    text("disconnect.description", { name: row.name, count: leave.accounts }),
    // No switch to a bank happens by itself (decision H58): the person moves each account.
    text("disconnect.noSwitch", { count: leave.accounts }),
    leave.excluded > 0 ? text("disconnect.excluded", { count: leave.excluded }) : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** An action's refusal code, spelled out one branch at a time so the catalogue keys stay literal. */
export function useRefusalText(): (code: string) => string {
  const text = useTranslations("settings.integrations");
  return (code) => {
    if (code === "rejected") return text("errors.rejected");
    if (code === "unreachable") return text("errors.unreachable");
    if (code === "empty") return text("errors.empty");
    if (code === "notConnected") return text("errors.notConnected");
    if (code === "busy") return text("errors.busy");
    if (code === "provider") return text("errors.provider");
    return text("errors.failed");
  };
}

type Answer = { ok: true; back?: number } | { ok: false; error: string };

/** The card's dialogs and its one action at a time: a refusal reported in place, a success as a toast. */
function useCardActions(name: string) {
  const text = useTranslations("settings.integrations");
  const plugin = useTranslations("settings.plugin");
  const [dialog, setDialog] = useState<"connect" | "disconnect" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // The page draws the connection from its server render until it reads `/api/v1` itself.
  const router = useRouter();
  const refusal = useRefusalText();
  const run = (work: () => Promise<Answer>, success: string) =>
    startTransition(async () => {
      try {
        const result = await work();
        if (!result.ok) return setError(refusal(result.error));
        setError(null);
        setDialog(null);
        router.refresh();
        notify(result.back ? plugin("reactivate.back", { count: result.back, provider: name }) : success);
      } catch {
        setError(text("errors.failed"));
      }
    });
  return { dialog, setDialog, error, setError, pending, run };
}

type Actions = ReturnType<typeof useCardActions>;

/** The error of a dialog, in the dialog. */
function DialogError({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="text-sm text-neg">
      {error}
    </p>
  );
}

/** The dialog that states the credential: the fields of the manifest, read once on submit. */
function ConnectDialog(props: SourceCardProps & { actions: Actions }) {
  const { row, provider, connected, fields, actions } = props;
  const text = useTranslations("settings.integrations");
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Read, trimmed by the action, and dropped when this handler returns: no secret is kept
    // anywhere this component can render it.
    const form = new FormData(event.currentTarget);
    const credentials = Object.fromEntries(
      fields.map((field) => [field.name, String(form.get(field.name) ?? "")]),
    );
    actions.run(
      () => connectCore(provider, credentials),
      connected ? text("toasts.replaced") : text("toasts.connected", { provider: row.name }),
    );
  }
  return (
    <Modal
      open={actions.dialog === "connect"}
      onOpenChange={(open) => !open && actions.setDialog(null)}
      title={text("connect.title", { provider: row.name })}
      description={text("connect.description")}
      width={460}
      footer={
        <>
          <Button size="sm" onClick={() => actions.setDialog(null)}>
            {text("connect.cancel")}
          </Button>
          <Button type="submit" form={FORM_ID} variant="primary" size="sm" disabled={actions.pending}>
            {connected ? text("connect.replace") : text("connect.submit")}
          </Button>
        </>
      }
    >
      {/* Mounted with the dialog and unmounted with it, so closing the dialog is also what
          discards what was typed. */}
      {actions.dialog === "connect" && (
        <form id={FORM_ID} onSubmit={onSubmit} className="flex flex-col gap-3">
          <DialogError error={actions.error} />
          <CredentialFields fields={fields} />
        </form>
      )}
    </Modal>
  );
}

/** The dialog of «Disconnect»: what stays, and the way to stop for good. */
function DisconnectDialog(props: SourceCardProps & { actions: Actions }) {
  const { row, deactivateHref, actions } = props;
  const text = useTranslations("settings.integrations");
  const description = useDisconnectText(props);
  return (
    <Modal
      open={actions.dialog === "disconnect"}
      onOpenChange={(open) => !open && actions.setDialog(null)}
      title={text("disconnect.title", { name: row.name })}
      description={description}
      width={420}
      footer={
        <>
          <Button size="sm" onClick={() => actions.setDialog(null)}>
            {text("disconnect.cancel")}
          </Button>
          <Button
            variant="danger"
            size="sm"
            disabled={actions.pending}
            onClick={() =>
              actions.run(() => disconnectCore(row.id), text("toasts.disconnected", { provider: row.name }))
            }
          >
            {text("disconnect.confirm")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2 text-sm">
        <DialogError error={actions.error} />
        <DeactivateLink href={deactivateHref} provider={row.name} />
      </div>
    </Modal>
  );
}

/**
 * Settings › Integrations, the card of a plugin read by an engine of the core: the row every
 * connection has (ux/n2-connection-status.md §3) and the two dialogs that are its own — state the
 * credential the manifest asks for, disconnect.
 *
 * The secret fields have no `value` and no `defaultValue`, are read once out of the submitted
 * `FormData` into a local binding, and the dialog they live in unmounts on close — so a secret is
 * never in React state, never in a prop and never in the DOM a moment longer than the dialog is open.
 */
export function SourceCard(props: SourceCardProps) {
  const { row, connected, calendar, pendingDays } = props;
  const text = useTranslations("settings.integrations");
  const actions = useCardActions(row.name);
  return (
    <div className="flex flex-col">
      <ConnectionRow
        {...row}
        handled={HANDLED}
        disabled={actions.pending}
        onAction={(kind) => {
          actions.setError(null);
          actions.setDialog(kind === "disconnect" ? "disconnect" : "connect");
        }}
      />
      {/* Days the app holds that the calendar has not been told about yet. Zero is the normal state
          and says nothing, so it is not shown. */}
      {calendar && connected && pendingDays > 0 && (
        <p className="border-t border-border px-4 py-2.5 text-sm text-muted">
          {text("calendar.pending", { count: pendingDays, provider: row.name })}
        </p>
      )}
      {actions.error && actions.dialog === null && (
        <p role="alert" className="border-t border-border px-4 py-2.5 text-sm text-neg">
          {actions.error}
        </p>
      )}
      <ConnectDialog {...props} actions={actions} />
      <DisconnectDialog {...props} actions={actions} />
    </div>
  );
}
