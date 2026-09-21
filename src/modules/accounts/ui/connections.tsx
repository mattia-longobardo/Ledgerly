"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useState, useTransition } from "react";
import { Button } from "@/ui/button";
import { Field } from "@/ui/field";
import { Input, Select } from "@/ui/input";
import { Modal } from "@/ui/modal";
import { SettingsSection } from "@/ui/section";
import { notify } from "@/ui/toast";
import { addConnectionAction, removeConnectionAction, updateConnectionAction } from "../actions";
import { CONNECTION_CHANNELS, type ConnectionChannel } from "../rules";

/** One thing hanging off the account, as the browser gets it. */
export interface ConnectionRow {
  id: string;
  channel: ConnectionChannel;
  name: string;
  note: string | null;
}

/** `id` is `null` while adding: the same dialog creates and edits, as Labels already does. */
interface Draft {
  id: string | null;
  channel: ConnectionChannel;
  name: string;
  note: string;
}

const FORM_ID = "connection-form";
const NAME_MAX = 60;
const NOTE_MAX = 120;

export const groupBy = (rows: readonly ConnectionRow[], channel: ConnectionChannel) =>
  rows.filter((row) => row.channel === channel);

/**
 * Account → Settings → Connections (owner, 2026-09-21): the direct debits and standing orders on
 * the IBAN, and what is charged to the card. It replaces a table the owner kept by hand outside
 * the app, so the point is that it is quick to add to and quick to read.
 *
 * A connection is one button, not a row of them: pressing it opens the dialog that renames it,
 * moves it to the other channel, or removes it. One target per connection, and it is a whole chip
 * rather than a 17 px link.
 */
export function ConnectionsSection({ accountId, rows }: { accountId: string; rows: ConnectionRow[] }) {
  const t = useTranslations("accounts.connections");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function messageFor(code: string): string {
    if (code === "duplicate_connection") return t("errors.duplicate");
    if (code === "invalid") return t("errors.invalid", { max: NAME_MAX });
    if (code === "not_found") return t("errors.notFound");
    return t("errors.failed");
  }

  function open(channel: ConnectionChannel, row?: ConnectionRow) {
    setError(null);
    setDraft(
      row
        ? { id: row.id, channel: row.channel, name: row.name, note: row.note ?? "" }
        : { id: null, channel, name: "", note: "" },
    );
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) return;
    const data = new FormData(event.currentTarget);
    const input = {
      channel: String(data.get("channel")) as ConnectionChannel,
      name: String(data.get("name") ?? ""),
      note: String(data.get("note") ?? ""),
    };
    startTransition(async () => {
      const result =
        draft.id === null
          ? await addConnectionAction(accountId, input)
          : await updateConnectionAction(accountId, draft.id, input);
      if (!result.ok) {
        setError(messageFor(result.error));
        return;
      }
      notify(t(draft.id === null ? "added" : "saved", { name: input.name.trim() }));
      setDraft(null);
    });
  }

  function onRemove() {
    if (!draft?.id) return;
    const { id, name } = draft;
    startTransition(async () => {
      const result = await removeConnectionAction(accountId, id);
      if (!result.ok) {
        setError(messageFor(result.error));
        return;
      }
      notify(t("removed", { name }), "success");
      setDraft(null);
    });
  }

  return (
    <SettingsSection title={t("title")} description={t("description")}>
      <div className="flex flex-col gap-4">
        {CONNECTION_CHANNELS.map((channel) => {
          const mine = groupBy(rows, channel);
          return (
            <div key={channel} className="flex flex-col gap-2">
              <h3 className="text-sm font-medium text-muted">{t(`channels.${channel}`)}</h3>
              <div className="flex flex-wrap items-center gap-1.5">
                {mine.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => open(channel, row)}
                    title={row.note ?? t("edit", { name: row.name })}
                    className="focus-ring inline-flex min-h-6 items-center rounded-[13px] border border-border bg-card px-2.5 text-sm hover:bg-hover"
                  >
                    {row.name}
                  </button>
                ))}
                {mine.length === 0 && <span className="text-sm text-faint">{t("empty")}</span>}
                <Button size="xs" onClick={() => open(channel)} disabled={pending}>
                  {t("add")}
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      <Modal
        open={draft !== null}
        onOpenChange={(next) => !next && setDraft(null)}
        title={draft?.id === null ? t("addTitle") : t("editTitle")}
        width={440}
        footer={
          <div className="flex items-center justify-between gap-2">
            {draft?.id !== null && draft !== null ? (
              <Button variant="danger" size="sm" onClick={onRemove} disabled={pending}>
                {t("remove")}
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button onClick={() => setDraft(null)} disabled={pending}>
                {t("cancel")}
              </Button>
              <Button type="submit" form={FORM_ID} variant="primary" disabled={pending}>
                {t("save")}
              </Button>
            </div>
          </div>
        }
      >
        {draft && (
          <form id={FORM_ID} onSubmit={onSubmit} className="flex flex-col gap-3">
            {error && (
              <p role="alert" className="text-sm text-neg">
                {error}
              </p>
            )}
            <Field label={t("name")} htmlFor="connection-name">
              <Input
                id="connection-name"
                name="name"
                defaultValue={draft.name}
                maxLength={NAME_MAX}
                required
                autoFocus
              />
            </Field>
            <Field label={t("channel")} htmlFor="connection-channel">
              <Select id="connection-channel" name="channel" defaultValue={draft.channel}>
                {CONNECTION_CHANNELS.map((channel) => (
                  <option key={channel} value={channel}>
                    {t(`channels.${channel}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("note")} htmlFor="connection-note" hint={t("noteHint")}>
              <Input id="connection-note" name="note" defaultValue={draft.note} maxLength={NOTE_MAX} />
            </Field>
          </form>
        )}
      </Modal>
    </SettingsSection>
  );
}

/**
 * The same lists, read-only, on the account's Overview: the owner's habit was to *consult* that
 * table, and making them open Settings to do it would be a step backwards.
 */
export function ConnectionsSummary({ rows }: { rows: readonly ConnectionRow[] }) {
  const t = useTranslations("accounts.connections");
  if (rows.length === 0) return null;
  return (
    <dl className="flex flex-col gap-1.5 text-sm">
      {CONNECTION_CHANNELS.map((channel) => {
        const mine = groupBy(rows, channel);
        if (mine.length === 0) return null;
        return (
          <div key={channel} className="flex flex-wrap items-baseline gap-x-2">
            <dt className="text-muted">{t(`channels.${channel}`)}</dt>
            <dd className="min-w-0">{mine.map((row) => row.name).join(" · ")}</dd>
          </div>
        );
      })}
    </dl>
  );
}
