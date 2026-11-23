"use client";

// «New plan» and «Edit plan» of a manual portfolio (R5d, step 2; §11.3.1). A new plan names its
// instrument, what each instalment buys and its schedule; once made, a plan changes its name, mode, end,
// debit account and fee only (`PATCH`): its instalments already written stay as they are.
import { useTranslations } from "next-intl";
import { type FormEvent, type RefObject, useId, useState, useTransition } from "react";
import type { NumberFormat } from "@ledgerly/format/format";
import { Field } from "@ledgerly/ui/field";
import { FormDialog } from "@ledgerly/ui/form-dialog";
import { Input } from "@ledgerly/ui/input";
import { notify } from "@ledgerly/ui/toast";
import { createPlan, type PlanEdit, type PlanFee, type PlanForm, updatePlan } from "../../plan-calls";
import { FORM_GRID, type ServiceContext, useInvestmentResult } from "../dialog-kit";
import { InstrumentField, type PickedInstrument } from "../portfolio/instrument-field";
import {
  DebitField,
  EndFields,
  FeeFields,
  ModeField,
  type Patch,
  ScheduleFields,
  SizeFields,
} from "./plan-fields";
import { type Plan, typedDecimal } from "./plan-words";

function feeOf(fee: Plan["fee"], format: NumberFormat): PlanFee {
  if (fee === null) return { kind: "none", value: "" };
  if (fee.amount !== null) return { kind: "amount", value: typedDecimal(fee.amount, format) };
  return { kind: "rate", value: typedDecimal(fee.rate, format) };
}

const NEW_EDIT: Omit<PlanEdit, "fee"> = {
  name: "",
  mode: "propose",
  end: "never",
  endOn: "",
  runsLimit: "",
  debitAccountId: "",
};

/** What a plan can change, as it is now. */
function editOf(plan: Plan, format: NumberFormat): PlanEdit {
  return {
    name: plan.name,
    mode: plan.mode,
    end: plan.endOn ? "date" : plan.runsLimit ? "count" : "never",
    endOn: plan.endOn ?? "",
    runsLimit: plan.runsLimit ? String(plan.runsLimit) : "",
    debitAccountId: plan.debitAccountId ?? "",
    fee: feeOf(plan.fee, format),
  };
}

/** The form of a plan as it is, or of a new one: an amount each month from today, with fractions (P3). */
function initial(plan: Plan | null, context: ServiceContext): PlanForm {
  return {
    ...(plan === null
      ? { ...NEW_EDIT, fee: feeOf(null, context.numberFormat) }
      : editOf(plan, context.numberFormat)),
    instrumentId: "",
    mic: null,
    size: "amount",
    amount: "",
    quantity: "",
    fractions: true,
    frequency: "month",
    interval: "1",
    day: "",
    startOn: context.today,
  };
}

/** The form's fields as typed, and the instrument picked, whose currency the amounts are in. */
function usePlanForm(plan: Plan | null, context: ServiceContext) {
  const [form, setForm] = useState(() => initial(plan, context));
  const [instrument, setInstrument] = useState<PickedInstrument | null>(null);
  const set: Patch<PlanForm> = (patch) => setForm((current) => ({ ...current, ...patch }));
  const pick = (picked: PickedInstrument | null) => {
    setInstrument(picked);
    set({ instrumentId: picked?.instrumentId ?? "", mic: picked?.mic ?? null });
  };
  // A plan made is in its own currency; a new one in its instrument's.
  return { form, set, pick, currency: instrument?.currency ?? plan?.currency ?? context.currency };
}

function useSave(context: ServiceContext, plan: Plan | null, onClose: () => void) {
  const text = useTranslations("investments.plans");
  const [pending, startTransition] = useTransition();
  const { error, report } = useInvestmentResult();
  const save = (form: PlanForm) =>
    startTransition(async () => {
      // A new plan with no instrument picked is not complete.
      if (plan === null && form.instrumentId === "") {
        report({ ok: false, error: "invalid" });
        return;
      }
      const result =
        plan === null
          ? await createPlan(context.accountId, form)
          : await updatePlan(context.accountId, plan.id, form);
      if (!report(result)) return;
      notify(text(plan === null ? "created" : "saved"));
      onClose();
    });
  return { pending, error, save };
}

/** The fields only a new plan has: its instrument, its size and its schedule. */
function NewPlanFields({
  id,
  form,
  set,
  currency,
  pick,
}: {
  id: string;
  form: PlanForm;
  set: Patch<PlanForm>;
  currency: string;
  pick: (picked: PickedInstrument | null) => void;
}) {
  return (
    <>
      <InstrumentField id={id} onChange={pick} />
      <SizeFields id={id} form={form} set={set} currency={currency} />
      <ScheduleFields id={id} form={form} set={set} />
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
  opener?: RefObject<HTMLButtonElement | null>;
}) {
  const text = useTranslations("investments.plans");
  const id = useId();
  const { form, set, pick, currency } = usePlanForm(plan, context);
  const { pending, error, save } = useSave(context, plan, onClose);
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
      {plan === null && <NewPlanFields id={id} form={form} set={set} currency={currency} pick={pick} />}
      <EndFields id={id} form={form} set={set} />
      <FeeFields id={id} form={form} set={set} currency={currency} />
      <DebitField id={id} form={form} set={set} />
      <ModeField form={form} set={set} />
    </FormDialog>
  );
}
