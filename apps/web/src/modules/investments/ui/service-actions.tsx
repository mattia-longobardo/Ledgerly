"use client";

// The commands of a service's header (docs/design/investments-ux.md §3.2, PERS-342). A synced one:
// «Sync», and the key in `⋯` — nothing that moves its value. A manual one on an account typed by hand:
// «Update value», the only command. A manual one on an account a source of Accounts reads: none, the value is that source's.
import { useTranslations } from "next-intl";
import { type FormEvent, type RefObject, useId, useRef, useState, useTransition } from "react";
import { parseAmount } from "@ledgerly/format/format";
import { Button } from "@ledgerly/ui/button";
import { FormDialog } from "@ledgerly/ui/form-dialog";
import { DateField, MoneyField } from "@ledgerly/ui/form-fields";
import { ActionMenu } from "@ledgerly/ui/menu";
import { useRouter } from "@ledgerly/ui/router";
import { notify } from "@ledgerly/ui/toast";
import { updateServiceValue } from "../calls";
import type { ConnectableProvider } from "./connect";
import { FORM_GRID, type ServiceContext, useInvestmentResult } from "./dialog-kit";
import { DisconnectDialog, ReplaceKeyDialog, SyncNowButton } from "./sync";

type HeaderDialog = "value" | "replace" | "disconnect";

/** Whether the typed amount can be read: «Save» waits for one. */
function readable(typed: string, context: ServiceContext): boolean {
  try {
    parseAmount(typed, context.numberFormat);
    return true;
  } catch {
    return false;
  }
}

/** «Update value»: the value read at the broker on a day, saved as the account's balance in Accounts. */
function UpdateValueDialog({
  onClose,
  context,
  opener,
}: {
  onClose: () => void;
  context: ServiceContext;
  opener: RefObject<HTMLButtonElement | null>;
}) {
  const text = useTranslations("investments");
  const id = useId();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { error, report } = useInvestmentResult();
  const [day, setDay] = useState(context.today);
  const [amount, setAmount] = useState("");

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      if (!report(await updateServiceValue(context.accountId, { on: day, amount }))) return;
      notify(text("toasts.valueUpdated", { name: context.name }));
      onClose();
      router.refresh();
    });
  }

  return (
    <FormDialog
      onClose={onClose}
      title={text("valueForm.title", { name: context.name })}
      description={text("valueForm.description")}
      width={520}
      className={FORM_GRID}
      onSubmit={onSubmit}
      error={error}
      pending={pending || !readable(amount, context)}
      cancelLabel={text("form.cancel")}
      submitLabel={text("valueForm.submit")}
      finalFocus={opener}
    >
      <MoneyField
        id={`${id}-amount`}
        label={text("valueForm.amount")}
        value={amount}
        onChange={setAmount}
        currency={context.currency}
        autoFocus
      />
      <DateField
        id={`${id}-on`}
        label={text("form.date")}
        value={day}
        onChange={setDay}
        max={context.today}
      />
    </FormDialog>
  );
}

export function ServiceActions({
  context,
  provider,
  connected,
}: {
  context: ServiceContext;
  provider: ConnectableProvider | null;
  connected: boolean;
}) {
  const text = useTranslations("investments");
  const [open, setOpen] = useState<HeaderDialog | null>(null);
  const valueButton = useRef<HTMLButtonElement>(null);
  const close = () => setOpen(null);
  const more = [
    ...(connected && provider
      ? [{ label: text("sync.replace"), onSelect: () => setOpen("replace" as const) }]
      : []),
    ...(connected
      ? [{ label: text("sync.disconnect"), onSelect: () => setOpen("disconnect" as const), danger: true }]
      : []),
  ];
  return (
    <span className="flex flex-wrap items-center gap-2">
      {context.synced
        ? connected && <SyncNowButton accountId={context.accountId} />
        : context.valueEditable && (
            <Button ref={valueButton} variant="primary" onClick={() => setOpen("value")}>
              {text("header.updateValue")}
            </Button>
          )}
      {more.length > 0 && <ActionMenu label={text("actions.more")} items={more} />}
      {open === "value" && <UpdateValueDialog onClose={close} context={context} opener={valueButton} />}
      {open === "replace" && provider && (
        <ReplaceKeyDialog onClose={close} accountId={context.accountId} provider={provider} />
      )}
      {open === "disconnect" && (
        <DisconnectDialog onClose={close} accountId={context.accountId} name={context.name} />
      )}
    </span>
  );
}
