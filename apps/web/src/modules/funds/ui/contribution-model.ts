// What "Record contribution" works out from the form as it is typed (rewrite plan, ux/n6-pension-fund.md
// §8.1): the amounts it reads, what goes into the fund, and what is wrong before it is sent.
import { formatMoney, type NumberFormat, NULL_DISPLAY, parseAmount } from "@ledgerly/format/format";
import type { Cents } from "@ledgerly/domain/shared/money";
import type { ContributionForm } from "@ledgerly/domain/funds/client";

export type FieldName = "on" | "amount" | "components" | "fee" | "movement";

/** A field's message, by its key under `funds`. */
type Problem =
  | "errors.future_date"
  | "contribution.errors.components"
  | "contribution.errors.amount"
  | "contribution.errors.fee";

/** An amount as typed: its cents, `0n` for an empty field, `null` for text that is not an amount. */
function cents(text: string, format: NumberFormat): Cents | null {
  if (text.trim() === "") return 0n;
  try {
    return parseAmount(text, format);
  } catch {
    return null;
  }
}

/** What the operation is, beside its kind. */
export function operationOf(form: ContributionForm) {
  const other = form.kind === "other";
  return {
    /** A change of compartment moves no money. */
    moneyless: other && form.classification === "switch",
    /** Joining names the period whose payslips accrued the enrolment quota, as a payslip contribution does. */
    joining: other && form.classification === "enrollment",
    exit: other && form.classification === "withdrawal",
  };
}

/** What was paid: the three components of a payslip contribution, or the amount; `null` when unreadable. */
function grossOf(form: ContributionForm, format: NumberFormat): Cents | null {
  if (form.kind !== "payroll") return operationOf(form).moneyless ? 0n : cents(form.amount, format);
  const parts = [form.worker, form.employer, form.tfr].map((part) => cents(part, format));
  return parts.some((part) => part === null)
    ? null
    : parts.reduce<Cents>((sum, part) => sum + (part ?? 0n), 0n);
}

export function amountsOf(form: ContributionForm, format: NumberFormat) {
  const gross = grossOf(form, format);
  const fee = form.feeUnknown ? 0n : cents(form.fee, format);
  const invested =
    form.feeUnknown || gross === null || fee === null || gross === 0n
      ? NULL_DISPLAY
      : formatMoney(gross - fee, format);
  return { gross, fee, invested };
}

/** What is wrong with what was paid: nothing, or a payslip's components, or the amount. */
function paidProblem(form: ContributionForm, gross: Cents | null): Partial<Record<FieldName, Problem>> {
  const missing = gross === null || gross <= 0n;
  if (form.kind === "payroll") return missing ? { components: "contribution.errors.components" } : {};
  return !operationOf(form).moneyless && missing ? { amount: "contribution.errors.amount" } : {};
}

/** A fee is never negative, nor above what was paid. */
function feeWrong(form: ContributionForm, gross: Cents | null, fee: Cents | null): boolean {
  if (fee === null || fee < 0n) return true;
  // An exit's fee is not taken from what left the fund, and a change of compartment has no amount.
  const { moneyless, exit } = operationOf(form);
  return !moneyless && !exit && gross !== null && gross > 0n && fee > gross;
}

/** What is wrong, by field, before the form is sent. */
export function problemsOf(
  form: ContributionForm,
  today: string,
  format: NumberFormat,
): Partial<Record<FieldName, Problem>> {
  const { gross, fee } = amountsOf(form, format);
  return {
    ...(form.on === "" || form.on > today ? { on: "errors.future_date" } : {}),
    ...paidProblem(form, gross),
    ...(feeWrong(form, gross, fee) ? { fee: "contribution.errors.fee" } : {}),
  };
}
