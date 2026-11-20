"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useId, useState, useTransition } from "react";
import { type Cents, parseCents } from "@ledgerly/format/cents";
import { formatMoney, parseAmount } from "@ledgerly/format/format";
import { Field } from "@ledgerly/ui/field";
import { FormDialog } from "@ledgerly/ui/form-dialog";
import { Input, InputGroup } from "@ledgerly/ui/input";
import { notify } from "@ledgerly/ui/toast";
import { addToPocket } from "../calls";
import { type DialogContext, type PocketDetail, usePocketError } from "./dialog-context";

/** The amount typed so far, as cents; 0 while it is empty or not a number yet. */
function typedCents(amount: string, context: DialogContext): Cents {
  try {
    return amount.trim() === "" ? 0n : parseAmount(amount, context.numberFormat);
  } catch {
    return 0n;
  }
}

/**
 * What is free on the account and what the pocket becomes once the typed amount goes in.
 * M-exception (PERS-489): this preview stays on the client. It is a sum on the text the person is
 * typing, before any write, not a figure of the domain; it starts from the server's `freeOnAccount`
 * and `balance`.
 */
function AfterDeposit({
  pocket,
  typed,
  context,
}: {
  pocket: PocketDetail;
  typed: Cents;
  context: DialogContext;
}) {
  const text = useTranslations("pockets");
  const money = (cents: Cents | null) => formatMoney(cents, context.numberFormat);
  const free = pocket.freeOnAccount === null ? null : parseCents(pocket.freeOnAccount) - typed;
  return (
    <div className="flex flex-wrap justify-between gap-2 text-sm text-muted tabular-nums">
      {pocket.account && <span>{text("move.free", { account: pocket.account, amount: money(free) })}</span>}
      <span>{text("move.after", { amount: money(parseCents(pocket.balance) + typed) })}</span>
    </div>
  );
}

function DepositFields({
  amount,
  onAmount,
  context,
}: {
  amount: string;
  onAmount: (amount: string) => void;
  context: DialogContext;
}) {
  const text = useTranslations("pockets");
  const id = useId();
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label={text("move.amount")} htmlFor={`${id}-amount`}>
        <InputGroup suffix="€">
          <Input
            id={`${id}-amount`}
            inputMode="decimal"
            numeric
            autoFocus
            value={amount}
            onChange={(event) => onAmount(event.target.value)}
          />
        </InputGroup>
      </Field>
      <Field label={text("move.date")} htmlFor={`${id}-on`}>
        <Input
          id={`${id}-on`}
          name="on"
          type="date"
          max={context.today}
          defaultValue={context.today}
          required
        />
      </Field>
    </div>
  );
}

/** "Add to <pocket>" (design Move modal): a deposit, with what is free and what the pocket becomes. */
export function AddToPocketDialog({
  onClose,
  pocket,
  context,
}: {
  onClose: () => void;
  pocket: PocketDetail;
  context: DialogContext;
}) {
  const text = useTranslations("pockets");
  const [pending, startTransition] = useTransition();
  const [amount, setAmount] = useState("");
  const { error, report } = usePocketError();
  const typed = typedCents(amount, context);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const day = String(new FormData(event.currentTarget).get("on") ?? "");
    startTransition(async () => {
      if (!report(await addToPocket(pocket.id, { amount, on: day }))) return;
      notify(text("toasts.added", { amount: formatMoney(typed, context.numberFormat) }));
      onClose();
    });
  }

  return (
    <FormDialog
      onClose={onClose}
      title={text("move.title", { name: pocket.name })}
      description={
        pocket.account
          ? text("move.descriptionAccount", { account: pocket.account })
          : text("move.descriptionStandalone")
      }
      onSubmit={onSubmit}
      error={error}
      pending={pending}
      cancelLabel={text("form.cancel")}
      submitLabel={text("move.submit")}
    >
      <DepositFields amount={amount} onAmount={setAmount} context={context} />
      <AfterDeposit pocket={pocket} typed={typed} context={context} />
    </FormDialog>
  );
}
