// The `payroll` source of a pension fund (audit PAY-5, FND-11; 10-modularity.md §10.11, E2): it
// listens to payroll's `PayslipApplied` and `PayslipWithdrawn`, decides the quarter and which lines
// carry pension money, and writes the competence. Payroll knows nothing of funds: the application
// wires this listener (`wireDomain` in `apps/api`).
import type { Ctx } from "../../../platform/context";
import type { Tx } from "../../../platform/db/client";
import type { Cents } from "../../../shared/money";
import { type CompetenceInput, quarterOfMonth } from "./rules";
import { dropCompetence, recordCompetence } from "./service";

/** What a fund reads of an applied payslip: payroll's event, as this module needs it. */
export interface AppliedPayslip {
  payslipId: string;
  year: number;
  period: string | null;
  kind: string;
  extraNumber: number | null;
  printedOn: string | null;
  workerCents: Cents | null;
  employerCents: Cents | null;
  tfrCents: Cents | null;
  workerEnrollmentCents: Cents | null;
  employerEnrollmentCents: Cents | null;
  workerAdjustmentCents: Cents | null;
  employerAdjustmentCents: Cents | null;
  lines: readonly { id: string; role: string }[];
}

/** The body codes that carry pension money (GC §8.3), by the role the code map gives them. */
export const FUND_ROLES: readonly string[] = [
  "employee_fund",
  "employee_fund_adjustment",
  "employee_fund_enrollment",
  "employer_fund",
  "employer_fund_adjustment",
  "employer_fund_enrollment",
  "tfr_contribution",
];

/**
 * What an applied payslip accrued for the pension fund (spec §7.7; plan F6 §3.4.2; GC §8.2–8.3):
 * - worker = the effective quota: a 13th carries its own net quota;
 * - employer = the printed quota only: the 13th has none, and its adjustment is kept apart, never
 *   added — December's summary already includes it (GC §8.3);
 * - TFR = the contribution line only, never the month's "TFR MESE" box (GC §8.2);
 * - enrolment apart.
 * The quarter is the month's; a 13th belongs to the fourth. A 14th or 15th takes the quarter of
 * the day it was printed; a 15th with no such day, having no fixed month, falls back to the fourth.
 * `null` when no quarter can be told.
 */
/** The employer's n-th extra payment: the first is a 13th, the third a 15th. */
const extraPayment = (payslip: AppliedPayslip, number: number) =>
  payslip.kind === "extra" && payslip.extraNumber === number;

export function competenceOf(payslip: AppliedPayslip): CompetenceInput | null {
  const quarter =
    payslip.period !== null
      ? quarterOfMonth(payslip.period)
      : extraPayment(payslip, 1)
        ? 4
        : payslip.printedOn !== null && payslip.printedOn.startsWith(String(payslip.year))
          ? quarterOfMonth(payslip.printedOn)
          : extraPayment(payslip, 3)
            ? 4
            : null;
  if (quarter === null) return null;
  return {
    payslipId: payslip.payslipId,
    payrollPeriod: payslip.period,
    kind: payslip.kind,
    extraNumber: payslip.extraNumber,
    year: payslip.year,
    quarter,
    workerCents: payslip.workerCents,
    employerCents: payslip.employerCents,
    tfrCents: payslip.tfrCents,
    workerEnrollmentCents: payslip.workerEnrollmentCents,
    employerEnrollmentCents: payslip.employerEnrollmentCents,
    workerAdjustmentCents: payslip.workerAdjustmentCents,
    employerAdjustmentCents: payslip.employerAdjustmentCents,
    sourceLineIds: payslip.lines.filter((line) => FUND_ROLES.includes(line.role)).map((line) => line.id),
  };
}

/** The competences of every applied payslip, for a fund to publish from scratch. */
export function competencesFromPayslips(payslips: readonly AppliedPayslip[]): CompetenceInput[] {
  return payslips.flatMap((payslip) => competenceOf(payslip) ?? []);
}

/** The listener the application wires to payroll: the payslip's competence in the same transaction. */
export const payrollSource = {
  async applied(ctx: Pick<Ctx, "userId">, payslip: AppliedPayslip, transaction: Tx): Promise<void> {
    const competence = competenceOf(payslip);
    if (competence) await recordCompetence(ctx, competence, transaction);
  },
  withdrawn(ctx: Pick<Ctx, "userId">, payslipId: string, transaction: Tx): Promise<void> {
    return dropCompetence(ctx, payslipId, transaction);
  },
};
