"use client";

// «New plan» and «Edit plan» of a manual portfolio (PERS-681 §7): a basket of 1-10 instruments with
// a percentage each, the amount of each execution in the portfolio's currency, a cadence, an end, a
// fee per purchase and a debit account. A plan made changes from its next execution; a converted plan
// gets its amount here («Set amount»). The weights are checked as typed before any write.
import { useTranslations } from "next-intl";
import { type FormEvent, type RefObject, useId, useState, useTransition } from "react";
import type { NumberFormat } from "@ledgerly/format/format";
import { Field } from "@ledgerly/ui/field";
import { FormDialog } from "@ledgerly/ui/form-dialog";
import { Input } from "@ledgerly/ui/input";
import { notify } from "@ledgerly/ui/toast";
import { createPlan, type PlanFee, type PlanForm, updatePlan } from "../../plan-calls";
import { FORM_GRID, type ServiceContext, useInvestmentResult } from "../dialog-kit";
import { AmountField, DebitField, EndFields, FeeFields, type Patch, ScheduleFields } from "./plan-fields";
import { InstrumentsFields } from "./plan-instruments";
import { basketProblem, type Plan, typedDecimal } from "./plan-words";

function feeOf(fee: Plan["fee"], format: NumberFormat): PlanFee {
  if (fee === null) return { kind: "none", value: "" };
  if (fee.amount !== null) return { kind: "amount", value: typedDecimal(fee.amount, format) };
  return { kind: "rate", value: typedDecimal(fee.rate, format) };
}

/** A new plan: monthly, from today, with no instrument yet. */
function blank(context: ServiceContext): PlanForm {
  return {
    name: "",
    amount: "",
    instruments: [],
    frequency: "month",
    interval: "1",
    day: "",
    startOn: context.today,
    end: "never",
    endOn: "",
    runsLimit: "",
    debitAccountId: "",
    fee: feeOf(null, context.numberFormat),
  };
}

/** A plan as it is now. A plan of R5d's quarters reads as every 3 months. */
function formOf(plan: Plan, format: NumberFormat): PlanForm {
  const { frequency } = plan;
  const quarter = frequency === "quarter";
  return {
    name: plan.name,
    amount: typedDecimal(plan.amount, format),
    instruments: plan.instruments.map((one) => ({
      key: one.assetId,
      name: one.name,
      weight: typedDecimal(one.weight, format),
      assetId: one.assetId,
      instrumentId: one.instrumentId,
      mic: one.mic,
    })),
    frequency: frequency === "quarter" ? "month" : frequency,
    interval: String(plan.interval * (quarter ? 3 : 1)),
    day: String(plan.day),
    startOn: plan.startOn,
    end: plan.endOn ? "date" : plan.runsLimit ? "count" : "never",
    endOn: plan.endOn ?? "",
    runsLimit: plan.runsLimit ? String(plan.runsLimit) : "",
    debitAccountId: plan.debitAccountId ?? "",
    fee: feeOf(plan.fee, format),
  };
}

function useSave(context: ServiceContext, plan: Plan | null, before: PlanForm, onClose: () => void) {
  const text = useTranslations("investments.plans");
  const [pending, startTransition] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);
  const { error, report } = useInvestmentResult();
  const save = (form: PlanForm) => {
    const refused = basketProblem(form.instruments, context.numberFormat);
    setProblem(refused === null ? null : text(`form.problems.${refused}`));
    if (refused !== null) return;
    startTransition(async () => {
      const result =
        plan === null
          ? await createPlan(context.accountId, form)
          : await updatePlan(context.accountId, plan.id, form, before);
      if (!report(result)) return;
      notify(text(plan === null ? "created" : "saved"));
      onClose();
    });
  };
  return { pending, error: problem ?? error, save };
}

/** The fields after the name: the amount, the instruments, the cadence, the end, the fee, the debit. */
function PlanFields({
  id,
  form,
  set,
  currency,
  context,
  isNew,
}: {
  id: string;
  form: PlanForm;
  set: Patch<PlanForm>;
  currency: string;
  context: ServiceContext;
  isNew: boolean;
}) {
  return (
    <>
      <AmountField id={id} form={form} set={set} currency={currency} />
      <InstrumentsFields
        id={id}
        rows={form.instruments}
        onChange={(instruments) => set({ instruments })}
        format={context.numberFormat}
      />
      <ScheduleFields id={id} form={form} set={set} today={isNew ? context.today : null} />
      <EndFields id={id} form={form} set={set} />
      <FeeFields id={id} form={form} set={set} currency={currency} />
      <DebitField id={id} form={form} set={set} />
    </>
  );
}

export function PlanDialog({
  context,
  plan,
  onClose,
  opener,
}: {
  context: ServiceContext;
  plan: Plan | null;
  onClose: () => void;
  opener?: RefObject<HTMLElement | null>;
}) {
  const text = useTranslations("investments.plans");
  const id = useId();
  const [before] = useState(() => (plan === null ? blank(context) : formOf(plan, context.numberFormat)));
  const [form, setForm] = useState(before);
  const set: Patch<PlanForm> = (patch) => setForm((current) => ({ ...current, ...patch }));
  const { pending, error, save } = useSave(context, plan, before, onClose);
  // A plan's amounts are in its portfolio's currency.
  const currency = plan?.currency ?? context.currency;
  return (
    <FormDialog
      onClose={onClose}
      title={
        plan === null
          ? text("form.newTitle", { name: context.name })
          : text("form.editTitle", { name: plan.name })
      }
      description={plan === null ? text("form.newDescription") : text("form.editDescription")}
      width={520}
      className={FORM_GRID}
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        save(form);
      }}
      error={error}
      pending={pending}
      cancelLabel={text("form.cancel")}
      submitLabel={plan === null ? text("form.create") : text("form.save")}
      finalFocus={opener}
    >
      <div className="col-span-full">
        <Field label={text("form.name")} htmlFor={`${id}-name`}>
          <Input
            id={`${id}-name`}
            required
            maxLength={80}
            value={form.name}
            onChange={(event) => set({ name: event.target.value })}
          />
        </Field>
      </div>
      <PlanFields id={id} form={form} set={set} currency={currency} context={context} isNew={plan === null} />
    </FormDialog>
  );
}
