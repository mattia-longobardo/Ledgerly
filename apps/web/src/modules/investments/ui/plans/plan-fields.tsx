"use client";

// The fields of a plan's form (R5d, step 2; §11.3.1): what each instalment buys, how often, until
// when, from which account it is paid, its fee and its mode. Each field writes the text as typed;
// `plan-calls.ts` reads it.
import { useTranslations } from "next-intl";
import { accounts as accountRoutes } from "@ledgerly/api-contract/accounts";
import { AccountSelect } from "@ledgerly/ui/account-select";
import { useApi } from "@ledgerly/ui/data";
import { Field } from "@ledgerly/ui/field";
import { MoneyField, NumberField } from "@ledgerly/ui/form-fields";
import { Checkbox, Input, Select } from "@ledgerly/ui/input";
import { Segmented } from "@ledgerly/ui/segmented";
import type { PlanEdit, PlanForm } from "../../plan-calls";
import { WEEKDAYS } from "./plan-words";

const FREQUENCIES = ["week", "month", "quarter"] as const;
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

/** A day with no bound: a plan may start or end in the past or in the future. */
function DayInput({
  id,
  label,
  hint,
  value,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <Input id={id} type="date" required value={value} onChange={(event) => onChange(event.target.value)} />
    </Field>
  );
}

/** An amount or a quantity per instalment; an amount buys fractions unless the person says no (P3). */
export function SizeFields({
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
    <>
      <div className="col-span-full">
        <Segmented
          label={text("size")}
          value={form.size}
          onChange={(size) => set({ size })}
          options={[
            { value: "amount", label: text("byAmount") },
            { value: "quantity", label: text("byQuantity") },
          ]}
        />
      </div>
      {form.size === "amount" ? (
        <>
          <MoneyField
            id={`${id}-amount`}
            label={text("amount")}
            value={form.amount}
            onChange={(amount) => set({ amount })}
            currency={currency}
          />
          <div className="flex items-end">
            <Checkbox
              label={text("fractions")}
              checked={form.fractions}
              onChange={(event) => set({ fractions: event.target.checked })}
            />
          </div>
        </>
      ) : (
        <NumberField
          id={`${id}-quantity`}
          label={text("quantity")}
          value={form.quantity}
          onChange={(quantity) => set({ quantity })}
        />
      )}
    </>
  );
}

/** The day of the instalment: a day of the week, or of the month (the month's last when shorter). */
function DayField({ id, form, set }: { id: string; form: PlanForm; set: Patch<PlanForm> }) {
  const text = useTranslations("investments.plans");
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

/** How often, on which day, from when. A start in the past leaves its instalments to «Record the past instalments». */
export function ScheduleFields({ id, form, set }: { id: string; form: PlanForm; set: Patch<PlanForm> }) {
  const text = useTranslations("investments.plans");
  return (
    <>
      <ChoiceField
        id={`${id}-frequency`}
        label={text("form.frequency")}
        value={form.frequency}
        options={FREQUENCIES.map((one) => ({ value: one, label: text(`frequencies.${one}`) }))}
        // A day of the month is no day of the week: the choice starts again.
        onChange={(frequency) => set({ frequency, day: frequency === "week" ? "1" : "" })}
      />
      <NumberField
        id={`${id}-interval`}
        label={text("form.interval")}
        value={form.interval}
        onChange={(interval) => set({ interval })}
      />
      <DayField id={id} form={form} set={set} />
      <DayInput
        id={`${id}-start`}
        label={text("form.startOn")}
        hint={text("form.startOnHint")}
        value={form.startOn}
        onChange={(startOn) => set({ startOn })}
      />
    </>
  );
}

/** Until when: never, a day, or a number of instalments. */
export function EndFields({ id, form, set }: { id: string; form: PlanEdit; set: Patch<PlanEdit> }) {
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

/** The fee of each instalment (E3): none, an amount, or a percentage of what it spends. */
export function FeeFields({
  id,
  form,
  set,
  currency,
}: {
  id: string;
  form: PlanEdit;
  set: Patch<PlanEdit>;
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

/** The account the instalment is paid from: only to propose its bank movement, never a deposit (P1 B). */
export function DebitField({ id, form, set }: { id: string; form: PlanEdit; set: Patch<PlanEdit> }) {
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

/** Proposed for confirmation (the default, ST-5), or written by the job with the «automatic» mark. */
export function ModeField({ form, set }: { form: PlanEdit; set: Patch<PlanEdit> }) {
  const text = useTranslations("investments.plans");
  return (
    <div className="col-span-full flex flex-col gap-1">
      <Segmented
        label={text("form.mode")}
        value={form.mode}
        onChange={(mode) => set({ mode })}
        options={[
          { value: "propose", label: text("modes.propose") },
          { value: "auto", label: text("modes.auto") },
        ]}
      />
      <p className="text-sm text-muted">{text(`form.modeHints.${form.mode}`)}</p>
    </div>
  );
}
