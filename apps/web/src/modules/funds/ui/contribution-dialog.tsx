"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, type RefObject, useId, useRef, useState, useTransition } from "react";
import { parseAmount } from "@ledgerly/domain/accounts/client";
import { formatMoney, type NumberFormat, NULL_DISPLAY } from "@ledgerly/domain/platform/format";
import type { Cents } from "@ledgerly/domain/platform/money";
import { Button } from "@/ui/button";
import { Field } from "@/ui/field";
import { Checkbox, Input, Select } from "@/ui/input";
import { Modal } from "@/ui/modal";
import { Segmented } from "@/ui/segmented";
import { notify } from "@/ui/toast";
import { deleteContributionAction, saveContributionAction } from "../actions";
import type { ContributionForm } from "@ledgerly/domain/funds/client";
import { ErrorLine, errorKey } from "./fund-forms";

type Kind = ContributionForm["kind"];

/** The operations that are not a contribution, in the order the dialog offers them. */
const OTHER_CLASSES: readonly ContributionForm["classification"][] = [
  "enrollment",
  "transfer_in",
  "switch",
  "withdrawal",
];

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

type FieldName = "on" | "amount" | "components" | "fee" | "movement";

/** An amount as typed: its cents, `0n` for an empty field, `null` for text that is not an amount. */
function cents(text: string, format: NumberFormat): Cents | null {
  if (text.trim() === "") return 0n;
  try {
    return parseAmount(text, format);
  } catch {
    return null;
  }
}

/**
 * "Record contribution" and its edit (docs/design/rewrite-plan/ux/n6-pension-fund.md §8.1): one
 * dialog for a voluntary payment, a contribution of the payslip written as the fund reports it, and
 * the operations that are not a contribution — joining, a transfer in, a change of compartment, an exit.
 */
export function ContributionDialog({
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
  const t = useTranslations("funds");
  const id = useId();
  const { format } = setup;
  const [form, setForm] = useState<ContributionForm>(initial ?? setup.defaults[setup.kind]);
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fields = useRef<HTMLFormElement>(null);
  const set = (patch: Partial<ContributionForm>) => setForm((current) => ({ ...current, ...patch }));

  const editing = form.id !== null;
  const { kind } = form;
  const moneyless = kind === "other" && form.classification === "switch";
  /** Joining names the period whose payslips accrued the enrolment quota, as a payslip contribution does. */
  const joining = kind === "other" && form.classification === "enrollment";
  const withPeriod = setup.hasPayroll && setup.periods.length > 0;
  const periodField = (
    <Field label={t("contribution.period")} htmlFor={`${id}-period`}>
      <Select
        id={`${id}-period`}
        value={form.period}
        onChange={(event) => set({ period: event.target.value })}
      >
        <option value="">{t("contribution.noPeriod")}</option>
        {/* A period older than the list still has to read as itself in an edit. */}
        {form.period !== "" && !setup.periods.some((one) => one.value === form.period) && (
          <option value={form.period}>{form.period}</option>
        )}
        {setup.periods.map((one) => (
          <option key={one.value} value={one.value}>
            {one.label}
          </option>
        ))}
      </Select>
    </Field>
  );
  const exit = kind === "other" && form.classification === "withdrawal";

  const worker = cents(form.worker, format);
  const employer = cents(form.employer, format);
  const tfr = cents(form.tfr, format);
  const gross =
    kind === "payroll"
      ? worker === null || employer === null || tfr === null
        ? null
        : worker + employer + tfr
      : moneyless
        ? 0n
        : cents(form.amount, format);
  const fee = form.feeUnknown ? 0n : cents(form.fee, format);
  const invested =
    form.feeUnknown || gross === null || fee === null || gross === 0n
      ? NULL_DISPLAY
      : formatMoney(gross - fee, format);

  function check(): Partial<Record<FieldName, string>> {
    const found: Partial<Record<FieldName, string>> = {};
    if (form.on === "" || form.on > setup.today) found.on = t("errors.future_date");
    if (kind === "payroll") {
      if (gross === null || gross <= 0n) found.components = t("contribution.errors.components");
    } else if (!moneyless && (gross === null || gross <= 0n)) {
      found.amount = t("contribution.errors.amount");
    }
    if (fee === null || fee < 0n) found.fee = t("contribution.errors.fee");
    // An exit's fee is not taken from what left the fund, and a change of compartment has no amount.
    else if (!moneyless && !exit && gross !== null && gross > 0n && fee > gross)
      found.fee = t("contribution.errors.fee");
    return found;
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const found = check();
    setErrors(found);
    setFailure(null);
    const first = (["on", "amount", "components", "fee"] as const).find((name) => found[name]);
    if (first) {
      fields.current?.querySelector<HTMLElement>(`[data-field="${first}"]`)?.focus();
      return;
    }
    startTransition(async () => {
      const result = await saveContributionAction(setup.fundId, {
        ...form,
        amount: moneyless ? "" : form.amount,
        fee: form.feeUnknown ? "" : form.fee,
      });
      if (result.ok) {
        notify(t("toasts.deposit"));
        onOpenChange(false);
      } else if (result.error === "movement_taken") {
        setErrors({ movement: t("errors.movement_taken") });
      } else if (result.error === "future_date") {
        setErrors({ on: t("errors.future_date") });
      } else {
        setFailure(t(errorKey(result.error)));
      }
    });
  }

  const linked = form.transactionId !== "" && !setup.movements.some((one) => one.id === form.transactionId);
  const amountField = (name: "worker" | "employer" | "tfr", first = false) => (
    <Field label={t(`fund.contributions.components.${name}`)} htmlFor={`${id}-${name}`}>
      <Input
        id={`${id}-${name}`}
        data-field={first ? "components" : undefined}
        inputMode="decimal"
        numeric
        autoComplete="off"
        value={form[name]}
        onChange={(event) => set({ [name]: event.target.value })}
      />
    </Field>
  );

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      finalFocus={finalFocus}
      title={editing ? t("contribution.editTitle") : t("contribution.title", { name: setup.fundName })}
      width={520}
    >
      <form
        ref={fields}
        onSubmit={onSubmit}
        noValidate
        data-testid="contribution-form"
        className="grid grid-cols-2 gap-3 max-sm:grid-cols-1"
      >
        <div className="col-span-full flex flex-col gap-1.5">
          <span className="text-sm font-medium">{t("contribution.kind")}</span>
          <Segmented
            label={t("contribution.kind")}
            value={kind}
            onChange={(next) =>
              // In an edit the amounts typed stay; a new form starts again from the kind's own defaults.
              setForm((current) =>
                editing
                  ? { ...current, kind: next }
                  : { ...setup.defaults[next], on: current.on, note: current.note },
              )
            }
            options={(["voluntary", "payroll", "other"] as const).map((value) => ({
              value,
              label: t(`contribution.kinds.${value}`),
              disabled: locked && value !== "voluntary",
            }))}
          />
          {kind === "payroll" && <p className="text-sm text-muted">{t("contribution.payrollHelp")}</p>}
        </div>

        {kind === "other" && (
          <div className="col-span-full">
            <Field
              label={t("contribution.operation")}
              htmlFor={`${id}-class`}
              hint={t("contribution.otherHelp")}
            >
              <Select
                id={`${id}-class`}
                value={form.classification}
                onChange={(event) =>
                  set({ classification: event.target.value as ContributionForm["classification"] })
                }
              >
                {OTHER_CLASSES.map((value) => (
                  <option key={value} value={value}>
                    {t(`pension.classes.${value}`)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        )}

        <Field label={t("contribution.date")} htmlFor={`${id}-on`} error={errors.on}>
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
            <fieldset className="col-span-full grid grid-cols-3 gap-3 max-sm:grid-cols-1">
              <legend className="sr-only">{t("contribution.amount")}</legend>
              {amountField("worker", true)}
              {amountField("employer")}
              {amountField("tfr")}
              {errors.components && (
                <p role="alert" className="col-span-full text-sm text-neg">
                  {errors.components}
                </p>
              )}
            </fieldset>
          </>
        ) : moneyless ? (
          <span className="max-sm:hidden" />
        ) : (
          <Field label={t("contribution.amount")} htmlFor={`${id}-amount`} error={errors.amount}>
            <Input
              id={`${id}-amount`}
              data-field="amount"
              inputMode="decimal"
              numeric
              required
              autoComplete="off"
              value={form.amount}
              onChange={(event) => set({ amount: event.target.value })}
            />
          </Field>
        )}

        <Field label={t("contribution.fee")} htmlFor={`${id}-fee`} error={errors.fee}>
          <Input
            id={`${id}-fee`}
            data-field="fee"
            inputMode="decimal"
            numeric
            autoComplete="off"
            disabled={form.feeUnknown}
            value={form.feeUnknown ? "" : form.fee}
            onChange={(event) => set({ fee: event.target.value })}
          />
        </Field>
        <div className="flex flex-col justify-end gap-1">
          <Checkbox
            label={t("contribution.feeUnknown")}
            checked={form.feeUnknown}
            onChange={(event) => set({ feeUnknown: event.target.checked })}
          />
          {kind !== "other" && (
            <p
              aria-live="polite"
              data-testid="contribution-invested"
              className="text-sm text-muted tabular-nums"
            >
              {t("contribution.invested", { amount: invested })}
            </p>
          )}
        </div>

        {kind === "voluntary" && !locked && (
          <div className="col-span-full">
            <Field label={t("contribution.movement")} htmlFor={`${id}-movement`} error={errors.movement}>
              <Select
                id={`${id}-movement`}
                value={form.transactionId}
                onChange={(event) => set({ transactionId: event.target.value })}
              >
                <option value="">{t("contribution.noMovement")}</option>
                {linked && <option value={form.transactionId}>{t("contribution.currentMovement")}</option>}
                {setup.movements.map((movement) => (
                  <option key={movement.id} value={movement.id}>
                    {movement.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        )}

        <div className="col-span-full">
          <Field label={t("contribution.note")} htmlFor={`${id}-note`}>
            <Input
              id={`${id}-note`}
              maxLength={200}
              value={form.note}
              onChange={(event) => set({ note: event.target.value })}
            />
          </Field>
        </div>

        <ErrorLine error={failure} />
        <div className="col-span-full flex justify-end gap-2">
          <Button onClick={() => onOpenChange(false)}>{t("contribution.cancel")}</Button>
          <Button type="submit" variant="primary" disabled={pending}>
            {t("contribution.save")}
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
