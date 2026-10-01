"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useState, useTransition } from "react";
import { Button } from "@/ui/button";
import { cn } from "@/ui/cn";
import { Field } from "@/ui/field";
import { Checkbox, Input, Select, Textarea } from "@/ui/input";
import { Modal } from "@/ui/modal";
import { notify } from "@/ui/toast";
import { TRANSACTION_TYPES } from "../rules";
import { editInWallet, setLabels, setNote } from "./commands";
import type { LabelOption, RowView } from "./view";

const FORM_ID = "transaction-details";

function sameLabels(current: readonly string[], next: readonly string[]): boolean {
  if (current.length !== next.length) return false;
  const mine = new Set(current);
  return next.every((id) => mine.has(id));
}

/**
 * The note and the labels of one movement (spec §7.2): the two local fields the design's screen
 * has no room for, reached from "Edit details" in the row menu. The category stays where the
 * design puts it, on the row.
 *
 * Payee, amount and date are shown as context and nothing else: they belong to the provider, and
 * `updateTransaction` refuses a patch that carries them (`provider_owned`). A field the person
 * did not touch is not submitted at all, so an unchanged panel claims nothing in
 * `locally_edited` — the movement keeps following Wallet until they really disagree with it.
 *
 * A movement that came from Wallet, with the integration connected (`row.wallet`), is the
 * exception (owner, 2026-09-24): type, amount, payee and note become fields, and saving writes
 * them **to Wallet** first — nothing changes here unless Wallet accepts them. Labels stay local.
 */
export function TransactionDetails({
  row,
  labels,
  open,
  onOpenChange,
}: {
  row: RowView;
  labels: readonly LabelOption[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("expenses");
  const [chosen, setChosen] = useState<readonly string[]>(row.labelIds);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const wallet = row.wallet ?? null;
  const [type, setType] = useState(wallet?.type ?? "expense");

  function messageFor(code: string): string {
    if (code === "not_found") return t("errors.notFound");
    if (code === "provider_owned") return t("errors.providerOwned");
    return t("errors.failed");
  }

  function walletMessage(code: string, reason?: string): string {
    const key = ["invalid", "amount", "notLinked", "noTransferCategory", "refused", "failed"].includes(code)
      ? code
      : "failed";
    const message = t(`wallet.errors.${key}` as "wallet.errors.failed");
    return reason ? `${message} ${t("wallet.said", { reason })}` : message;
  }

  function toggle(id: string) {
    setChosen((current) => (current.includes(id) ? current.filter((one) => one !== id) : [...current, id]));
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const note = String(data.get("note") ?? "").trim();
    const noteChanged = note !== (row.note ?? "");
    const labelsChanged = !sameLabels(row.labelIds, chosen);
    const amount = String(data.get("amount") ?? "").trim();
    const payee = String(data.get("payee") ?? "").trim();
    const walletChanged =
      wallet !== null &&
      (noteChanged || type !== wallet.type || amount !== wallet.amount || payee !== (row.payee ?? ""));
    if (!noteChanged && !labelsChanged && !walletChanged) {
      onOpenChange(false);
      return;
    }

    startTransition(async () => {
      try {
        if (walletChanged) {
          const result = await editInWallet(row.id, { type, amount, payee, note });
          if (!result.ok) {
            setError(walletMessage(result.error, result.reason));
            return;
          }
          notify(t(result.state === "saved" ? "wallet.saved" : "wallet.unchanged"));
        } else if (noteChanged) {
          const result = await setNote(row.id, note);
          if (!result.ok) {
            setError(messageFor(result.error));
            return;
          }
          notify(t("toasts.noteSaved"));
        }
        if (labelsChanged) {
          const result = await setLabels(row.id, chosen);
          if (!result.ok) {
            setError(messageFor(result.error));
            return;
          }
          notify(t("toasts.labelsSaved"));
        }
        setError(null);
        onOpenChange(false);
      } catch {
        setError(t("errors.failed"));
      }
    });
  }

  const context: { term: string; value: string }[] = wallet
    ? [
        { term: t("columns.date"), value: row.date },
        { term: t("columns.account"), value: row.account },
      ]
    : [
        { term: t("columns.payee"), value: row.payee ?? t("row.noPayee") },
        { term: t("columns.date"), value: row.date },
        { term: t("columns.account"), value: row.account },
        { term: t("columns.amount"), value: row.amount },
      ];

  return (
    <Modal
      width={520}
      open={open}
      onOpenChange={onOpenChange}
      title={t("row.edit")}
      footer={
        <>
          <Button size="sm" onClick={() => onOpenChange(false)}>
            {t("row.cancel")}
          </Button>
          <Button type="submit" form={FORM_ID} variant="primary" size="sm" disabled={pending}>
            {t("row.save")}
          </Button>
        </>
      }
    >
      <form id={FORM_ID} onSubmit={onSubmit} className="flex flex-col gap-3">
        {error && (
          <p role="alert" className="text-sm text-neg">
            {error}
          </p>
        )}

        {/* The provider's own fields, as context: read on this screen, never written (§7.2). */}
        <dl className="grid grid-cols-2 gap-2 rounded-ctl bg-hover px-3 py-2.5 text-sm">
          {context.map((entry) => (
            <div key={entry.term} className="flex min-w-0 flex-col">
              <dt className="text-muted">{entry.term}</dt>
              <dd className="truncate font-medium">{entry.value}</dd>
            </div>
          ))}
        </dl>

        {wallet && (
          <>
            <p className="text-sm text-muted">{t("wallet.hint")}</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label={t("wallet.type")} htmlFor="transaction-type">
                <Select
                  id="transaction-type"
                  name="type"
                  value={type}
                  onChange={(event) => setType(event.currentTarget.value as typeof type)}
                  autoFocus
                >
                  {TRANSACTION_TYPES.map((one) => (
                    <option key={one} value={one}>
                      {t(`wallet.types.${one}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("columns.amount")} htmlFor="transaction-amount" hint={t("wallet.amountHint")}>
                <Input
                  id="transaction-amount"
                  name="amount"
                  defaultValue={wallet.amount}
                  inputMode="decimal"
                  autoComplete="off"
                  required
                  numeric
                />
              </Field>
            </div>
            <Field label={t("columns.payee")} htmlFor="transaction-payee">
              <Input
                id="transaction-payee"
                name="payee"
                defaultValue={row.payee ?? ""}
                maxLength={255}
                autoComplete="off"
              />
            </Field>
          </>
        )}

        <Field label={t("row.note")} htmlFor="transaction-note">
          {/* A note is often a sentence or two, or a bank's whole remittance line: room to read it. */}
          <Textarea
            id="transaction-note"
            name="note"
            defaultValue={row.note ?? ""}
            rows={wallet ? 4 : 6}
            maxLength={wallet ? 255 : undefined}
            autoFocus={!wallet}
          />
        </Field>

        <fieldset className="flex flex-col gap-1.5">
          <legend className="pb-1.5 text-sm font-medium">{t("row.labels")}</legend>
          {labels.length === 0 ? (
            <p className="text-sm text-muted">{t("row.noLabels")}</p>
          ) : (
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {labels.map((label) => (
                <span key={label.id} className="inline-flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className={cn("size-2 shrink-0 rounded-[2px]", label.color === null && "bg-faint")}
                    style={label.color === null ? undefined : { background: label.color }}
                  />
                  <Checkbox
                    label={label.name}
                    checked={chosen.includes(label.id)}
                    disabled={pending}
                    onChange={() => toggle(label.id)}
                  />
                </span>
              ))}
            </div>
          )}
        </fieldset>
      </form>
    </Modal>
  );
}
