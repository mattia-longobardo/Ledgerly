"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useId, useRef, useState, useTransition } from "react";
import { Button } from "@/ui/button";
import { Badge } from "@/ui/badge";
import { Card, CardHeader } from "@/ui/card";
import { Field } from "@/ui/field";
import { Input } from "@/ui/input";
import { Modal } from "@/ui/modal";
import { Table, TBody, Td, Th, THead, Tr } from "@/ui/table";
import { notify } from "@/ui/toast";
import { TONE_TEXT, toneOfSign } from "@/ui/tone";
import {
  type ActionResult,
  type BalanceEntryFormInput,
  deleteBalanceEntryAction,
  saveBalanceEntryAction,
  updateBalanceEntryAction,
} from "../actions";

export interface EntryRow {
  id: string;
  on: string;
  onLabel: string;
  balance: string;
  change: string;
  changeSign: number;
  note: string | null;
  /** `derived` (F2.5) is a month end rebuilt from the movements: shown, never edited here. */
  source: "manual" | "provider" | "system" | "import" | "derived";
  /** The amounts as the person would type them back, for the correction form. */
  amountInput: string;
  availableInput: string;
}

/** What the form reads out of itself, the shape both Server Actions take. */
function formValues(form: HTMLFormElement): BalanceEntryFormInput {
  const data = new FormData(form);
  const text = (key: string) => String(data.get(key) ?? "").trim();
  return { on: text("on"), amount: text("amount"), available: text("available"), note: text("note") };
}

/**
 * The four fields of a balance, blank for a new one and filled in for a correction: the same mask
 * either way, so the two can never ask for different things.
 */
function EntryFields({ prefix, entry, today }: { prefix: string; entry: EntryRow | null; today: string }) {
  const t = useTranslations("accounts.entries");
  return (
    <>
      <Field label={t("add.date")} htmlFor={`${prefix}-on`}>
        <Input
          id={`${prefix}-on`}
          name="on"
          type="date"
          max={today}
          defaultValue={entry?.on ?? today}
          required
        />
      </Field>
      <Field label={t("add.balance")} htmlFor={`${prefix}-amount`}>
        <Input
          id={`${prefix}-amount`}
          name="amount"
          inputMode="decimal"
          defaultValue={entry?.amountInput ?? ""}
          required
          numeric
        />
      </Field>
      <Field label={t("add.available")} htmlFor={`${prefix}-available`} hint={t("add.availableHint")}>
        <Input
          id={`${prefix}-available`}
          name="available"
          inputMode="decimal"
          defaultValue={entry?.availableInput ?? ""}
          numeric
        />
      </Field>
      <Field label={t("add.note")} htmlFor={`${prefix}-note`}>
        <Input id={`${prefix}-note`} name="note" maxLength={200} defaultValue={entry?.note ?? ""} />
      </Field>
    </>
  );
}

/** "Edit balance": the add mask again, on a `manual` entry already stored. */
function EditEntryDialog({
  accountId,
  entry,
  today,
  onClose,
}: {
  accountId: string;
  entry: EntryRow;
  today: string;
  onClose: () => void;
}) {
  const t = useTranslations("accounts.entries");
  const prefix = useId();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = formValues(event.currentTarget);
    startTransition(async () => {
      try {
        const result = await updateBalanceEntryAction(accountId, entry.id, input);
        if (!result.ok) {
          setError(t(`errors.${messageOf(result)}`));
          return;
        }
        notify(t("updated"));
        onClose();
      } catch {
        setError(t("errors.failed"));
      }
    });
  }

  return (
    <Modal
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={t("edit.title")}
      description={t("edit.description")}
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
        <EntryFields prefix={prefix} entry={entry} today={today} />
        {error && (
          <p role="alert" className="text-sm text-neg">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>{t("edit.cancel")}</Button>
          <Button type="submit" variant="primary" disabled={pending}>
            {t("edit.submit")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** The message key a refused action carries, under `accounts.entries.errors`. */
function messageOf(result: Extract<ActionResult, { ok: false }>): "futureDate" | "notFound" | "invalid" {
  if (result.error === "future_date") return "futureDate";
  if (result.error === "not_found") return "notFound";
  return "invalid";
}

/**
 * Account detail › Balance entries: the add form and the list, with editing and deletion limited to
 * the manual rows — a provider's reading, a snapshot and a rebuilt month end are records of what
 * happened, not entries to edit.
 */
export function BalanceEntries({
  accountId,
  entries,
  today,
  synced,
}: {
  accountId: string;
  entries: EntryRow[];
  today: string;
  synced: boolean;
}) {
  const t = useTranslations("accounts.entries");
  const form = useRef<HTMLFormElement>(null);
  const prefix = useId();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<EntryRow | null>(null);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = formValues(event.currentTarget);
    startTransition(async () => {
      try {
        const result = await saveBalanceEntryAction(accountId, input);
        if (!result.ok) {
          setError(t(`errors.${messageOf(result)}`));
          return;
        }
        setError(null);
        form.current?.reset();
        notify(t("saved"));
      } catch {
        setError(t("errors.failed"));
      }
    });
  }

  function onDelete(id: string) {
    startTransition(async () => {
      const result = await deleteBalanceEntryAction(accountId, id);
      if (!result.ok) setError(t("errors.failed"));
      else notify(t("deleted"));
    });
  }

  return (
    <div className="grid gap-4 @4xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
      <Card className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t("add.title")}</h2>
        <p className="text-sm text-muted">{synced ? t("add.syncedNote") : t("add.manualNote")}</p>
        <form ref={form} onSubmit={onSubmit} className="flex flex-col gap-3">
          {error && (
            <p role="alert" className="text-sm text-neg">
              {error}
            </p>
          )}
          <EntryFields prefix={prefix} entry={null} today={today} />
          <Button type="submit" variant="primary" size="sm" disabled={pending} className="self-start">
            {t("add.submit")}
          </Button>
        </form>
      </Card>

      <Card padded={false}>
        <CardHeader
          title={t("list.title")}
          actions={<span className="text-muted">{t("list.count", { count: entries.length })}</span>}
        />
        {entries.length === 0 ? (
          <p className="px-4 pb-4 text-muted">{t("list.empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <THead>
                <Th>{t("list.date")}</Th>
                <Th align="right">{t("list.balance")}</Th>
                <Th align="right">{t("list.change")}</Th>
                <Th>{t("list.note")}</Th>
                <Th>{t("list.source")}</Th>
                <Th>
                  <span className="sr-only">{t("list.actions")}</span>
                </Th>
              </THead>
              <TBody>
                {entries.map((entry) => (
                  <Tr key={entry.id}>
                    <Td>{entry.onLabel}</Td>
                    <Td align="right">{entry.balance}</Td>
                    <Td align="right" className={TONE_TEXT[toneOfSign(entry.changeSign)]}>
                      {entry.change}
                    </Td>
                    <Td muted>{entry.note ?? "—"}</Td>
                    <Td>
                      <Badge
                        tone={
                          entry.source === "manual"
                            ? "accent"
                            : entry.source === "derived"
                              ? "warn"
                              : "neutral"
                        }
                      >
                        {t(`sources.${entry.source}`)}
                      </Badge>
                    </Td>
                    <Td align="right">
                      {entry.source === "manual" && (
                        <span className="flex justify-end gap-1">
                          <Button
                            size="xs"
                            variant="ghost"
                            onClick={() => setEditing(entry)}
                            disabled={pending}
                          >
                            {t("list.edit")}
                          </Button>
                          <Button
                            size="xs"
                            variant="ghost"
                            onClick={() => onDelete(entry.id)}
                            disabled={pending}
                          >
                            {t("list.delete")}
                          </Button>
                        </span>
                      )}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </div>
        )}
      </Card>

      {editing && (
        <EditEntryDialog
          accountId={accountId}
          entry={editing}
          today={today}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
