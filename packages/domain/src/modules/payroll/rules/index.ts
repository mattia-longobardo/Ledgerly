import { addMonths, type CivilDate, type MonthKey } from "../../../shared/dates";
import type { Cents } from "../../../shared/money";
import type { MoneyField } from "../fields";
import type { PayslipType } from "./legacy";
import { DEFAULT_EMPLOYER, type Employer, type PayslipKind } from "./payslip";
import type { CodeRole } from "./roles";

export { kindOfType, PAYSLIP_TYPES, type PayslipType } from "./legacy";
export {
  BASE_FIELDS,
  type BaseField,
  baseColumnsOf,
  type CatalogueField,
  COUNTRY_FIELDS,
  DEFAULT_EMPLOYER,
  type Employer,
  employerInputSchema,
  fieldCatalogue,
  isCountryField,
  type ManualPayslip,
  manualPayslipSchema,
  MAX_EXTRA_PAYMENTS,
  PAY_FREQUENCIES,
  type PayFrequency,
  PAYSLIP_KINDS,
  PAYSLIP_SOURCES,
  type PayslipKind,
  periodOfManual,
  REGISTER_FIELDS,
} from "./payslip";

export { CODE_ROLES, type CodeRole, LINE_UNITS, type LineUnit } from "./roles";
export {
  DEFAULT_PROFILE,
  isSeededCode,
  PAYSLIP_PROFILES,
  type PayslipProfile,
  type ProfileBalance,
  type ProfileCheck,
  profileById,
  profileOfVersion,
} from "./profiles";

export const TFR_SOURCES = ["month_field", "contribution_line", "both"] as const;
export type TfrSource = (typeof TFR_SOURCES)[number];

/** The field a role's lines add up to; roles missing here stay raw lines. */
export const ROLE_FIELD: Partial<Record<CodeRole, MoneyField>> = {
  ordinary_earnings: "ordinaryEarnings",
  refund_730: "refund730",
  regional_installment: "regionalInstallment",
  municipal_installment: "municipalWithheld",
  employee_fund: "employeeFundRegular",
  employee_fund_adjustment: "employeeFundAdjustments",
  employee_fund_enrollment: "employeeFundEnrollment",
  employer_fund: "employerFundPrinted",
  employer_fund_adjustment: "employerFundAdjustments",
  employer_fund_enrollment: "employerFundEnrollment",
  tfr_contribution: "tfrContributionLine",
  welfare_cash: "welfareCash",
  welfare_in_kind: "welfareInKind",
  compensated_credit: "compensatedCredit",
};

/** The register's amount columns (spec §7.8 D13): summed per year, averaged per ordinary month. */
export const SUMMED_FIELDS = [
  "gross",
  "taxesTotal",
  "employeeSocial",
  "netPay",
  "irpefGross",
  "taxDeductions",
  "regionalInstallment",
  "substituteTax",
  "refund730",
  "welfareCash",
  "employeeFundEffective",
  "employerFundEffective",
  "tfrSelected",
] as const satisfies readonly MoneyField[];
export type SummedField = (typeof SUMMED_FIELDS)[number];

const MONTHS: Record<string, number> = {
  GENNAIO: 1,
  FEBBRAIO: 2,
  MARZO: 3,
  APRILE: 4,
  MAGGIO: 5,
  GIUGNO: 6,
  LUGLIO: 7,
  AGOSTO: 8,
  SETTEMBRE: 9,
  OTTOBRE: 10,
  NOVEMBRE: 11,
  DICEMBRE: 12,
};

const EXTRA_MONTHS: Record<string, PayslipType> = { "13": "thirteenth", "14": "fourteenth", "15": "fifteenth" };

export interface PayslipIdentity {
  type: PayslipType;
  year: number;
  /** The first of the month paid; `null` for a 13th, 14th or 15th, which have none (owner's spec L37). */
  period: MonthKey | null;
}

/**
 * Reads *MESE RETRIBUITO* (owner's spec L36–37): "AGOSTO 2026" is August 2026, "13a MENS. 2025"
 * the 13th of 2025; the 14th and the 15th read the same way. Anything else is `null`: the month
 * never comes from the file's name.
 */
export function parsePeriodLabel(label: string): PayslipIdentity | null {
  const text = label.toUpperCase().replace(/\s+/g, " ").trim();
  const extra = /^(13|14|15)\s*[AªA^°]?\.?\s*MENS(?:ILITA'?)?\.?\s+(\d{4})$/.exec(text);
  if (extra) {
    return { type: EXTRA_MONTHS[extra[1]], year: Number(extra[2]), period: null };
  }
  const ordinary = /^([A-Z]+)\s+(\d{4})$/.exec(text);
  if (ordinary && MONTHS[ordinary[1]] !== undefined) {
    const year = Number(ordinary[2]);
    return { type: "ordinary", year, period: `${year}-${String(MONTHS[ordinary[1]]).padStart(2, "0")}-01` };
  }
  return null;
}

/**
 * The month the leave in a payslip was used in: `lagMonths` before the payslip's own, as its profile
 * says (one, owner's spec L9–20).
 */
export function usagePeriodOf(payrollPeriod: MonthKey, lagMonths: number): MonthKey {
  return addMonths(payrollPeriod, -lagMonths);
}

/** "28/08/26" → 2026-08-28; two-digit years are this century's. */
export function parseItalianDate(text: string): CivilDate | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{2}|\d{4})$/.exec(text.trim());
  if (!match) return null;
  const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
  const date = `${year}-${match[2]}-${match[1]}`;
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date ? null : date;
}

/** The logical key a rectification shares with the payslip it replaces (spec §7.8). */
export function logicalKey(payslip: {
  employerKey: string;
  employeeKey: string;
  year: number;
  type: PayslipType;
  period: MonthKey | null;
}): string {
  return [payslip.employerKey, payslip.employeeKey, payslip.year, payslip.type, payslip.period ?? "-"].join("|");
}

export interface RegisterPayslip {
  kind: PayslipKind;
  extraNumber: number | null;
  year: number;
  period: MonthKey | null;
  gross: Cents | null;
  taxesTotal: Cents | null;
  netPay: Cents | null;
}

/** A payslip's kind and extra payment's number. */
export function kindOf(payslip: Pick<RegisterPayslip, "kind" | "extraNumber">): {
  kind: PayslipKind;
  extraNumber: number | null;
} {
  return { kind: payslip.kind, extraNumber: payslip.extraNumber };
}

/** An extra payment (13th, 14th…): kept out of monthly averages, in the yearly totals (spec §7.8 "Medie"). */
export function isExtra(payslip: Pick<RegisterPayslip, "kind" | "extraNumber">): boolean {
  return kindOf(payslip).kind === "extra";
}

/** An ordinary payslip: one month's pay, what the means and the KPIs read. */
export function isOrdinary(payslip: Pick<RegisterPayslip, "kind" | "extraNumber">): boolean {
  return kindOf(payslip).kind === "ordinary";
}

/** The mean of known amounts, rounded half away from zero; null when none is known. */
export function meanCents(values: readonly (Cents | null)[]): Cents | null {
  const known = values.filter((value): value is Cents => value !== null);
  if (known.length === 0) return null;
  const total = known.reduce((sum, value) => sum + value, 0n);
  const count = BigInt(known.length);
  const half = total >= 0n ? count / 2n : -(count / 2n);
  return (total + half) / count;
}

/** Ordinary payslips, newest first. */
function ordinariesNewestFirst<P extends RegisterPayslip>(payslips: readonly P[]): P[] {
  return payslips
    .filter((payslip) => isOrdinary(payslip) && payslip.period !== null)
    .toSorted((one, two) => (two.period ?? "").localeCompare(one.period ?? ""));
}

/** The average net of the last `months` ordinary payslips (spec §7.8 KPI strip). */
export function averageNet(payslips: readonly RegisterPayslip[], months: number): Cents | null {
  return meanCents(
    ordinariesNewestFirst(payslips)
      .slice(0, months)
      .map((payslip) => payslip.netPay),
  );
}

/**
 * The average tax rate: taxes over gross across the ordinary payslips of the last twelve, as a
 * fraction; null when either total is unknown or gross is not positive.
 */
export function averageTaxRate(payslips: readonly RegisterPayslip[]): number | null {
  const recent = ordinariesNewestFirst(payslips).slice(0, 12);
  let gross = 0n;
  let taxes = 0n;
  for (const payslip of recent) {
    if (payslip.gross === null || payslip.taxesTotal === null) continue;
    gross += payslip.gross;
    taxes += payslip.taxesTotal;
  }
  return gross > 0n ? Number(taxes) / Number(gross) : null;
}

export interface TheoreticalGross {
  cents: Cents;
  /** `contractual`: the payslip's «Retribuzione di fatto»; `gross`: its gross, when it does not have one. */
  basis: "contractual" | "gross";
  /** The ordinary payslip it is read from: the latest one of the payslips given. */
  from: MonthKey;
  /** How many times the month counts: twelve, and one for each extra payment of the employer. */
  months: number;
}

/**
 * The theoretical yearly gross (owner's choice B, 26/11/2026): the «Retribuzione di fatto»
 * (`contractualGross`) of the latest ordinary payslip × (12 + the employer's extra payments); its
 * gross in the same way when the field is missing (choice C, a payslip typed by hand). Null without
 * an ordinary payslip. The caller gives one year's applied payslips.
 */
export function theoreticalGross(
  payslips: readonly (RegisterPayslip & { contractualGross: Cents | null })[],
  employer: Employer = DEFAULT_EMPLOYER,
): TheoreticalGross | null {
  const latest = ordinariesNewestFirst(payslips)[0];
  if (!latest?.period) return null;
  // shortcut: counts monthly pay only (12 a year); a weekly or biweekly employer needs its own count.
  const months = 12 + employer.extraMonths.length;
  const [basis, monthly] =
    latest.contractualGross !== null ? (["contractual", latest.contractualGross] as const) : (["gross", latest.gross] as const);
  return monthly === null ? null : { cents: monthly * BigInt(months), basis, from: latest.period, months };
}

interface YearGroup<P extends RegisterPayslip> {
  year: number;
  payslips: P[];
}

/**
 * The register's year groups, newest year first, each newest month first: an extra payment with the
 * month the employer pays it in (December when it does not say), after that month's payslip, and
 * the later extra payments of a month above the earlier ones.
 */
export function groupByYear<P extends RegisterPayslip>(
  payslips: readonly P[],
  employer: Employer = DEFAULT_EMPLOYER,
): YearGroup<P>[] {
  const years = [...new Set(payslips.map((payslip) => payslip.year))].toSorted((one, two) => two - one);
  const rank = (payslip: P) => {
    if (payslip.period) return payslip.period;
    const { extraNumber } = kindOf(payslip);
    const month = (extraNumber === null ? undefined : employer.extraMonths[extraNumber - 1]) ?? 12;
    return `${payslip.year}-${String(month).padStart(2, "0")}-99${extraNumber ?? ""}`;
  };
  return years.map((year) => ({
    year,
    payslips: payslips.filter((payslip) => payslip.year === year).toSorted((one, two) => rank(two).localeCompare(rank(one))),
  }));
}

/** Median of known amounts (the plausibility baseline, plan F5 §3.6.7). */
export function medianCents(values: readonly (Cents | null)[]): Cents | null {
  const known = values.filter((value): value is Cents => value !== null).toSorted((one, two) => (one < two ? -1 : one > two ? 1 : 0));
  if (known.length === 0) return null;
  const middle = Math.floor(known.length / 2);
  return known.length % 2 === 1 ? known[middle] : meanCents([known[middle - 1], known[middle]]);
}
