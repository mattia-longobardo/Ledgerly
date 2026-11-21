"use client";

// The fields of "Record contribution" (rewrite plan, ux/n6-pension-fund.md §8.1), each bound to the
// form the dialog holds.
import { useTranslations } from "next-intl";
import type { ContributionForm } from "@ledgerly/domain/funds/client";
import { Field } from "@ledgerly/ui/field";
import { Checkbox, Input, Select } from "@ledgerly/ui/input";
import { Segmented } from "@ledgerly/ui/segmented";

type Kind = ContributionForm["kind"];
type Set = (patch: Partial<ContributionForm>) => void;

interface Bound {
  id: string;
  form: ContributionForm;
  set: Set;
}

/** The operations that are not a contribution, in the order the dialog offers them. */
const OTHER_CLASSES: readonly ContributionForm["classification"][] = [
  "enrollment",
  "transfer_in",
  "switch",
  "withdrawal",
];

/** Voluntary, payslip or another operation; a contribution found among the movements stays voluntary. */
export function KindField({
  kind,
  locked,
  onChange,
}: {
  kind: Kind;
  locked: boolean;
  onChange: (next: Kind) => void;
}) {
  const text = useTranslations("funds.contribution");
  return (
    <div className="col-span-full flex flex-col gap-1.5">
      <span className="text-sm font-medium">{text("kind")}</span>
      <Segmented
        label={text("kind")}
        value={kind}
        onChange={onChange}
        options={(["voluntary", "payroll", "other"] as const).map((value) => ({
          value,
          label: text(`kinds.${value}`),
          disabled: locked && value !== "voluntary",
        }))}
      />
      {kind === "payroll" && <p className="text-sm text-muted">{text("payrollHelp")}</p>}
    </div>
  );
}

/** Which operation, when it is not a contribution. */
export function OperationField({ id, form, set }: Bound) {
  const text = useTranslations("funds");
  return (
    <div className="col-span-full">
      <Field
        label={text("contribution.operation")}
        htmlFor={`${id}-class`}
        hint={text("contribution.otherHelp")}
      >
        <Select
          id={`${id}-class`}
          value={form.classification}
          onChange={(event) =>
            set({
              classification: OTHER_CLASSES.find((one) => one === event.target.value) ?? form.classification,
            })
          }
        >
          {OTHER_CLASSES.map((value) => (
            <option key={value} value={value}>
              {text(`pension.classes.${value}`)}
            </option>
          ))}
        </Select>
      </Field>
    </div>
  );
}

/** The period of the payslip source the operation belongs to. */
export function PeriodField({
  id,
  form,
  set,
  periods,
}: Bound & { periods: readonly { value: string; label: string }[] }) {
  const text = useTranslations("funds.contribution");
  return (
    <Field label={text("period")} htmlFor={`${id}-period`}>
      <Select
        id={`${id}-period`}
        value={form.period}
        onChange={(event) => set({ period: event.target.value })}
      >
        <option value="">{text("noPeriod")}</option>
        {/* A period older than the list still has to read as itself in an edit. */}
        {form.period !== "" && !periods.some((one) => one.value === form.period) && (
          <option value={form.period}>{form.period}</option>
        )}
        {periods.map((one) => (
          <option key={one.value} value={one.value}>
            {one.label}
          </option>
        ))}
      </Select>
    </Field>
  );
}

/** The three components of a payslip contribution, as the fund reports them. */
export function PayrollAmounts({ id, form, set, error }: Bound & { error: string | undefined }) {
  const text = useTranslations("funds");
  return (
    <fieldset className="col-span-full grid grid-cols-3 gap-3 max-sm:grid-cols-1">
      <legend className="sr-only">{text("contribution.amount")}</legend>
      {(["worker", "employer", "tfr"] as const).map((name, index) => (
        <Field key={name} label={text(`fund.contributions.components.${name}`)} htmlFor={`${id}-${name}`}>
          <Input
            id={`${id}-${name}`}
            data-field={index === 0 ? "components" : undefined}
            inputMode="decimal"
            numeric
            autoComplete="off"
            value={form[name]}
            onChange={(event) => set({ [name]: event.target.value })}
          />
        </Field>
      ))}
      {error && (
        <p role="alert" className="col-span-full text-sm text-neg">
          {error}
        </p>
      )}
    </fieldset>
  );
}

export function AmountField({ id, form, set, error }: Bound & { error: string | undefined }) {
  const text = useTranslations("funds.contribution");
  return (
    <Field label={text("amount")} htmlFor={`${id}-amount`} error={error}>
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
  );
}

/** The fee, or "fee unknown", and what goes into the fund once it is paid. */
export function FeeFields({
  id,
  form,
  set,
  error,
  invested,
}: Bound & { error: string | undefined; invested: string }) {
  const text = useTranslations("funds.contribution");
  return (
    <>
      <Field label={text("fee")} htmlFor={`${id}-fee`} error={error}>
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
          label={text("feeUnknown")}
          checked={form.feeUnknown}
          onChange={(event) => set({ feeUnknown: event.target.checked })}
        />
        {form.kind !== "other" && (
          <p
            aria-live="polite"
            data-testid="contribution-invested"
            className="text-sm text-muted tabular-nums"
          >
            {text("invested", { amount: invested })}
          </p>
        )}
      </div>
    </>
  );
}

/** The movement a voluntary contribution is tied to. */
export function MovementField({
  id,
  form,
  set,
  error,
  movements,
}: Bound & { error: string | undefined; movements: readonly { id: string; label: string }[] }) {
  const text = useTranslations("funds.contribution");
  const linked = form.transactionId !== "" && !movements.some((one) => one.id === form.transactionId);
  return (
    <div className="col-span-full">
      <Field label={text("movement")} htmlFor={`${id}-movement`} error={error}>
        <Select
          id={`${id}-movement`}
          value={form.transactionId}
          onChange={(event) => set({ transactionId: event.target.value })}
        >
          <option value="">{text("noMovement")}</option>
          {linked && <option value={form.transactionId}>{text("currentMovement")}</option>}
          {movements.map((movement) => (
            <option key={movement.id} value={movement.id}>
              {movement.label}
            </option>
          ))}
        </Select>
      </Field>
    </div>
  );
}

export function NoteField({ id, form, set }: Bound) {
  const text = useTranslations("funds.contribution");
  return (
    <div className="col-span-full">
      <Field label={text("note")} htmlFor={`${id}-note`}>
        <Input
          id={`${id}-note`}
          maxLength={200}
          value={form.note}
          onChange={(event) => set({ note: event.target.value })}
        />
      </Field>
    </div>
  );
}
