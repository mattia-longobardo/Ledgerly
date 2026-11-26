"use client";

// What hangs off an account (owner, 2026-09-21), read and written through `/accounts/{id}/links`: the
// direct debits and standing orders on its IBAN, and what is charged to its card. Settings edits the
// list, Overview shows it read-only.
import { useTranslations } from "next-intl";
import { type FormEvent, useState, useTransition } from "react";
import { links } from "@ledgerly/api-contract/accounts";
import { Button } from "@ledgerly/ui/button";
import { invalidate, useApi } from "@ledgerly/ui/data";
import { Field } from "@ledgerly/ui/field";
import { Input, Select } from "@ledgerly/ui/input";
import { Modal } from "@ledgerly/ui/modal";
import { SettingsSection } from "@ledgerly/ui/section";
import { notify } from "@ledgerly/ui/toast";
import {
  type ActionResult,
  addConnectionAction,
  removeConnectionAction,
  updateConnectionAction,
} from "../calls";

/** The channels, from the route's own schema: the client names none of its own. */
const channelSchema = links.addAccountLink.body.shape.channel;
const CHANNELS = channelSchema.options;
type Channel = (typeof CHANNELS)[number];

/** One thing hanging off the account, as `GET /accounts/{id}/links` answers it. */
interface ConnectionRow {
  id: string;
  channel: Channel;
  name: string;
  note: string | null;
}

/** `id` is `null` while adding: the same dialog creates and edits. */
interface Draft {
  id: string | null;
  channel: Channel;
  name: string;
  note: string;
}

const FORM_ID = "connection-form";
const NAME_MAX = 60;
const NOTE_MAX = 120;

/** What hangs off the account, read from `/api/v1`: one read for the section and the summary. */
function useLinks(accountId: string): ConnectionRow[] | undefined {
  return useApi(links.listAccountLinks, { params: { id: accountId } }).data?.links;
}

const ofChannel = (rows: readonly ConnectionRow[], channel: Channel) =>
  rows.filter((row) => row.channel === channel);

/**
 * Account → Settings → Connections: quick to add to and quick to read. A connection is one chip;
 * pressing it opens the dialog that renames it, moves it to the other channel, or removes it.
 */
export function ConnectionsSection({ accountId }: { accountId: string }) {
  const text = useTranslations("accounts.connections");
  const rows = useLinks(accountId) ?? [];
  const [draft, setDraft] = useState<Draft | null>(null);

  function open(channel: Channel, row?: ConnectionRow) {
    setDraft(
      row
        ? { id: row.id, channel: row.channel, name: row.name, note: row.note ?? "" }
        : { id: null, channel, name: "", note: "" },
    );
  }

  return (
    <SettingsSection title={text("title")} description={text("description")}>
      <div className="flex flex-col gap-4">
        {CHANNELS.map((channel) => {
          const mine = ofChannel(rows, channel);
          return (
            <div key={channel} className="flex flex-col gap-2">
              <h3 className="text-sm font-medium text-muted">{text(`channels.${channel}`)}</h3>
              <div className="flex flex-wrap items-center gap-1.5">
                {mine.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => open(channel, row)}
                    title={row.note ?? text("edit", { name: row.name })}
                    className="focus-ring inline-flex min-h-6 items-center rounded-[13px] border border-border bg-card px-2.5 text-sm hover:bg-hover"
                  >
                    {row.name}
                  </button>
                ))}
                {mine.length === 0 && <span className="text-sm text-faint">{text("empty")}</span>}
                <Button size="xs" onClick={() => open(channel)}>
                  {text("add")}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
      {draft && <ConnectionDialog accountId={accountId} draft={draft} onClose={() => setDraft(null)} />}
    </SettingsSection>
  );
}

/** One write of the dialog: its refusal in words, or a toast and the dialog closed. */
function useWrite(onClose: () => void) {
  const text = useTranslations("accounts.connections");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function messageFor(code: string): string {
    if (code === "duplicate_connection") return text("errors.duplicate");
    if (code === "invalid") return text("errors.invalid", { max: NAME_MAX });
    if (code === "not_found") return text("errors.notFound");
    return text("errors.failed");
  }

  function run(work: () => Promise<ActionResult>, done: string) {
    startTransition(async () => {
      const result = await work();
      if (!result.ok) {
        setError(messageFor(result.error));
        return;
      }
      notify(done);
      onClose();
      await invalidate(links.listAccountLinks);
    });
  }

  return { error, pending, run };
}

/** The dialog that adds, edits or removes one connection; it closes on success. */
function ConnectionDialog({
  accountId,
  draft,
  onClose,
}: {
  accountId: string;
  draft: Draft;
  onClose: () => void;
}) {
  const text = useTranslations("accounts.connections");
  const { error, pending, run } = useWrite(onClose);
  const editing = draft.id;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const input = {
      channel: channelSchema.parse(data.get("channel")),
      name: String(data.get("name") ?? ""),
      note: String(data.get("note") ?? ""),
    };
    const name = input.name.trim();
    if (editing === null) run(() => addConnectionAction(accountId, input), text("added", { name }));
    else run(() => updateConnectionAction(accountId, editing, input), text("saved", { name }));
  }

  return (
    <Modal
      open
      onOpenChange={(next) => !next && onClose()}
      title={editing === null ? text("addTitle") : text("editTitle")}
      width={440}
      footer={
        <DialogFooter
          pending={pending}
          onClose={onClose}
          onRemove={
            editing === null
              ? null
              : () =>
                  run(() => removeConnectionAction(accountId, editing), text("removed", { name: draft.name }))
          }
        />
      }
    >
      <ConnectionFields draft={draft} error={error} onSubmit={onSubmit} />
    </Modal>
  );
}

/** Remove (only while editing) on the left, Cancel and Save on the right. */
function DialogFooter({
  pending,
  onClose,
  onRemove,
}: {
  pending: boolean;
  onClose: () => void;
  onRemove: (() => void) | null;
}) {
  const text = useTranslations("accounts.connections");
  return (
    <div className="flex items-center justify-between gap-2">
      {onRemove === null ? (
        <span />
      ) : (
        <Button variant="danger" size="sm" disabled={pending} onClick={onRemove}>
          {text("remove")}
        </Button>
      )}
      <div className="flex gap-2">
        <Button onClick={onClose} disabled={pending}>
          {text("cancel")}
        </Button>
        <Button type="submit" form={FORM_ID} variant="primary" disabled={pending}>
          {text("save")}
        </Button>
      </div>
    </div>
  );
}

function ConnectionFields({
  draft,
  error,
  onSubmit,
}: {
  draft: Draft;
  error: string | null;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const text = useTranslations("accounts.connections");
  return (
    <form id={FORM_ID} onSubmit={onSubmit} className="flex flex-col gap-3">
      {error && (
        <p role="alert" className="text-sm text-neg">
          {error}
        </p>
      )}
      <Field label={text("name")} htmlFor="connection-name">
        <Input
          id="connection-name"
          name="name"
          defaultValue={draft.name}
          maxLength={NAME_MAX}
          required
          autoFocus
        />
      </Field>
      <Field label={text("channel")} htmlFor="connection-channel">
        <Select id="connection-channel" name="channel" defaultValue={draft.channel}>
          {CHANNELS.map((channel) => (
            <option key={channel} value={channel}>
              {text(`channels.${channel}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={text("note")} htmlFor="connection-note" hint={text("noteHint")}>
        <Input id="connection-note" name="note" defaultValue={draft.note} maxLength={NOTE_MAX} />
      </Field>
    </form>
  );
}

/**
 * The same lists, read-only, on the account's Overview: the owner consults them there, without
 * opening Settings.
 */
export function ConnectionsSummary({ accountId }: { accountId: string }) {
  const text = useTranslations("accounts.connections");
  const rows = useLinks(accountId);
  if (rows === undefined || rows.length === 0) return null;
  return (
    <dl className="flex flex-col gap-1.5 text-sm">
      {CHANNELS.map((channel) => {
        const mine = ofChannel(rows, channel);
        if (mine.length === 0) return null;
        return (
          <div key={channel} className="flex flex-wrap items-baseline gap-x-2">
            <dt className="text-muted">{text(`channels.${channel}`)}</dt>
            <dd className="min-w-0">{mine.map((row) => row.name).join(" · ")}</dd>
          </div>
        );
      })}
    </dl>
  );
}
