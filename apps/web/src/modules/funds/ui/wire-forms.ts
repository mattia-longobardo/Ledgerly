// The rows of `/api/v1` as the forms of Funds start from them (rewrite plan R3): the same fields the
// domain's `sourceFormOf`, `feeFormOf` and `contributionFormOf` filled from the database, here from
// the wire. Formatting only: a decimal becomes the text a person would type in their number format.
import type { RouteOutput } from "@ledgerly/api-client";
import type { funds } from "@ledgerly/api-contract/funds";
import { parseCents } from "@ledgerly/format/cents";
import {
  formatAmountInput,
  formatDate,
  formatMoney,
  type NumberFormat,
  numberSeparators,
  type UiLocale,
} from "@ledgerly/format/format";
import {
  type ContributionForm,
  type FeeForm,
  newSourceForm,
  PAYROLL_COMPONENTS,
  type SourceForm,
} from "@ledgerly/domain/funds/client";

type Settings = RouteOutput<typeof funds.getFundSettings>;
export type SourceRow = Settings["sources"][number];
export type FeeRow = Settings["fees"][number];
export type OperationRow = RouteOutput<typeof funds.getFundContributions>["operations"][number];
type Movement = RouteOutput<typeof funds.getFundMovementCandidates>["movements"][number];

/** A decimal of the wire as the cents `formatMoney` takes; null stays null. */
export const cents = (amount: string | null): bigint | null => (amount === null ? null : parseCents(amount));

/** The fields of a payslip source. */
const payrollFields = (source: SourceRow) => ({
  components: source.components ?? [...PAYROLL_COMPONENTS],
  accrualPeriod: source.accrualPeriod ?? "month",
  employer: source.employer ?? "",
  hasDue: source.due !== null,
  dueDay: source.due === null ? "" : String(source.due.day),
  dueOffsetMonths: source.due === null ? "1" : String(source.due.offsetMonths),
  toleranceDays: String(source.toleranceDays ?? 15),
  note: source.note ?? "",
  customDue: source.dueDates.length > 0,
});

/** The fields of a recurring debit. */
const debitFields = (source: SourceRow, format: NumberFormat) => ({
  amount: formatAmountInput(cents(source.amount), format),
  frequencyCount: String(source.frequency?.count ?? 1),
  frequencyUnit: source.frequency?.unit ?? "month",
  debitDay: source.debitDay === null ? "" : String(source.debitDay),
  accountId: source.accountId ?? "",
  payeeMatch: source.payeeMatch ?? "",
  validFrom: source.validFrom ?? "",
  validTo: source.validTo ?? "",
});

/** A stored source as its form starts from it. */
export function sourceFormOfRow(source: SourceRow, format: NumberFormat): SourceForm {
  return {
    ...newSourceForm(source.kind),
    id: source.id,
    state: source.state,
    ...payrollFields(source),
    ...debitFields(source, format),
  };
}

/** A stored fee as its form starts from it: the rate is the percentage of the wire, in the person's format. */
export function feeFormOfRow(fee: FeeRow, format: NumberFormat): FeeForm {
  return {
    id: fee.id,
    label: fee.label,
    basis: fee.basis,
    mode: fee.rate === null ? "amount" : "rate",
    value:
      fee.rate === null
        ? formatAmountInput(cents(fee.amount), format)
        : fee.rate.replace(".", numberSeparators(format).decimal),
    period: fee.period ?? "year",
    scope:
      fee.sourceId === null ? "" : fee.component === null ? fee.sourceId : `${fee.sourceId}:${fee.component}`,
    validFrom: fee.validFrom ?? "",
    validTo: fee.validTo ?? "",
    note: fee.note ?? "",
  };
}

const KINDS = { voluntary: "voluntary", contribution: "payroll" } as const;
const isKindClass = (value: string): value is keyof typeof KINDS => value in KINDS;
/** The classes the form writes by hand; an imported `other` opens as the form's first class. */
const FORM_CLASSES = ["withdrawal", "enrollment", "transfer_in", "switch"] as const;
const formClass = (value: string): ContributionForm["classification"] =>
  FORM_CLASSES.find((one) => one === value) ?? "withdrawal";

/** An operation of the register as the form that edits it starts from it. */
export function contributionFormOfRow(operation: OperationRow, format: NumberFormat): ContributionForm {
  const text = (amount: string) => {
    const value = parseCents(amount);
    return value === 0n ? "" : formatAmountInput(value < 0n ? -value : value, format);
  };
  const { classification } = operation;
  const kind = isKindClass(classification) ? KINDS[classification] : "other";
  return {
    id: operation.id,
    kind,
    classification: formClass(classification),
    on: operation.on,
    amount: kind === "payroll" ? "" : text(operation.gross),
    worker: kind === "payroll" ? text(operation.worker) : "",
    employer: kind === "payroll" ? text(operation.employer) : "",
    tfr: kind === "payroll" ? text(operation.tfr) : "",
    period: operation.competence === null ? "" : `${operation.competence.year}-${operation.competence.index}`,
    fee: operation.fee === null ? "" : formatAmountInput(parseCents(operation.fee), format),
    feeUnknown: operation.fee === null,
    transactionId: operation.transactionId ?? "",
    note: operation.note ?? "",
  };
}

/** The movements a picker offers: «12 Mar · Payee · 100,00 €», newest first as the route answers. */
export function movementOptions(
  movements: readonly Movement[],
  say: { format: NumberFormat; locale: UiLocale },
): { id: string; label: string }[] {
  return movements.map((movement) => ({
    id: movement.id,
    label: `${formatDate(movement.on, "dayMonth", say.locale)} · ${movement.payee ?? ""} · ${formatMoney(
      parseCents(movement.amount),
      say.format,
    )}`,
  }));
}
