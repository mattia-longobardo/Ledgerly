"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useRef, useState, useTransition } from "react";
import { Button } from "@/ui/button";
import { Badge } from "@/ui/badge";
import { Card, CardHeader } from "@/ui/card";
import { Field } from "@/ui/field";
import { Input } from "@/ui/input";
import { Table, TBody, Td, Th, THead, Tr } from "@/ui/table";
import { notify } from "@/ui/toast";
import { TONE_TEXT, toneOfSign } from "@/ui/tone";
import { deleteBalanceEntryAction, saveBalanceEntryAction } from "../actions";

export interface EntryRow {
  id: string;
  on: string;
  onLabel: string;
  balance: string;
  change: string;
  changeSign: number;
  note: string | null;
  source: "manual" | "provider" | "system" | "import";
}

/**
 * Account detail › Balance entries: the add form and the list, with deletion limited to the manual
 * rows — a provider's reading and a snapshot are records of what happened, not entries to edit.
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
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const text = (key: string) => String(data.get(key) ?? "").trim();
    startTransition(async () => {
      try {
        const result = await saveBalanceEntryAction(accountId, {
          on: text("on"),
          amount: text("amount"),
          note: text("note"),
        });
        if (!result.ok) {
          setError(t(`errors.${result.error === "future_date" ? "futureDate" : "invalid"}`));
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
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
      <Card className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t("add.title")}</h2>
        <p className="text-sm text-muted">{synced ? t("add.syncedNote") : t("add.manualNote")}</p>
        <form ref={form} onSubmit={onSubmit} className="flex flex-col gap-3">
          {error && (
            <p role="alert" className="text-sm text-neg">
              {error}
            </p>
          )}
          <Field label={t("add.date")} htmlFor="on">
            <Input id="on" name="on" type="date" max={today} defaultValue={today} required />
          </Field>
          <Field label={t("add.balance")} htmlFor="amount">
            <Input id="amount" name="amount" inputMode="decimal" required numeric />
          </Field>
          <Field label={t("add.note")} htmlFor="note">
            <Input id="note" name="note" maxLength={200} />
          </Field>
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
                      <Badge tone={entry.source === "manual" ? "accent" : "neutral"}>
                        {t(`sources.${entry.source}`)}
                      </Badge>
                    </Td>
                    <Td align="right">
                      {entry.source === "manual" && (
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() => onDelete(entry.id)}
                          disabled={pending}
                        >
                          {t("list.delete")}
                        </Button>
                      )}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
}
