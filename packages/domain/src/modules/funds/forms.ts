// What the forms of Funds hold (release N6 of the rewrite plan; screens:
// docs/design/rewrite-plan/ux/n6-pension-fund.md). Pure: the same shapes go from the screen to the
// API client, as text the person typed.
import { type NumberFormat, numberSeparators } from "../../platform/format";
import { percentToFraction } from "../../shared/money";
import type { FeeBasis, FeePeriod } from "../../shared/fees";
import type { ManualClass } from "./pension/rules";
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

// ——— Fees ————————————————————————————————————————————————————————————————————————————————————

/**
 * What a fee applies to, as one value of a select: `""` for everything, a source's key, or a
 * source's key and a component (`<key>:tfr`). The key is the source's id, or `#<index>` in the form
 * that creates a fund, where a source has no id yet.
 */
type FeeScope = string;

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
