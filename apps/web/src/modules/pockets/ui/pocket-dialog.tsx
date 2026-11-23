"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useId, useState, useTransition } from "react";
import { MAX_NAME, pockets } from "@ledgerly/api-contract/pockets";
import { parseCents } from "@ledgerly/format/cents";
import { formatAmountInput } from "@ledgerly/format/format";
import { AccountSelect } from "@ledgerly/ui/account-select";
import { useApi } from "@ledgerly/ui/data";
import { Field } from "@ledgerly/ui/field";
import { FormDialog } from "@ledgerly/ui/form-dialog";
import { Input, InputGroup, Select } from "@ledgerly/ui/input";
import { useRouter } from "@ledgerly/ui/router";
import { notify } from "@ledgerly/ui/toast";
import { createPocket, type PocketForm, updatePocket } from "../calls";
import { type DialogContext, type PocketDetail, usePocketError } from "./dialog-context";

/**
 * The amounts of the dialog: a target, and what it accrues each month on its day (R5a, D6: 1 to 31,
 * the last day of a shorter month) unless filled by hand.
 */
function AmountFields({
  id,
  pocket,
  context,
  manual,
  onManual,
}: {
  id: string;
  pocket: PocketDetail | null;
  context: DialogContext;
  manual: boolean;
  onManual: (manual: boolean) => void;
}) {
  const text = useTranslations("pockets");
  // The amounts as the person would type them back.
  const typed = (amount: string | null | undefined) =>
    amount ? formatAmountInput(parseCents(amount), context.numberFormat) : "";
  return (
    <>
      <Field label={text("form.target")} htmlFor={`${id}-target`}>
        <InputGroup suffix="€">
          <Input
            id={`${id}-target`}
            name="target"
            inputMode="decimal"
            numeric
            placeholder={text("form.targetPlaceholder")}
            defaultValue={typed(pocket?.target)}
          />
        </InputGroup>
      </Field>
      <Field label={text("form.accrues")} htmlFor={`${id}-accrues`}>
        <Select
          id={`${id}-accrues`}
          value={manual ? "manual" : "first"}
          onChange={(event) => onManual(event.target.value === "manual")}
        >
          <option value="first">{text("form.everyMonth")}</option>
          <option value="manual">{text("form.manually")}</option>
        </Select>
      </Field>
      <Field label={text("form.monthly")} htmlFor={`${id}-monthly`}>
        <InputGroup suffix="€">
          <Input
            id={`${id}-monthly`}
            name="monthly"
            inputMode="decimal"
            numeric
            disabled={manual}
            defaultValue={typed(pocket?.monthly)}
          />
        </InputGroup>
      </Field>
    </>
  );
}

/** The day of the month the accrual lands on (R5a, D6); off for a pocket filled by hand. */
function AccrualDayField({
  id,
  pocket,
  manual,
}: {
  id: string;
  pocket: PocketDetail | null;
  manual: boolean;
}) {
  const text = useTranslations("pockets");
  return (
    <Field label={text("form.accrualDay")} htmlFor={`${id}-day`} hint={text("form.accrualDayHint")}>
      <Input
        id={`${id}-day`}
        name="day"
        type="number"
        inputMode="numeric"
        min={1}
        max={31}
        disabled={manual}
        defaultValue={pocket?.accrualDay ?? 1}
      />
    </Field>
  );
}

/** The name, and the account the pocket rests on (none: a standalone envelope). */
function NameFields({
  id,
  pocket,
  accounts,
}: {
  id: string;
  pocket: PocketDetail | null;
  accounts: readonly { id: string; name: string }[];
}) {
  const text = useTranslations("pockets");
  return (
    <>
      <div className="col-span-full">
        <Field label={text("form.name")} htmlFor={`${id}-name`}>
          <Input
            id={`${id}-name`}
            name="name"
            defaultValue={pocket?.name ?? ""}
            required
            maxLength={MAX_NAME}
          />
        </Field>
      </div>
      <Field label={text("form.account")} htmlFor={`${id}-account`}>
        <AccountSelect
          id={`${id}-account`}
          name="account"
          defaultValue={pocket?.accountId ?? ""}
          accounts={accounts}
          none={text("form.none")}
        />
      </Field>
    </>
  );
}

/** What the form holds, as `calls.ts` takes it. */
function formOf(event: FormEvent<HTMLFormElement>, manual: boolean): PocketForm {
  const data = new FormData(event.currentTarget);
  const value = (key: string) => String(data.get(key) ?? "").trim();
  return {
    name: value("name"),
    accountId: value("account") || null,
    target: value("target"),
    monthly: manual ? "" : value("monthly"),
    // A pocket filled by hand keeps the day it has: the field is off and not sent.
    accrualDay: manual ? undefined : Number(value("day")),
    startMonth: `${value("start")}-01`,
  };
}

/** New pocket, or edit one (design modal "New pocket" / "Edit pocket"). */
export function PocketDialog({
  onClose,
  pocket,
  context,
}: {
  onClose: () => void;
  pocket: PocketDetail | null;
  context: DialogContext;
}) {
  const text = useTranslations("pockets");
  const id = useId();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [manual, setManual] = useState(pocket !== null && pocket.monthly === null);
  const { error, report } = usePocketError();
  // The accounts a pocket can rest on: the Pockets page has read them already, a pocket's page reads
  // them when the dialog opens.
  const accounts = useApi(pockets.listPockets, {}).data?.accounts;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = formOf(event, manual);
    startTransition(async () => {
      const result = pocket ? await updatePocket(pocket.id, form) : await createPocket(form);
      if (!report(result)) return;
      notify(text("toasts.saved"));
      onClose();
      if (!pocket && "id" in result) router.push(`/pockets/${result.id}`);
    });
  }

  if (!accounts) return null;
  return (
    <FormDialog
      onClose={onClose}
      title={pocket ? text("form.editTitle") : text("form.newTitle")}
      description={text("form.description")}
      width={520}
      onSubmit={onSubmit}
      error={error}
      pending={pending}
      cancelLabel={text("form.cancel")}
      submitLabel={text("form.save")}
      className="grid grid-cols-2 gap-3 max-sm:grid-cols-1"
    >
      <NameFields id={id} pocket={pocket} accounts={accounts} />
      <AmountFields id={id} pocket={pocket} context={context} manual={manual} onManual={setManual} />
      <AccrualDayField id={id} pocket={pocket} manual={manual} />
      <Field label={text("form.startMonth")} htmlFor={`${id}-start`}>
        <Input
          id={`${id}-start`}
          name="start"
          type="month"
          required
          defaultValue={(pocket?.startMonth ?? context.thisMonth).slice(0, 7)}
        />
      </Field>
      <p className="col-span-full text-sm text-muted">{text("form.note")}</p>
    </FormDialog>
  );
}
