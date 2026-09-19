import { addMonths, type CivilDate, type MonthKey } from "@/platform/dates";
import type { Cents } from "@/platform/money";
import type { MoneyField } from "./fields";

export const PAYSLIP_TYPES = ["ordinary", "thirteenth", "fourteenth", "bonus", "settlement"] as const;
export type PayslipType = (typeof PAYSLIP_TYPES)[number];

export const LINE_UNITS = ["hours", "days", "months"] as const;
export type LineUnit = (typeof LINE_UNITS)[number];

export const TFR_SOURCES = ["month_field", "contribution_line", "both"] as const;
export type TfrSource = (typeof TFR_SOURCES)[number];

/**
 * What a body code means (spec §7.8 "Mappa dei codici"; owner's spec L91–161). A role either feeds
 * one field (`ROLE_FIELD`), produces leave events, or is kept as a raw line only.
 */
export const CODE_ROLES = [
  "ordinary_earnings",
  "thirteenth_earnings",
  "holiday_pay",
  "absence",
  "paid_leave",
  "vacation_offset",
  "vacation_event",
  "permit_offset",
  "permit_event",
  "separate_payment",
  "refund_730",
  "regional_installment",
  "municipal_installment",
  "substitute_tax",
  "substitute_tax_base",
  "employee_fund",
  "employee_fund_adjustment",
  "employee_fund_enrollment",
  "employer_fund",
  "employer_fund_adjustment",
  "employer_fund_enrollment",
  "tfr_contribution",
  "tfr_exemption",
  "welfare_cash",
  "welfare_in_kind",
  "compensated_credit",
  "statistical",
  "other",
] as const;
export type CodeRole = (typeof CODE_ROLES)[number];

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

export const REPLY_TEAMSYSTEM = "reply-teamsystem";

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

/**
 * The Reply/TeamSystem profile the code map is seeded with (spec §7.8): every code the owner's
 * spec names, and the ones its twelve payslips carry. A code missing here is `other`, and a
 * payslip with one waits for review.
 */
export const REPLY_TEAMSYSTEM_CODES: readonly { code: string; role: CodeRole }[] = [
  { code: "2", role: "ordinary_earnings" },
  { code: "4", role: "absence" },
  { code: "19", role: "absence" },
  { code: "300", role: "vacation_offset" },
  { code: "301", role: "vacation_event" },
  { code: "308", role: "permit_offset" },
  { code: "309", role: "permit_event" },
  { code: "901", role: "thirteenth_earnings" },
  { code: "1101", role: "refund_730" },
  { code: "1150", role: "regional_installment" },
  { code: "1405", role: "holiday_pay" },
  { code: "1406", role: "holiday_pay" },
  { code: "2161", role: "paid_leave" },
  { code: "7052", role: "employer_fund_enrollment" },
  { code: "7053", role: "employee_fund_enrollment" },
  { code: "7101", role: "employee_fund" },
  { code: "7897", role: "tfr_exemption" },
  { code: "8003", role: "tfr_contribution" },
  { code: "8054", role: "employee_fund_adjustment" },
  { code: "8056", role: "employer_fund_adjustment" },
  { code: "8992", role: "separate_payment" },
  { code: "9109", role: "employer_fund" },
  { code: "9110", role: "statistical" },
  { code: "9208", role: "compensated_credit" },
  { code: "9424", role: "statistical" },
  { code: "9582", role: "welfare_cash" },
  { code: "9586", role: "welfare_in_kind" },
  { code: "9824", role: "separate_payment" },
  { code: "9837", role: "substitute_tax_base" },
  { code: "9838", role: "substitute_tax" },
];

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

export interface PayslipIdentity {
  type: PayslipType;
  year: number;
  /** The first of the month paid; `null` for a 13th or 14th, which have none (owner's spec L37). */
  period: MonthKey | null;
}

/**
 * Reads *MESE RETRIBUITO* (owner's spec L36–37): "AGOSTO 2026" is August 2026, "13a MENS. 2025"
 * the 13th of 2025. Anything else is `null`: the month never comes from the file's name.
 */
export function parsePeriodLabel(label: string): PayslipIdentity | null {
  const text = label.toUpperCase().replace(/\s+/g, " ").trim();
  const extra = /^(13|14)\s*[AªA^°]?\.?\s*MENS(?:ILITA'?)?\.?\s+(\d{4})$/.exec(text);
  if (extra) {
    return { type: extra[1] === "13" ? "thirteenth" : "fourteenth", year: Number(extra[2]), period: null };
  }
  const ordinary = /^([A-Z]+)\s+(\d{4})$/.exec(text);
  if (ordinary && MONTHS[ordinary[1]] !== undefined) {
    const year = Number(ordinary[2]);
    return { type: "ordinary", year, period: `${year}-${String(MONTHS[ordinary[1]]).padStart(2, "0")}-01` };
  }
  return null;
}

/** The month the leave in a payslip was used in: the month before (owner's spec L9–20). */
export function usagePeriodOf(payrollPeriod: MonthKey): MonthKey {
  return addMonths(payrollPeriod, -1);
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

/** A 13th or 14th: kept out of monthly averages, in the yearly totals (spec §7.8 "Medie"). */
export function isExtraMonth(type: PayslipType): boolean {
  return type === "thirteenth" || type === "fourteenth";
}

export interface RegisterPayslip {
  type: PayslipType;
  year: number;
  period: MonthKey | null;
  gross: Cents | null;
  taxesTotal: Cents | null;
  netPay: Cents | null;
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
    .filter((payslip) => payslip.type === "ordinary" && payslip.period !== null)
    .toSorted((a, b) => (b.period ?? "").localeCompare(a.period ?? ""));
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

export interface RalEstimate {
  cents: Cents;
  basis: "complete_year" | "estimate";
  year: number;
}

/**
 * The yearly gross (spec §7.8 "Stima RAL"): the year's gross when its twelve ordinary months and
 * its 13th are all there; otherwise the mean ordinary gross × 12, plus the real 13th or one mean
 * month in its place, plus the 14th when the year has one. The year is the latest one with an
 * ordinary payslip.
 */
export function ralEstimate(payslips: readonly RegisterPayslip[]): RalEstimate | null {
  const latest = ordinariesNewestFirst(payslips)[0];
  if (!latest) return null;
  const year = latest.year;
  const ofYear = payslips.filter((payslip) => payslip.year === year);
  const ordinary = ofYear.filter((payslip) => payslip.type === "ordinary");
  const thirteenth = ofYear.find((payslip) => payslip.type === "thirteenth");
  const fourteenth = ofYear.find((payslip) => payslip.type === "fourteenth");
  const months = new Set(ordinary.map((payslip) => payslip.period));
  if (months.size === 12 && thirteenth && ofYear.every((payslip) => payslip.gross !== null)) {
    return {
      cents: ofYear.reduce((sum, payslip) => sum + (payslip.gross ?? 0n), 0n),
      basis: "complete_year",
      year,
    };
  }
  const mean = meanCents(ordinary.map((payslip) => payslip.gross));
  if (mean === null) return null;
  return {
    cents: mean * 12n + (thirteenth?.gross ?? mean) + (fourteenth?.gross ?? 0n),
    basis: "estimate",
    year,
  };
}

export interface YearGroup<P extends RegisterPayslip> {
  year: number;
  payslips: P[];
}

/** The register's year groups, newest year first, each newest month first with extras after December. */
export function groupByYear<P extends RegisterPayslip>(payslips: readonly P[]): YearGroup<P>[] {
  const years = [...new Set(payslips.map((payslip) => payslip.year))].toSorted((a, b) => b - a);
  const rank = (payslip: P) =>
    payslip.period ?? (payslip.type === "fourteenth" ? `${payslip.year}-06-99` : `${payslip.year}-12-99`);
  return years.map((year) => ({
    year,
    payslips: payslips.filter((payslip) => payslip.year === year).toSorted((a, b) => rank(b).localeCompare(rank(a))),
  }));
}

/** Median of known amounts (the plausibility baseline, plan F5 §3.6.7). */
export function medianCents(values: readonly (Cents | null)[]): Cents | null {
  const known = values.filter((value): value is Cents => value !== null).toSorted((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (known.length === 0) return null;
  const middle = Math.floor(known.length / 2);
  return known.length % 2 === 1 ? known[middle] : meanCents([known[middle - 1], known[middle]]);
}
