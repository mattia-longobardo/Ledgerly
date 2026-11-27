"use client";

// The fields of a plan's form (R5d; baskets, PERS-681 §7): the amount of each execution, how often,
// until when, from which account it is paid and its fee. Each field writes the text as typed;
// `plan-calls.ts` reads it. The instruments and their weights are `plan-instruments.tsx`.
import { useTranslations } from "next-intl";
import { accounts as accountRoutes } from "@ledgerly/api-contract/accounts";
import { AccountSelect } from "@ledgerly/ui/account-select";
import { useApi } from "@ledgerly/ui/data";
import { Field } from "@ledgerly/ui/field";
import { MoneyField, NumberField } from "@ledgerly/ui/form-fields";
import { Input, Select } from "@ledgerly/ui/input";
import type { PlanForm } from "../../plan-calls";
import { WEEKDAYS } from "./plan-words";

const FREQUENCIES = ["day", "week", "month"] as const;
const ENDS = ["never", "date", "count"] as const;
const FEES = ["none", "amount", "rate"] as const;

export type Patch<F> = (patch: Partial<F>) => void;

/** A choice of a closed list, each option in words. */
function ChoiceField<T extends string>({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <Field label={label} htmlFor={id}>
      <Select
        id={id}
        value={value}
        onChange={(event) =>
          onChange(options.find((one) => one.value === event.target.value)?.value ?? value)
        }
      >
        {options.map((one) => (
          <option key={one.value} value={one.value}>
            {one.label}
          </option>
        ))}
      </Select>
    </Field>
  );
}

/** A day of the plan: its start (today or later) or its last day. */
function DayInput({
  id,
  label,
  hint,
  min,
  value,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  min?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <Input
        id={id}
        type="date"
        required
        min={min}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}

/** The amount of each execution, in the portfolio's currency: fees are on top (D1). */
export function AmountField({
  id,
  form,
  set,
  currency,
}: {
  id: string;
  form: PlanForm;
  set: Patch<PlanForm>;
  currency: string;
}) {
  const text = useTranslations("investments.plans.form");
  return (
    <MoneyField
      id={`${id}-amount`}
      label={text("amount")}
      hint={text("amountHint")}
      value={form.amount}
      onChange={(amount) => set({ amount })}
      currency={currency}
    />
  );
}

/** The day of the execution: a day of the week, or of the month (the month's last when shorter). */
function DayField({ id, form, set }: { id: string; form: PlanForm; set: Patch<PlanForm> }) {
  const text = useTranslations("investments.plans");
  if (form.frequency === "day") return null;
  if (form.frequency === "week")
    return (
      <ChoiceField
        id={`${id}-day`}
        label={text("form.weekday")}
        value={WEEKDAYS.find((day) => day === form.day) ?? "1"}
        options={WEEKDAYS.map((day) => ({ value: day, label: text(`weekdays.${day}`) }))}
        onChange={(day) => set({ day })}
      />
    );
  return (
    <Field label={text("form.monthDay")} htmlFor={`${id}-day`} hint={text("form.monthDayHint")}>
      <Input
        id={`${id}-day`}
        inputMode="numeric"
        numeric
        value={form.day}
        onChange={(event) => set({ day: event.target.value })}
      />
    </Field>
  );
}

/** How often, on which day, and, for a new plan, from when: today or later. */
export function ScheduleFields({
  id,
  form,
  set,
  today,
}: {
  id: string;
  form: PlanForm;
  set: Patch<PlanForm>;
  /** A new plan's first day; a plan made keeps its start. */
  today: string | null;
}) {
  const text = useTranslations("investments.plans");
  return (
    <>
      <ChoiceField
        id={`${id}-frequency`}
        label={text("form.frequency")}
        value={form.frequency}
        options={FREQUENCIES.map((one) => ({ value: one, label: text(`frequencies.${one}`) }))}
        // A day of the month is no day of the week: the choice starts again.
        onChange={(frequency) => set({ frequency, day: frequency === "month" ? "" : "1" })}
      />
      <NumberField
        id={`${id}-interval`}
        label={text("form.interval")}
        value={form.interval}
        onChange={(interval) => set({ interval })}
      />
      <DayField id={id} form={form} set={set} />
      {today !== null && (
        <DayInput
          id={`${id}-start`}
          label={text("form.startOn")}
          hint={text("form.startOnHint")}
          min={today}
          value={form.startOn}
          onChange={(startOn) => set({ startOn })}
        />
      )}
    </>
  );
}

/** Until when: never, a day, or a number of executions. */
export function EndFields({ id, form, set }: { id: string; form: PlanForm; set: Patch<PlanForm> }) {
  const text = useTranslations("investments.plans.form");
  return (
    <>
      <ChoiceField
        id={`${id}-end`}
        label={text("end")}
        value={form.end}
        options={ENDS.map((one) => ({ value: one, label: text(`ends.${one}`) }))}
        onChange={(end) => set({ end })}
      />
      {form.end === "date" && (
        <DayInput
          id={`${id}-end-on`}
          label={text("endOn")}
          value={form.endOn}
          onChange={(endOn) => set({ endOn })}
        />
      )}
      {form.end === "count" && (
        <NumberField
          id={`${id}-runs`}
          label={text("runsLimit")}
          value={form.runsLimit}
          onChange={(runsLimit) => set({ runsLimit })}
        />
      )}
    </>
  );
}

/** The fee of each purchase (E3), outside the amount (D1): none, an amount, or a percentage. */
export function FeeFields({
  id,
  form,
  set,
  currency,
}: {
  id: string;
  form: PlanForm;
  set: Patch<PlanForm>;
  currency: string;
}) {
  const text = useTranslations("investments.plans.form");
  const { kind } = form.fee;
  return (
    <>
      <ChoiceField
        id={`${id}-fee-kind`}
        label={text("fee")}
        value={kind}
        options={FEES.map((one) => ({ value: one, label: text(`fees.${one}`) }))}
        onChange={(next) => set({ fee: { kind: next, value: "" } })}
      />
      {kind !== "none" && (
        <MoneyField
          id={`${id}-fee`}
          label={text(kind === "amount" ? "feeAmount" : "feeRate")}
          value={form.fee.value}
          onChange={(value) => set({ fee: { kind, value } })}
          currency={kind === "amount" ? currency : "%"}
        />
      )}
    </>
  );
}

/** The account the purchases are paid from: only to propose their bank movement, never a deposit (P1 B). */
export function DebitField({ id, form, set }: { id: string; form: PlanForm; set: Patch<PlanForm> }) {
  const text = useTranslations("investments.plans.form");
  const list = useApi(accountRoutes.listAccounts, { query: {} }).data?.accounts ?? [];
  return (
    <div className="col-span-full">
      <Field label={text("debit")} htmlFor={`${id}-debit`} hint={text("debitHint")}>
        <AccountSelect
          id={`${id}-debit`}
          accounts={list}
          none={text("noDebit")}
          value={form.debitAccountId}
          onChange={(event) => set({ debitAccountId: event.target.value })}
        />
      </Field>
    </div>
  );
}
