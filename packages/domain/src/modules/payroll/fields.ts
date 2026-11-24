import type { EvidenceUnit } from "../imports/rules";
import { type LeaveKind } from "./rules/legacy";
import { PAYSLIP_PROFILES } from "./rules/profiles";

export { LEAVE_KINDS, type LeaveKind } from "./rules/legacy";

/**
 * Every value a payslip carries (owner's spec L42–87, spec §7.8), in the groups the review screen
 * shows. `derived` fields are computed from the others and never typed or corrected by hand;
 * `llm` marks those the OpenAI fallback may fill when the rules leave them `null` (spec D12).
 */
export const FIELD_GROUPS = ["identity", "compensation", "taxes", "contributions", "tfr", "net", "leave"] as const;
export type FieldGroup = (typeof FIELD_GROUPS)[number];

interface FieldSpec {
  group: FieldGroup;
  unit: EvidenceUnit;
  derived?: boolean;
  llm?: boolean;
}

const FIXED_FIELDS = {
  // Identity (owner's spec L34–40).
  periodLabel: { group: "identity", unit: "text" },
  employerKey: { group: "identity", unit: "text" },
  employeeKey: { group: "identity", unit: "text" },
  printedOn: { group: "identity", unit: "date" },

  // Compensation (L91–111).
  contractualGross: { group: "compensation", unit: "eur", llm: true },
  ordinaryEarnings: { group: "compensation", unit: "eur", llm: true },
  totalGrossPrinted: { group: "compensation", unit: "eur", llm: true },
  welfareCash: { group: "compensation", unit: "eur" },
  welfareInKind: { group: "compensation", unit: "eur" },
  gross: { group: "compensation", unit: "eur", derived: true },

  // Taxes (L113–132).
  irpefTaxable: { group: "taxes", unit: "eur", llm: true },
  irpefGross: { group: "taxes", unit: "eur", llm: true },
  taxDeductions: { group: "taxes", unit: "eur", llm: true },
  irpefWithheld: { group: "taxes", unit: "eur", llm: true },
  yearEndAdjustment: { group: "taxes", unit: "eur" },
  regionalInstallment: { group: "taxes", unit: "eur" },
  municipalWithheld: { group: "taxes", unit: "eur" },
  substituteTax: { group: "taxes", unit: "eur" },
  refund730: { group: "taxes", unit: "eur" },
  compensatedCredit: { group: "taxes", unit: "eur" },
  taxesTotal: { group: "taxes", unit: "eur", derived: true },
  taxesNetOfRefunds: { group: "taxes", unit: "eur", derived: true },

  // Contributions and fund (L134–149).
  employeeSocial: { group: "contributions", unit: "eur", llm: true },
  employeeFundRegular: { group: "contributions", unit: "eur" },
  employeeFundAdjustments: { group: "contributions", unit: "eur" },
  employeeFundEnrollment: { group: "contributions", unit: "eur" },
  employeeFundEffective: { group: "contributions", unit: "eur", derived: true },
  employerFundPrinted: { group: "contributions", unit: "eur" },
  employerFundAdjustments: { group: "contributions", unit: "eur" },
  employerFundEnrollment: { group: "contributions", unit: "eur" },
  employerFundEffective: { group: "contributions", unit: "eur", derived: true },
  employerSocialTotal: { group: "contributions", unit: "eur" },

  // TFR (L151–161).
  tfrMonthField: { group: "tfr", unit: "eur" },
  tfrContributionLine: { group: "tfr", unit: "eur" },
  tfrSelected: { group: "tfr", unit: "eur", derived: true },
  tfrSource: { group: "tfr", unit: "text", derived: true },

  // What the net is reconciled from (L224–235).
  // Summed from the body lines when read; correctable, since a misread line has no field of its own.
  bodyEarnings: { group: "net", unit: "eur" },
  bodyDeductions: { group: "net", unit: "eur" },
  bodyDeductionsPrinted: { group: "net", unit: "eur" },
  totalDeductionsPrinted: { group: "net", unit: "eur" },
  roundingPrevious: { group: "net", unit: "eur" },
  roundingCurrent: { group: "net", unit: "eur" },
  netPay: { group: "net", unit: "eur", llm: true },
} as const satisfies Record<string, FieldSpec>;
type FixedField = keyof typeof FIXED_FIELDS;

/** The four printed columns of a balance, in the order previous year · accrued · used · remaining. */
export const LEAVE_COLUMNS = ["PreviousYear", "Accrued", "Used", "Remaining"] as const;
type LeaveColumn = (typeof LEAVE_COLUMNS)[number];
type LeaveField = `${LeaveKind}${LeaveColumn}`;
const LEAVE_SPEC = { group: "leave", unit: "hours" } as const;

export function leaveField(kind: LeaveKind, column: LeaveColumn): LeaveField {
  return `${kind}${column}`;
}

// The leave balances as printed (L163–182: snapshots, never flows): four per balance the profiles
// read, in the order their forms print them. Built from data, so the type is asserted once here.
const LEAVE_FIELDS = Object.fromEntries(
  PAYSLIP_PROFILES.flatMap((profile) => profile.balances).flatMap((balance) =>
    LEAVE_COLUMNS.map((column) => [leaveField(balance.kind, column), LEAVE_SPEC]),
  ),
) as Readonly<Record<LeaveField, typeof LEAVE_SPEC>>;

export const FIELDS = { ...FIXED_FIELDS, ...LEAVE_FIELDS };

export type FieldName = FixedField | LeaveField;
export const FIELD_NAMES: readonly FieldName[] = Object.keys(FIELDS).filter(isFieldName);

export function isFieldName(value: string): value is FieldName {
  return Object.hasOwn(FIELDS, value);
}

type SpecOf<F extends FixedField> = (typeof FIXED_FIELDS)[F];
export type MoneyField = { [F in FixedField]: SpecOf<F>["unit"] extends "eur" ? F : never }[FixedField];

const isMoneyField = (name: string): name is MoneyField => isFieldName(name) && FIELDS[name].unit === "eur";
export const MONEY_FIELDS: readonly MoneyField[] = FIELD_NAMES.filter(isMoneyField);
export function isDerived(field: FieldName): boolean {
  return "derived" in FIELDS[field] && FIELDS[field].derived === true;
}

export function llmFillable(field: FieldName): boolean {
  return "llm" in FIELDS[field] && FIELDS[field].llm === true;
}

/** A field's value as it stands: the person's correction when there is one (owner's spec L249). */
export function effectiveValue(evidence: {
  value: string | null;
  correctedValue: string | null;
  verification: string;
}): string | null {
  return evidence.verification === "corrected" ? evidence.correctedValue : evidence.value;
}
