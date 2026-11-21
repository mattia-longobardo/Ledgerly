import { type CivilDate, type MonthKey } from "../../../shared/dates";
import type { Cents } from "../../../shared/money";
import type { PeriodFees } from "../fees";

/**
 * The payslip side of a fund (spec §7.7; the owner's guide to the fund, "GC" below): the lists the
 * tables check and the small pure helpers every part of it shares. The due dates of a transfer and
 * the fees are data of the fund now: `../sources.ts` and `../fees.ts`.
 */

/** The classes a person can write by hand: a contribution, and the operations that are not one. */
export type ManualClass =
  "voluntary" | "contribution" | "enrollment" | "transfer_in" | "switch" | "withdrawal";

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

/**
 * Who wrote an operation: a person, the job that finds a recurring debit among the movements, or —
 * before release N6 — a document. `import` stays as history: nothing writes it any more.
 */
export const OPERATION_SOURCES = ["import", "manual", "rule"] as const;
export type OperationSource = (typeof OPERATION_SOURCES)[number];

/** The components reconciled one by one (GC §9.1), the enrolment on its own. */
export const COMPONENTS = ["worker", "employer", "tfr", "enrollment"] as const;
export type Component = (typeof COMPONENTS)[number];

export const DECISIONS = ["accepted_difference", "pending"] as const;
export type Decision = (typeof DECISIONS)[number];

/** A quarter of a year, as a payslip states it. A source that accrues by month counts 1 to 12. */
type Quarter = 1 | 2 | 3 | 4;

/**
 * The fees the fund takes off a payslip period (GC §6.1), as its list of fees estimates them
 * (`periodFees`): the joining fee, out of the enrolment quotas, and the fee of each transfer. They
 * make the payslips' figures net while no operation says what was actually charged.
 */
export type { PeriodFees as PensionFees } from "../fees";
export { NO_PERIOD_FEES as NO_FEES } from "../fees";

/**
 * What a period's transfer leaves in the fund once its fees are off: the transfer's fee out of the
 * contribution, the joining fee out of the enrolment quotas — never more than those quotas.
 */
export function netOfFees(
  contributionCents: Cents,
  enrollmentCents: Cents,
  fees: PeriodFees,
): { grossCents: Cents; feesCents: Cents; netCents: Cents } {
  const quarterFee = contributionCents > 0n ? fees.quarterCents : 0n;
  const enrollmentFee =
    enrollmentCents > 0n
      ? fees.enrollmentCents < enrollmentCents
        ? fees.enrollmentCents
        : enrollmentCents
      : 0n;
  const grossCents = contributionCents + enrollmentCents;
  const feesCents = quarterFee + enrollmentFee;
  return { grossCents, feesCents, netCents: grossCents - feesCents };
}

/** How long after a due date a missing credit is still shown as on its way (design; GC §11). */
export const DEFAULT_TOLERANCE_DAYS = 15;

/** The quarter of a month ("2026-05" → 2). */
export function quarterOfMonth(month: MonthKey | CivilDate): Quarter {
  return (Math.floor((Number(month.slice(5, 7)) - 1) / 3) + 1) as Quarter;
}

/** "2026 Q2" style key of a period, for maps. */
export function quarterKey(year: number, quarter: number): string {
  return `${year}-Q${quarter}`;
}

/**
 * What an applied payslip accrued for the pension fund (plan F6 §3.3, §3.4.2): built by the
 * `payroll` source from payroll's `PayslipApplied`, and stored here as it comes. `null` where the payslip has no such line.
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
