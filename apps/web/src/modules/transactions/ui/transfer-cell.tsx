"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useId, useState } from "react";
import { AccountSelect } from "@ledgerly/ui/account-select";
import { Badge } from "@ledgerly/ui/badge";
import { Button } from "@ledgerly/ui/button";
import { cn } from "@ledgerly/ui/cn";
import { Field } from "@ledgerly/ui/field";
import { Modal } from "@ledgerly/ui/modal";
import { notify } from "@ledgerly/ui/toast";
import { CHIP } from "./category-cell";
import { setTransferSide } from "./commands";
import { NONE, OUTSIDE, sideFrom, sideOf } from "./edit-plan";
import type { RowView } from "./view";

/** «From A → to B»: this account and the other one, in the direction the money goes. */
export function useTransferRoute() {
  const text = useTranslations("expenses.transfer");
  return (row: Pick<RowView, "account" | "transfer">): string => {
    const transfer = row.transfer;
    if (!transfer) return "";
    const other = transfer.state === "outside" ? text("outside") : (transfer.other ?? text("noAccount"));
    return transfer.out
      ? text("route", { from: row.account, to: other })
      : text("route", { from: other, to: row.account });
  };
}

/**
 * The cell of a giroconto, where any other movement has its category (a giroconto has none): the
 * route between the two accounts and its state — paired, outside, waiting for the other leg — or
 * «Choose the account» when the person has to say it. A click opens the choice of the account.
 */
export function TransferCell({
  row,
  onOpen,
  disabled,
}: {
  row: Pick<RowView, "account" | "transfer">;
  onOpen: () => void;
  disabled?: boolean;
}) {
  const text = useTranslations("expenses.transfer");
  const routeOf = useTransferRoute();
  const transfer = row.transfer;
  if (!transfer) return null;
  if (transfer.state === "choose") {
    return (
      <button
        type="button"
        data-testid="transfer-choose"
        disabled={disabled}
        onClick={onOpen}
        className={cn(CHIP, "border border-dashed border-warn text-warn hover:bg-card")}
      >
        {text("choose")}
      </button>
    );
  }
  const route = routeOf(row);
  return (
    <span className="flex max-w-full min-w-0 flex-wrap items-center gap-1">
      <button
        type="button"
        data-testid="transfer-route"
        data-state={transfer.state}
        disabled={disabled}
        onClick={onOpen}
        title={route}
        aria-label={text("change", { route })}
        // The route wraps rather than truncates: cut, it hid the very account it names.
        className={cn(
          CHIP,
          "h-auto min-h-6 max-w-full min-w-0 border border-transparent py-0.5 text-left text-muted hover:border-border hover:bg-card",
        )}
      >
        <span className="min-w-0 break-words whitespace-normal">{route}</span>
      </button>
      {transfer.state === "waiting" && <Badge tone="neutral">{text("waiting")}</Badge>}
    </span>
  );
}

/** Saves the choice; closes the dialog once it is saved, says why when it is not. */
function useSaveSide(id: string, onClose: () => void) {
  const text = useTranslations("expenses.transfer");
  const [saving, setSaving] = useState(false);
  function save(choice: string) {
    setSaving(true);
    setTransferSide(id, sideFrom(choice))
      .then((result) => {
        if (!result.ok) return notify(text("failed"), "error");
        notify(choice === NONE ? text("toasts.none") : text("toasts.saved"));
        onClose();
      })
      .catch(() => notify(text("failed"), "error"))
      .finally(() => setSaving(false));
  }
  return { saving, save };
}

/**
 * The other side of a movement, chosen by the person (`PUT /transactions/{id}/transfer`): one of
 * their accounts, an account outside Ledgerly, or — for a giroconto — none, which makes it an income
 * or a spending again by its sign. The same dialog makes an income or a spending a giroconto.
 */
export function TransferDialog({
  row,
  accounts,
  onClose,
}: {
  row: Pick<RowView, "id" | "account" | "accountId" | "transfer">;
  /** The person's accounts: the one of the movement is left out. */
  accounts: readonly { id: string; name: string }[];
  onClose: () => void;
}) {
  const text = useTranslations("expenses.transfer");
  const id = useId();
  const transfer = row.transfer ?? null;
  const [choice, setChoice] = useState(sideOf(row));
  const { saving, save } = useSaveSide(row.id, onClose);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (choice !== "" && !saving) save(choice);
  }

  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title={transfer ? text("title") : text("make")}
      description={text("description", { account: row.account })}
      footer={
        <>
          <Button onClick={onClose}>{text("cancel")}</Button>
          <Button type="submit" form={`${id}-form`} variant="primary" disabled={saving || choice === ""}>
            {text("save")}
          </Button>
        </>
      }
    >
      <form id={`${id}-form`} onSubmit={submit} aria-busy={saving}>
        <Field label={text("other")} htmlFor={`${id}-account`}>
          <AccountSelect
            id={`${id}-account`}
            accounts={accounts.filter((account) => account.id !== row.accountId)}
            none={text("choose")}
            value={choice}
            disabled={saving}
            onChange={(event) => setChoice(event.target.value)}
          >
            <option value={OUTSIDE}>{text("outside")}</option>
            {transfer && <option value={NONE}>{text("none")}</option>}
          </AccountSelect>
        </Field>
      </form>
    </Modal>
  );
}
