import type { EvidenceUnit } from "@/modules/imports/rules";

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

export const FIELDS = {
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

  // Leave balances as printed (L163–182): snapshots, never flows.
  vacationPreviousYear: { group: "leave", unit: "hours" },
  vacationAccrued: { group: "leave", unit: "hours" },
  vacationUsed: { group: "leave", unit: "hours" },
  vacationRemaining: { group: "leave", unit: "hours" },
  permitPreviousYear: { group: "leave", unit: "hours" },
  permitAccrued: { group: "leave", unit: "hours" },
  permitUsed: { group: "leave", unit: "hours" },
  permitRemaining: { group: "leave", unit: "hours" },
  rolPreviousYear: { group: "leave", unit: "hours" },
  rolAccrued: { group: "leave", unit: "hours" },
  rolUsed: { group: "leave", unit: "hours" },
  rolRemaining: { group: "leave", unit: "hours" },
} as const satisfies Record<string, FieldSpec>;

export type FieldName = keyof typeof FIELDS;
export const FIELD_NAMES = Object.keys(FIELDS) as FieldName[];

export function isFieldName(value: string): value is FieldName {
  return Object.hasOwn(FIELDS, value);
}

type SpecOf<F extends FieldName> = (typeof FIELDS)[F];
export type MoneyField = { [F in FieldName]: SpecOf<F>["unit"] extends "eur" ? F : never }[FieldName];
export type HoursField = { [F in FieldName]: SpecOf<F>["unit"] extends "hours" ? F : never }[FieldName];

export const MONEY_FIELDS = FIELD_NAMES.filter((name) => FIELDS[name].unit === "eur") as MoneyField[];
export const HOURS_FIELDS = FIELD_NAMES.filter((name) => FIELDS[name].unit === "hours") as HoursField[];

export function isDerived(field: FieldName): boolean {
  return "derived" in FIELDS[field] && FIELDS[field].derived === true;
}

export function llmFillable(field: FieldName): boolean {
  return "llm" in FIELDS[field] && FIELDS[field].llm === true;
}

export const LEAVE_KINDS = ["vacation", "rol", "permit"] as const;
export type LeaveKind = (typeof LEAVE_KINDS)[number];

/** The four printed columns of a leave kind, in the order A.P. · MAT. · GOD. · RES. */
export const LEAVE_COLUMNS = ["PreviousYear", "Accrued", "Used", "Remaining"] as const;

export function leaveField(kind: LeaveKind, column: (typeof LEAVE_COLUMNS)[number]): HoursField {
  return `${kind}${column}` as HoursField;
}

/** A field's value as it stands: the person's correction when there is one (owner's spec L249). */
export function effectiveValue(evidence: {
  value: string | null;
  correctedValue: string | null;
  verification: string;
}): string | null {
  return evidence.verification === "corrected" ? evidence.correctedValue : evidence.value;
}
