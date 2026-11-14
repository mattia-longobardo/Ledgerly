// What the forms of Funds hold and how it becomes what the service takes (release N6 of the rewrite
// plan; screens: docs/design/rewrite-plan/ux/n6-pension-fund.md). Pure: the same shapes go from the
// page to the client component and back to the Server Action, as text the person typed.
import { parseAmount } from "@/modules/accounts/rules";
import { fractionToPercent, percentToFraction } from "@/modules/interests/rules";
import { formatAmountInput, type NumberFormat, numberSeparators } from "@/platform/format";
import type { Cents } from "@/platform/money";
import { type FeeBasis, feeModes, type FeePeriod, needsPeriod } from "./fees";
import type { ManualClass } from "./pension/rules";
import type { ContributionInput, FeeInput, FundInput, SourceInput } from "./service";
import {
  type AccrualPeriod,
  type IntervalUnit,
  PAYROLL_COMPONENTS,
  type PayrollComponent,
  type SourceKind,
  type SourceState,
} from "./sources";

// ——— The fund ————————————————————————————————————————————————————————————————————————————————

export interface FundForm {
  name: string;
  provider: string;
  compartment: string;
  startOn: string;
  code: string;
}

export const fundInputOf = (form: FundForm): FundInput => ({
  name: form.name,
  provider: form.provider,
  compartment: form.compartment,
  startOn: form.startOn,
  code: form.code,
});

// ——— Sources —————————————————————————————————————————————————————————————————————————————————

/** One source as its fields hold it. The fields of the other kinds stay at their defaults. */
export interface SourceForm {
  /** The row's id; `null` for a source not written yet. */
  id: string | null;
  kind: SourceKind;
  state: SourceState;
  components: PayrollComponent[];
  accrualPeriod: AccrualPeriod;
  employer: string;
  hasDue: boolean;
  dueDay: string;
  dueOffsetMonths: string;
  toleranceDays: string;
  note: string;
  /** True while the source keeps explicit due dates the three fields cannot say. */
  customDue: boolean;
  amount: string;
  frequencyCount: string;
  frequencyUnit: IntervalUnit;
  debitDay: string;
  accountId: string;
  payeeMatch: string;
  validFrom: string;
  validTo: string;
}

/** A new source of a kind, as the form opens it: every component, by month, no due date, every month. */
export function newSourceForm(kind: SourceKind, defaults: { payeeMatch?: string } = {}): SourceForm {
  return {
    id: null,
    kind,
    state: "active",
    components: [...PAYROLL_COMPONENTS],
    accrualPeriod: "month",
    employer: "",
    hasDue: false,
    dueDay: "",
    dueOffsetMonths: "1",
    toleranceDays: "15",
    note: "",
    customDue: false,
    amount: "",
    frequencyCount: "1",
    frequencyUnit: "month",
    debitDay: "",
    accountId: "",
    payeeMatch: defaults.payeeMatch ?? "",
    validFrom: "",
    validTo: "",
  };
}

/** The columns of a source the forms read: the row of the table, with nothing of the database in it. */
export interface SourceRow {
  id: string;
  kind: SourceKind;
  state: SourceState;
  components: PayrollComponent[] | null;
  accrualPeriod: AccrualPeriod | null;
  employer: string | null;
  dueDay: number | null;
  dueOffsetMonths: number | null;
  dueEntries: unknown;
  toleranceDays: number | null;
  accountId: string | null;
  payeeMatch: string | null;
  amountCents: Cents | null;
  debitDay: number | null;
  intervalCount: number | null;
  intervalUnit: IntervalUnit | null;
  validFrom: string | null;
  validTo: string | null;
  note: string | null;
}

/** A stored source as its form starts from it. */
export function sourceFormOf(source: SourceRow, format: NumberFormat): SourceForm {
  const customDue = Array.isArray(source.dueEntries) && source.dueEntries.length > 0;
  return {
    ...newSourceForm(source.kind),
    id: source.id,
    state: source.state,
    components: source.components ?? [...PAYROLL_COMPONENTS],
    accrualPeriod: source.accrualPeriod ?? "month",
    employer: source.employer ?? "",
    hasDue: source.dueDay !== null,
    dueDay: source.dueDay === null ? "" : String(source.dueDay),
    dueOffsetMonths: source.dueOffsetMonths === null ? "1" : String(source.dueOffsetMonths),
    toleranceDays: String(source.toleranceDays ?? 15),
    note: source.note ?? "",
    customDue,
    amount: formatAmountInput(source.amountCents, format),
    frequencyCount: String(source.intervalCount ?? 1),
    frequencyUnit: source.intervalUnit ?? "month",
    debitDay: source.debitDay === null ? "" : String(source.debitDay),
    accountId: source.accountId ?? "",
    payeeMatch: source.payeeMatch ?? "",
    validFrom: source.validFrom ?? "",
    validTo: source.validTo ?? "",
  };
}

const whole = (text: string): number => {
  if (!/^\d{1,3}$/.test(text.trim())) throw new RangeError(`Not a whole number: "${text}"`);
  return Number(text.trim());
};

/** What the service takes for a source. Throws `RangeError` on a field that is not a number. */
export function sourceInputOf(form: SourceForm, format: NumberFormat): SourceInput {
  if (form.kind === "manual") return { kind: "manual" };
  if (form.kind === "payroll") {
    return {
      kind: "payroll",
      components: form.components,
      accrualPeriod: form.accrualPeriod,
      employer: form.employer,
      due: form.hasDue ? { day: whole(form.dueDay), offsetMonths: whole(form.dueOffsetMonths) } : null,
      toleranceDays: form.toleranceDays.trim() === "" ? 15 : whole(form.toleranceDays),
      note: form.note,
      keepDueEntries: form.customDue && !form.hasDue,
    };
  }
  return {
    kind: "bank_debit",
    amountCents: parseAmount(form.amount, format),
    frequency: { count: whole(form.frequencyCount), unit: form.frequencyUnit },
    debitDay: form.debitDay.trim() === "" ? null : whole(form.debitDay),
    accountId: form.accountId || null,
    payeeMatch: form.payeeMatch,
    validFrom: form.validFrom || null,
    validTo: form.validTo || null,
  };
}

// ——— Fees ————————————————————————————————————————————————————————————————————————————————————

/**
 * What a fee applies to, as one value of a select: `""` for everything, a source's key, or a
 * source's key and a component (`<key>:tfr`). The key is the source's id, or `#<index>` in the form
 * that creates a fund, where a source has no id yet.
 */
export type FeeScope = string;

export interface FeeForm {
  id: string | null;
  label: string;
  basis: FeeBasis;
  mode: "amount" | "rate";
  /** An amount, or a percentage as the person writes it ("0,45"). */
  value: string;
  period: FeePeriod;
  scope: FeeScope;
  validFrom: string;
  validTo: string;
  note: string;
}

export const newFeeForm = (): FeeForm => ({
  id: null,
  label: "",
  basis: "per_contribution",
  mode: "amount",
  value: "",
  period: "year",
  scope: "",
  validFrom: "",
  validTo: "",
  note: "",
});

export interface FeeRow {
  id: string;
  label: string;
  basis: FeeBasis;
  amountCents: Cents | null;
  rate: string | null;
  period: FeePeriod | null;
  sourceId: string | null;
  component: PayrollComponent | null;
  validFrom: string | null;
  validTo: string | null;
  note: string | null;
}

/** A percentage as text in the person's format, from the stored fraction. */
export function percentInput(rate: string, format: NumberFormat): string {
  return fractionToPercent(rate).replace(".", numberSeparators(format).decimal);
}

/** The stored fraction of a percentage the person wrote; throws `RangeError` when it is not one. */
export function fractionOfPercent(text: string, format: NumberFormat): string {
  const { decimal, group } = numberSeparators(format);
  const plain = text
    .replace(/[\s %]/g, "")
    .replaceAll(group, "")
    .replace(decimal, ".");
  const fraction = percentToFraction(plain);
  if (Number(fraction) <= 0 || Number(fraction) > 1) throw new RangeError(`Not a percentage: "${text}"`);
  return fraction;
}

export function feeFormOf(fee: FeeRow, format: NumberFormat): FeeForm {
  return {
    id: fee.id,
    label: fee.label,
    basis: fee.basis,
    mode: fee.rate === null ? "amount" : "rate",
    value: fee.rate === null ? formatAmountInput(fee.amountCents, format) : percentInput(fee.rate, format),
    period: fee.period ?? "year",
    scope:
      fee.sourceId === null ? "" : fee.component === null ? fee.sourceId : `${fee.sourceId}:${fee.component}`,
    validFrom: fee.validFrom ?? "",
    validTo: fee.validTo ?? "",
    note: fee.note ?? "",
  };
}

/** The source key and the component a scope names. */
export function parseScope(scope: FeeScope): { key: string | null; component: PayrollComponent | null } {
  if (scope === "") return { key: null, component: null };
  const [key, component] = scope.split(":");
  return {
    key,
    component: PAYROLL_COMPONENTS.includes(component as PayrollComponent)
      ? (component as PayrollComponent)
      : null,
  };
}

/**
 * What the service takes for a fee, the source left as the key the form holds: the caller turns the
 * key into an id (Settings) or into an index (the form that creates a fund).
 */
export function feeInputOf(
  form: FeeForm,
  format: NumberFormat,
): Omit<FeeInput, "sourceId"> & { sourceKey: string | null } {
  const modes = feeModes(form.basis);
  const mode = modes.includes(form.mode) ? form.mode : modes[0];
  const { key, component } =
    form.basis === "on_assets" ? { key: null, component: null } : parseScope(form.scope);
  return {
    label: form.label,
    basis: form.basis,
    amountCents: mode === "amount" ? parseAmount(form.value, format) : null,
    rate: mode === "rate" ? fractionOfPercent(form.value, format) : null,
    period: needsPeriod(form.basis) ? form.period : null,
    sourceKey: key,
    component,
    validFrom: form.validFrom || null,
    validTo: form.validTo || null,
    note: form.note,
  };
}

// ——— Contributions and the other operations ————————————————————————————————————————————————————

export interface ContributionForm {
  /** The operation's id; `null` for a new one. */
  id: string | null;
  kind: "voluntary" | "payroll" | "other";
  /** The class of an operation that is not a contribution. */
  classification: Exclude<ManualClass, "voluntary" | "contribution">;
  on: string;
  amount: string;
  worker: string;
  employer: string;
  tfr: string;
  /** The period of a payslip contribution, as `<year>-<index>`; `""` for none. */
  period: string;
  fee: string;
  feeUnknown: boolean;
  transactionId: string;
  note: string;
}

export const newContributionForm = (
  kind: ContributionForm["kind"],
  on: string,
  defaults: { fee?: string; period?: string } = {},
): ContributionForm => ({
  id: null,
  kind,
  classification: "withdrawal",
  on,
  amount: "",
  worker: "",
  employer: "",
  tfr: "",
  period: defaults.period ?? "",
  fee: defaults.fee ?? "",
  feeUnknown: false,
  transactionId: "",
  note: "",
});

export interface OperationRow {
  id: string;
  classification: string;
  operationDate: string;
  workerCents: Cents;
  employerCents: Cents;
  tfrCents: Cents;
  otherCents: Cents;
  feesCents: Cents;
  feesUnknown: boolean;
  competenceYear: number | null;
  competenceQuarter: number | null;
  transactionId: string | null;
  note: string | null;
}

/** A stored operation as the form that edits it starts from it. */
export function contributionFormOf(operation: OperationRow, format: NumberFormat): ContributionForm {
  const amount = (cents: Cents) =>
    cents === 0n ? "" : formatAmountInput(cents < 0n ? -cents : cents, format);
  const kind =
    operation.classification === "voluntary"
      ? "voluntary"
      : operation.classification === "contribution"
        ? "payroll"
        : "other";
  const gross = operation.workerCents + operation.employerCents + operation.tfrCents + operation.otherCents;
  return {
    id: operation.id,
    kind,
    classification:
      kind === "other" ? (operation.classification as ContributionForm["classification"]) : "withdrawal",
    on: operation.operationDate,
    amount: kind === "payroll" ? "" : amount(gross),
    worker: kind === "payroll" ? amount(operation.workerCents) : "",
    employer: kind === "payroll" ? amount(operation.employerCents) : "",
    tfr: kind === "payroll" ? amount(operation.tfrCents) : "",
    period:
      operation.competenceYear === null || operation.competenceQuarter === null
        ? ""
        : `${operation.competenceYear}-${operation.competenceQuarter}`,
    fee: operation.feesUnknown ? "" : formatAmountInput(operation.feesCents, format),
    feeUnknown: operation.feesUnknown,
    transactionId: operation.transactionId ?? "",
    note: operation.note ?? "",
  };
}

/** What the service takes for an operation written by hand. An empty fee is no fee; unknown is `null`. */
export function contributionInputOf(form: ContributionForm, format: NumberFormat): ContributionInput {
  const amount = (text: string): Cents => (text.trim() === "" ? 0n : parseAmount(text, format));
  const feeCents = form.feeUnknown ? null : amount(form.fee);
  if (form.kind === "voluntary") {
    return {
      kind: "voluntary",
      on: form.on,
      amountCents: parseAmount(form.amount, format),
      feeCents,
      transactionId: form.transactionId || null,
      note: form.note,
    };
  }
  if (form.kind === "payroll") {
    const [year, index] = form.period.split("-").map(Number);
    return {
      kind: "payroll",
      on: form.on,
      workerCents: amount(form.worker),
      employerCents: amount(form.employer),
      tfrCents: amount(form.tfr),
      period: form.period === "" ? null : { year, index },
      feeCents,
      note: form.note,
    };
  }
  return {
    kind: "other",
    classification: form.classification,
    on: form.on,
    amountCents: amount(form.amount),
    feeCents,
    note: form.note,
  };
}

// ——— The form that creates a fund ————————————————————————————————————————————————————————————

export interface WizardForm {
  fund: FundForm;
  /** Today's value and its day; an empty value is a fund with no value yet. */
  value: string;
  valueOn: string;
  currency: string;
  /** The sources switched on, in the order payslip, debit, by hand. */
  sources: SourceForm[];
  /** A fee's scope names a source by `#<index>` in `sources`. */
  fees: FeeForm[];
}
