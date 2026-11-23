"use client";

// «Confirm» an instalment (R5d, step 2; §11.3.2): the purchase the server proposes, already filled in,
// that the person corrects — its day, quantity, price or fee — before it is written as by hand, never a
// deposit (P1 B). Only the fields changed go as corrections. With no cash (`negative_cash`) the form
// offers «Record a deposit» on the instalment's day (P2 A).
import { useTranslations } from "next-intl";
import { type FormEvent, useId, useState, useTransition } from "react";
import { formatDate } from "@ledgerly/format/format";
import { Button } from "@ledgerly/ui/button";
import { FormDialog } from "@ledgerly/ui/form-dialog";
import { DateField, MoneyField, NumberField } from "@ledgerly/ui/form-fields";
import { notify } from "@ledgerly/ui/toast";
import { confirmRun, type RunConfirmation } from "../../plan-calls";
import { FORM_GRID, useErrorText } from "../dialog-kit";
import type { ServicePage } from "../service/service-view";
import { type Plan, type Run, typedDecimal } from "./plan-words";

/** The proposal as the form shows it. */
function proposed(run: Run, page: ServicePage): RunConfirmation {
  const { format } = page.say;
  return {
    on: run.proposal?.on ?? run.priceOn ?? run.dueOn,
    quantity: typedDecimal(run.proposal?.quantity ?? null, format),
    unitPrice: typedDecimal(run.proposal?.unitPrice ?? run.price, format),
    fee: typedDecimal(run.proposal?.fee ?? null, format),
  };
}

/** What the person changed: a field left as proposed is no correction. */
function corrections(typed: RunConfirmation, initial: RunConfirmation): RunConfirmation {
  const changed = (key: keyof RunConfirmation) => (typed[key] === initial[key] ? "" : typed[key]);
  return {
    on: changed("on"),
    quantity: changed("quantity"),
    unitPrice: changed("unitPrice"),
    fee: changed("fee"),
  };
}

function useConfirm(page: ServicePage, plan: Plan, run: Run, onClose: () => void) {
  const text = useTranslations("investments.plans");
  const [initial] = useState(() => proposed(run, page));
  const [typed, setTyped] = useState(initial);
  const [refused, setRefused] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    startTransition(async () => {
      const ref = { accountId: page.id, planId: plan.id, runId: run.id };
      const result = await confirmRun(ref, corrections(typed, initial));
      if (!result.ok) {
        setRefused(result.error);
        return;
      }
      notify(text("confirmed"));
      onClose();
    });
  };
  const set = (patch: Partial<RunConfirmation>) => setTyped((current) => ({ ...current, ...patch }));
  return { typed, set, refused, pending, onSubmit };
}

/** The figures of the proposal in the asset's currency the person may correct. */
const MONEY = ["unitPrice", "fee"] as const;

/** No cash for the purchase (P2 A): a deposit first, on the instalment's day. */
function NoCash({ onDeposit }: { onDeposit: () => void }) {
  const text = useTranslations("investments.plans");
  return (
    <div className="col-span-full flex flex-col items-start gap-2">
      <p className="text-sm text-muted">{text("noCash")}</p>
      <Button size="sm" onClick={onDeposit}>
        {text("recordDeposit")}
      </Button>
    </div>
  );
}

export function ConfirmRunDialog({
  page,
  plan,
  run,
  onClose,
  onDeposit,
}: {
  page: ServicePage;
  plan: Plan;
  run: Run;
  onClose: () => void;
  /** «Record a deposit» on the instalment's day: the portfolio has not the cash for it. */
  onDeposit: (day: string) => void;
}) {
  const text = useTranslations("investments.plans");
  const errorText = useErrorText();
  const id = useId();
  const form = useConfirm(page, plan, run, onClose);
  const { typed, set } = form;
  return (
    <FormDialog
      onClose={onClose}
      title={text("confirm.title", { name: plan.name, date: formatDate(run.dueOn, "long", page.say.locale) })}
      description={text(run.proposal ? "confirm.description" : "confirm.descriptionNoPrice")}
      width={520}
      className={FORM_GRID}
      onSubmit={form.onSubmit}
      error={form.refused === null ? null : errorText(form.refused)}
      pending={form.pending}
      cancelLabel={text("form.cancel")}
      submitLabel={text("confirm.submit")}
    >
      <DateField
        id={`${id}-on`}
        label={text("confirm.on")}
        value={typed.on}
        onChange={(day) => set({ on: day })}
        max={page.say.todayOn}
      />
      <NumberField
        id={`${id}-quantity`}
        label={text("confirm.quantity")}
        value={typed.quantity}
        onChange={(quantity) => set({ quantity })}
      />
      {MONEY.map((key) => (
        <MoneyField
          key={key}
          id={`${id}-${key}`}
          label={text(`confirm.${key}`)}
          value={typed[key]}
          onChange={(value) => set({ [key]: value })}
          currency={run.currency}
        />
      ))}
      {(form.refused === "negative_cash" || run.reason === "negative_cash") && (
        <NoCash onDeposit={() => onDeposit(typed.on)} />
      )}
    </FormDialog>
  );
}
