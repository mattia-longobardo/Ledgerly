"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { type FormEvent, type RefObject, useId, useRef, useState, useTransition } from "react";
import type { NumberFormat } from "@ledgerly/format/format";
import { Button } from "@ledgerly/ui/button";
import { Field } from "@ledgerly/ui/field";
import { Input } from "@ledgerly/ui/input";
import { Modal } from "@ledgerly/ui/modal";
import { notify } from "@ledgerly/ui/toast";
import { deleteContributionAction, saveContributionAction } from "../calls";
import type { ContributionForm } from "@ledgerly/domain/funds/client";
import {
  AmountField,
  FeeFields,
  KindField,
  MovementField,
  NoteField,
  OperationField,
  PayrollAmounts,
  PeriodField,
} from "./contribution-fields";
import { amountsOf, type FieldName, operationOf, problemsOf } from "./contribution-model";
import { ErrorLine, errorKey } from "./fund-forms";

type Kind = ContributionForm["kind"];

/** Everything "Record contribution" needs about a fund, prepared once by the server. */
export interface ContributionSetup {
  fundId: string;
  fundName: string;
  today: string;
  format: NumberFormat;
  /** The form each kind opens with: today, the fee the fund's list says, the oldest period still on the way. */
  defaults: Record<Kind, ContributionForm>;
  /** The kind the dialog opens on (§8.1). */
  kind: "voluntary" | "payroll";
  /** Whether the fund has a payslip source: only then a payslip contribution has a period to name. */
  hasPayroll: boolean;
  /** The periods of the payslip source, newest first, as `<year>-<index>`. */
  periods: readonly { value: string; label: string }[];
  /** The movements a voluntary contribution can be tied to. */
  movements: readonly { id: string; label: string }[];
}

/**
 * "Record contribution" and its edit (docs/design/rewrite-plan/ux/n6-pension-fund.md §8.1): one
 * dialog for a voluntary payment, a contribution of the payslip written as the fund reports it, and
 * the operations that are not a contribution — joining, a transfer in, a change of compartment, an exit.
 */
function ContributionDialog({
  setup,
  initial,
  locked = false,
  open,
  onOpenChange,
  finalFocus,
}: {
  setup: ContributionSetup;
  /** The operation to edit; `null` records a new one. */
  initial: ContributionForm | null;
  /** True for a contribution the app found among the movements: it stays a voluntary one, on its movement. */
  locked?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  finalFocus?: RefObject<HTMLElement | null>;
}) {
  const text = useTranslations("funds");
  const id = useId();
  const { format } = setup;
  const [form, setForm] = useState<ContributionForm>(initial ?? setup.defaults[setup.kind]);
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const fields = useRef<HTMLFormElement>(null);
  const set = (patch: Partial<ContributionForm>) => setForm((current) => ({ ...current, ...patch }));

  const editing = form.id !== null;
  const { kind } = form;
  const { moneyless, joining } = operationOf(form);
  const withPeriod = setup.hasPayroll && setup.periods.length > 0;
  const bound = { id, form, set };
  const periodField = <PeriodField {...bound} periods={setup.periods} />;

  function save() {
    startTransition(async () => {
      const result = await saveContributionAction(setup.fundId, {
        ...form,
        amount: moneyless ? "" : form.amount,
        fee: form.feeUnknown ? "" : form.fee,
      });
      if (result.ok) {
        notify(text("toasts.deposit"));
        router.refresh();
        onOpenChange(false);
      } else if (result.error === "movement_taken") {
        setErrors({ movement: text("errors.movement_taken") });
      } else if (result.error === "future_date") {
        setErrors({ on: text("errors.future_date") });
      } else {
        setFailure(text(errorKey(result.error)));
      }
    });
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const problems = problemsOf(form, setup.today, format);
    const found = Object.fromEntries(Object.entries(problems).map(([name, key]) => [name, text(key)]));
    setErrors(found);
    setFailure(null);
    const first = (["on", "amount", "components", "fee"] as const).find((name) => problems[name]);
    if (first) {
      fields.current?.querySelector<HTMLElement>(`[data-field="${first}"]`)?.focus();
      return;
    }
    save();
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      finalFocus={finalFocus}
      title={editing ? text("contribution.editTitle") : text("contribution.title", { name: setup.fundName })}
      width={520}
    >
      <form
        ref={fields}
        onSubmit={onSubmit}
        noValidate
        data-testid="contribution-form"
        className="grid grid-cols-2 gap-3 max-sm:grid-cols-1"
      >
        <KindField
          kind={kind}
          locked={locked}
          onChange={(next) =>
            // In an edit the amounts typed stay; a new form starts again from the kind's own defaults.
            setForm((current) =>
              editing
                ? { ...current, kind: next }
                : { ...setup.defaults[next], on: current.on, note: current.note },
            )
          }
        />
        {kind === "other" && <OperationField {...bound} />}
        <Field label={text("contribution.date")} htmlFor={`${id}-on`} error={errors.on}>
          <Input
            id={`${id}-on`}
            data-field="on"
            type="date"
            required
            max={setup.today}
            value={form.on}
            onChange={(event) => set({ on: event.target.value })}
          />
        </Field>
        {joining && withPeriod && periodField}
        {kind === "payroll" ? (
          <>
            {withPeriod ? periodField : <span className="max-sm:hidden" />}
            <PayrollAmounts {...bound} error={errors.components} />
          </>
        ) : moneyless ? (
          <span className="max-sm:hidden" />
        ) : (
          <AmountField {...bound} error={errors.amount} />
        )}
        <FeeFields {...bound} error={errors.fee} invested={amountsOf(form, format).invested} />
        {kind === "voluntary" && !locked && (
          <MovementField {...bound} error={errors.movement} movements={setup.movements} />
        )}
        <NoteField {...bound} />
        <ErrorLine error={failure} />
        <div className="col-span-full flex justify-end gap-2">
          <Button onClick={() => onOpenChange(false)}>{text("contribution.cancel")}</Button>
          <Button type="submit" variant="primary" disabled={pending}>
            {text("contribution.save")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** A button that opens the dialog, and the dialog: a new form each time it opens. */
function Opener({
  setup,
  initial,
  locked,
  label,
  ariaLabel,
  variant,
  size,
}: {
  setup: ContributionSetup;
  initial: ContributionForm | null;
  locked?: boolean;
  label: string;
  ariaLabel?: string;
  variant: "primary" | "secondary" | "ghost";
  size: "xs" | "sm" | "md" | "lg";
}) {
  const [open, setOpen] = useState(false);
  const [round, setRound] = useState(0);
  const opener = useRef<HTMLButtonElement>(null);
  return (
    <>
      <Button
        ref={opener}
        variant={variant}
        size={size}
        aria-label={ariaLabel}
        onClick={() => {
          setRound((current) => current + 1);
          setOpen(true);
        }}
      >
        {label}
      </Button>
      <ContributionDialog
        key={round}
        setup={setup}
        initial={initial}
        locked={locked}
        open={open}
        onOpenChange={setOpen}
        finalFocus={opener}
      />
    </>
  );
}

/** "Record contribution": in the page header, in the register's header and in the empty states. */
export function ContributionButton({
  setup,
  label,
  variant = "secondary",
  size = "sm",
}: {
  setup: ContributionSetup;
  label: string;
  variant?: "primary" | "secondary";
  size?: "sm" | "md" | "lg";
}) {
  return <Opener setup={setup} initial={null} label={label} variant={variant} size={size} />;
}

/** "Edit" on a line of the register. */
export function EditContributionButton({
  setup,
  form,
  locked = false,
  label,
  ariaLabel,
}: {
  setup: ContributionSetup;
  form: ContributionForm;
  locked?: boolean;
  label: string;
  ariaLabel: string;
}) {
  return (
    <Opener
      setup={setup}
      initial={form}
      locked={locked}
      label={label}
      ariaLabel={ariaLabel}
      variant="ghost"
      size="xs"
    />
  );
}

/** "Delete" on a line written by hand: it asks first, then says what happened. */
export function DeleteContributionButton({
  fundId,
  operationId,
  date,
  label,
  ariaLabel,
}: {
  fundId: string;
  operationId: string;
  /** The day of the contribution, as the page writes it. */
  date: string;
  label: string;
  ariaLabel: string;
}) {
  const t = useTranslations("funds");
  const [open, setOpen] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const opener = useRef<HTMLButtonElement>(null);
  return (
    <>
      <Button
        ref={opener}
        size="xs"
        variant="danger"
        aria-label={ariaLabel}
        onClick={() => {
          setFailure(null);
          setOpen(true);
        }}
      >
        {label}
      </Button>
      <Modal
        open={open}
        onOpenChange={setOpen}
        finalFocus={opener}
        title={t("contribution.delete.title")}
        description={t("contribution.delete.text", { date })}
        width={420}
      >
        <ErrorLine error={failure} />
        <div className="flex justify-end gap-2">
          <Button onClick={() => setOpen(false)}>{t("contribution.cancel")}</Button>
          <Button
            variant="danger"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await deleteContributionAction(fundId, operationId);
                if (!result.ok) {
                  setFailure(t(errorKey(result.error)));
                  return;
                }
                notify(t("toasts.depositDeleted"));
                router.refresh();
                setOpen(false);
              })
            }
          >
            {t("contribution.delete.confirm")}
          </Button>
        </div>
      </Modal>
    </>
  );
}
