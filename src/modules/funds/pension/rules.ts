import { type CivilDate, type MonthKey } from "@/platform/dates";
import type { Cents } from "@/platform/money";

/**
 * The pension side of a fund (spec §7.7; owner's Cometa guide, "GC" below): the lists the tables
 * check, the payment schedule, and the small pure helpers every part of it shares.
 */

export const PENSION_RULE_KINDS = ["contribution", "payment_schedule"] as const;
export type PensionRuleKind = (typeof PENSION_RULE_KINDS)[number];

/**
 * What an operation is, as interpreted beside the provider's own description (GC §8.4, §10):
 * an enrolment fee is a "Contributo" in the export and becomes `enrollment` from its amounts.
 */
export const OPERATION_CLASSES = [
  "contribution",
  "enrollment",
  "voluntary",
  "transfer_in",
  "switch",
  "withdrawal",
  "other",
] as const;
export type OperationClass = (typeof OPERATION_CLASSES)[number];

export const OPERATION_SOURCES = ["import", "manual"] as const;
export type OperationSource = (typeof OPERATION_SOURCES)[number];

/** The components reconciled one by one (GC §9.1), the enrolment on its own. */
export const COMPONENTS = ["worker", "employer", "tfr", "enrollment"] as const;
export type Component = (typeof COMPONENTS)[number];

export const DECISIONS = ["accepted_difference", "pending"] as const;
export type Decision = (typeof DECISIONS)[number];

export type Quarter = 1 | 2 | 3 | 4;

/** One due date of the schedule: the quarter's payment is due on `day`/`month`, maybe the next year. */
export interface ScheduleEntry {
  quarter: Quarter;
  month: number;
  day: number;
  nextYear: boolean;
}

/** Cometa's ordinary deadlines (GC §4): 20 April, 20 July, 20 October, 20 January of the next year. */
export const COMETA_SCHEDULE: readonly ScheduleEntry[] = [
  { quarter: 1, month: 4, day: 20, nextYear: false },
  { quarter: 2, month: 7, day: 20, nextYear: false },
  { quarter: 3, month: 10, day: 20, nextYear: false },
  { quarter: 4, month: 1, day: 20, nextYear: true },
];

/** How long after a due date a missing credit is still shown as on its way (design; GC §11). */
export const DEFAULT_TOLERANCE_DAYS = 15;

/** Where the schedule and the tariff come from (GC §4, §6.1), verified by the guide on this day. */
export const COMETA_SOURCES = {
  schedule: "https://www.cometafondo.it/faq/contribuzione/",
  contributions: "https://www.cometafondo.it/parte-i-scheda-iii-i-destinatari-e-i-contributi/",
  costs: "https://www.cometafondo.it/wp-content/uploads/2024/03/2024-02-09-parte-I-scheda-i-costi.pdf",
  tax: "https://www.cometafondo.it/prestazioni-contribuzione/faq/",
  verifiedOn: "2026-09-13",
} as const;

export function isQuarter(value: number): value is Quarter {
  return value === 1 || value === 2 || value === 3 || value === 4;
}

/** The quarter of a month ("2026-05" → 2). */
export function quarterOfMonth(month: MonthKey | CivilDate): Quarter {
  return (Math.floor((Number(month.slice(5, 7)) - 1) / 3) + 1) as Quarter;
}

/** The due date of a quarter's payment under a schedule (GC §4), `null` if the schedule lacks it. */
export function dueDate(
  year: number,
  quarter: Quarter,
  schedule: readonly ScheduleEntry[] = COMETA_SCHEDULE,
): CivilDate | null {
  const entry = schedule.find((one) => one.quarter === quarter);
  if (!entry) return null;
  const on = `${year + (entry.nextYear ? 1 : 0)}-${String(entry.month).padStart(2, "0")}-${String(entry.day).padStart(2, "0")}`;
  return on;
}

/** A schedule as stored (jsonb): only well-formed entries, one per quarter. */
export function parseSchedule(value: unknown): ScheduleEntry[] {
  if (!Array.isArray(value)) return [];
  const out: ScheduleEntry[] = [];
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) continue;
    const { quarter, month, day, nextYear } = raw as Record<string, unknown>;
    if (
      typeof quarter === "number" &&
      isQuarter(quarter) &&
      typeof month === "number" &&
      Number.isInteger(month) &&
      month >= 1 &&
      month <= 12 &&
      typeof day === "number" &&
      Number.isInteger(day) &&
      day >= 1 &&
      day <= 28 &&
      typeof nextYear === "boolean" &&
      !out.some((one) => one.quarter === quarter)
    ) {
      out.push({ quarter, month, day, nextYear });
    }
  }
  return out.sort((a, b) => a.quarter - b.quarter);
}

/** "2026 Q2" style key of a quarter, for maps. */
export function quarterKey(year: number, quarter: Quarter): string {
  return `${year}-Q${quarter}`;
}

/**
 * The yearly deductibility limit of pension contributions (GC §7): worker + employer, TFR excluded.
 * Public data, versioned by the year it applies from.
 */
export const DEDUCTIBILITY_LIMITS: readonly { from: number; cents: Cents }[] = [
  { from: 2007, cents: 516_457n },
  { from: 2026, cents: 530_000n },
];

export function deductibilityLimit(year: number): Cents | null {
  let found: Cents | null = null;
  for (const limit of DEDUCTIBILITY_LIMITS) if (year >= limit.from) found = limit.cents;
  return found;
}

export interface Tariff {
  item: string;
  amountCents: Cents | null;
  /** A yearly fraction of the assets, as text ("0.000800"). */
  rate: string | null;
  unit: "once" | "year" | "year_of_assets" | "request";
  note: string | null;
}

/**
 * Cometa's cost sheet in force from 2026-07-31 (GC §6.1): public data, versioned by `validFrom`.
 * It explains the fees; the charges in the imported operations are what count (GC §6.2).
 */
export const COMETA_TARIFF: { provider: string; validFrom: CivilDate; items: readonly Tariff[] } = {
  provider: "cometa",
  validFrom: "2026-07-31",
  items: [
    { item: "enrollment_worker", amountCents: 516n, rate: null, unit: "once", note: null },
    { item: "enrollment_employer", amountCents: 516n, rate: null, unit: "once", note: null },
    { item: "association", amountCents: 1200n, rate: null, unit: "year", note: "quarterly" },
    {
      item: "management_monetario_plus",
      amountCents: null,
      rate: "0.000400",
      unit: "year_of_assets",
      note: null,
    },
    { item: "management_sicurezza", amountCents: null, rate: "0.005800", unit: "year_of_assets", note: null },
    { item: "management_reddito", amountCents: null, rate: "0.000600", unit: "year_of_assets", note: null },
    { item: "management_crescita", amountCents: null, rate: "0.000800", unit: "year_of_assets", note: null },
    { item: "advance", amountCents: 1000n, rate: null, unit: "request", note: "online_half" },
    { item: "transfer", amountCents: 1000n, rate: null, unit: "request", note: "online_half" },
    { item: "redemption", amountCents: 1000n, rate: null, unit: "request", note: "online_half" },
    { item: "switch", amountCents: 1000n, rate: null, unit: "request", note: "first_free" },
    { item: "beneficiary", amountCents: 500n, rate: null, unit: "request", note: "first_free" },
    { item: "assignment", amountCents: 2000n, rate: null, unit: "request", note: null },
  ],
};

/**
 * What an applied payslip hands the pension fund (plan F6 §3.3, §3.4.2): built by payroll, which
 * owns the payslip's fields, and stored here as it comes. `null` where the payslip has no such line.
 */
export interface CompetenceInput {
  payslipId: string;
  /** The month paid (1st of the month); `null` for a 13th. */
  payrollPeriod: CivilDate | null;
  payslipType: string;
  year: number;
  quarter: Quarter;
  workerCents: Cents | null;
  employerCents: Cents | null;
  tfrCents: Cents | null;
  workerEnrollmentCents: Cents | null;
  employerEnrollmentCents: Cents | null;
  workerAdjustmentCents: Cents | null;
  employerAdjustmentCents: Cents | null;
  sourceLineIds: string[];
}
