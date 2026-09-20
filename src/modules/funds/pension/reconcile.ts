import {
  addDays,
  addMonths,
  type CivilDate,
  lastDayOfMonth,
  type MonthKey,
  monthKey,
} from "@/platform/dates";
import type { Cents } from "@/platform/money";
import {
  type Component,
  type Decision,
  dueDate,
  type OperationClass,
  type Quarter,
  quarterKey,
  type ScheduleEntry,
} from "./rules";

/**
 * Reconciliation (spec §7.7; GC §10–11; plan F6 §3.4.6): what the payslips accrued for each quarter
 * against what the fund credited for it, component by component, many to many. Pure: the caller
 * reads the rows and today's date.
 */

export const STATUSES = [
  "accrued_not_due",
  "transferred",
  "to_verify",
  "present",
  "invested",
  "reconciled",
  "discrepancy",
  "incomplete",
] as const;
export type Status = (typeof STATUSES)[number];

/** Why a quarter's data is incomplete: a payslip of its own is missing, or the export is older
 * than the deadline it would have to cover. "No export at all" is not one of them: a fund fed by
 * the payslips alone is complete, and its quarters read `transferred` once their deadline is past. */
export type IncompleteReason = "missing_payslip" | "stale_export";

export interface CompetenceLike {
  id: string;
  year: number;
  quarter: number;
  payrollPeriod: CivilDate | null;
  workerCents: Cents | null;
  employerCents: Cents | null;
  tfrCents: Cents | null;
  workerEnrollmentCents: Cents | null;
  employerEnrollmentCents: Cents | null;
}

export interface OperationLike {
  id: string;
  classification: OperationClass;
  competenceYear: number | null;
  competenceQuarter: number | null;
  operationDate: CivilDate;
  workerCents: Cents;
  employerCents: Cents;
  tfrCents: Cents;
  otherCents: Cents;
  feesCents: Cents;
  netCents: Cents;
  /** Units bought, summed over its movements, as decimal text ("30.427"); "0" when none. */
  units: string;
}

export interface DecisionLike {
  year: number;
  quarter: number;
  component: Component;
  decision: Decision;
  differenceCents: Cents;
  note: string;
}

export interface ReconcileInput {
  competences: readonly CompetenceLike[];
  operations: readonly OperationLike[];
  decisions: readonly DecisionLike[];
  schedule: readonly ScheduleEntry[];
  toleranceDays: number;
  /**
   * When the latest applied export was received (plan F6 §3.6.7): an export lists every operation
   * up to that day, so only one received after a deadline can say a credit is missing.
   */
  freshness: CivilDate | null;
  today: CivilDate;
}

export interface ComponentStatus {
  component: Component;
  /** `null` when no payslip of the quarter is known. */
  accruedCents: Cents | null;
  /** `null` when no operation of the quarter is known. */
  creditedCents: Cents | null;
  /** Credited − accrued, when both are known. */
  differenceCents: Cents | null;
  status: Status;
  /** The reviewer's word, when it still matches the difference. */
  decision: DecisionLike | null;
  competenceIds: string[];
  operationIds: string[];
}

export interface QuarterStatus {
  year: number;
  quarter: Quarter;
  due: CivilDate | null;
  /** The due date plus the display tolerance: before it, a missing credit is not late. */
  toleranceUntil: CivilDate | null;
  status: Status;
  reason: IncompleteReason | null;
  components: ComponentStatus[];
  /** The ordinary months of the quarter whose payslip is expected by now but missing. */
  missingMonths: MonthKey[];
  /** The contribution operations of the quarter, their dates, fees, net and units. */
  operationDates: CivilDate[];
  feesCents: Cents;
  netCents: Cents;
  invested: boolean;
}

const MAIN: readonly Component[] = ["worker", "employer", "tfr"];

/** Worst first: the quarter shows the most urgent of its components. */
const SEVERITY: readonly Status[] = [
  "discrepancy",
  "to_verify",
  "incomplete",
  "accrued_not_due",
  "transferred",
  "present",
  "invested",
  "reconciled",
];

function sum(values: readonly (Cents | null)[]): Cents {
  return values.reduce<Cents>((total, value) => total + (value ?? 0n), 0n);
}

function accruedOf(component: Component, competence: CompetenceLike): Cents | null {
  switch (component) {
    case "worker":
      return competence.workerCents;
    case "employer":
      return competence.employerCents;
    case "tfr":
      return competence.tfrCents;
    case "enrollment":
      return sum([competence.workerEnrollmentCents, competence.employerEnrollmentCents]);
  }
}

function creditedOf(component: Component, operation: OperationLike): Cents {
  switch (component) {
    case "worker":
      return operation.workerCents;
    case "employer":
      return operation.employerCents;
    case "tfr":
      return operation.tfrCents;
    case "enrollment":
      return operation.workerCents + operation.employerCents + operation.tfrCents + operation.otherCents;
  }
}

function hasUnits(units: string): boolean {
  return /[1-9]/.test(units);
}

/** Every quarter a payslip or a contribution speaks of, oldest first. */
export function reconcile(input: ReconcileInput): QuarterStatus[] {
  const keys = new Map<string, { year: number; quarter: Quarter }>();
  for (const competence of input.competences) {
    keys.set(quarterKey(competence.year, competence.quarter as Quarter), {
      year: competence.year,
      quarter: competence.quarter as Quarter,
    });
  }
  const credits = input.operations.filter(
    (operation) =>
      (operation.classification === "contribution" || operation.classification === "enrollment") &&
      operation.competenceYear !== null &&
      operation.competenceQuarter !== null,
  );
  for (const operation of credits) {
    const year = operation.competenceYear!;
    const quarter = operation.competenceQuarter as Quarter;
    keys.set(quarterKey(year, quarter), { year, quarter });
  }

  // The payslips expected by now: every month from the first one known whose month has ended.
  const periods = input.competences.flatMap((competence) =>
    competence.payrollPeriod ? [competence.payrollPeriod] : [],
  );
  const firstMonth = periods.length > 0 ? monthKey([...periods].sort()[0]) : null;
  const known = new Set(periods.map((period) => monthKey(period)));

  return [...keys.values()]
    .sort((a, b) => a.year - b.year || a.quarter - b.quarter)
    .map(({ year, quarter }) => {
      const due = dueDate(year, quarter, input.schedule);
      const toleranceUntil = due === null ? null : addDays(due, input.toleranceDays);
      const competences = input.competences.filter(
        (competence) => competence.year === year && competence.quarter === quarter,
      );
      const operations = credits.filter(
        (operation) => operation.competenceYear === year && operation.competenceQuarter === quarter,
      );
      const contributions = operations.filter((operation) => operation.classification === "contribution");
      const enrollments = operations.filter((operation) => operation.classification === "enrollment");

      const missingMonths: MonthKey[] = [];
      if (firstMonth !== null) {
        const start: MonthKey = `${year}-${String((quarter - 1) * 3 + 1).padStart(2, "0")}-01`;
        for (let offset = 0; offset < 3; offset += 1) {
          const month = addMonths(start, offset);
          if (month >= firstMonth && lastDayOfMonth(month) < input.today && !known.has(month)) {
            missingMonths.push(month);
          }
        }
      }
      const pastTolerance = toleranceUntil !== null && input.today > toleranceUntil;
      const freshEnough =
        input.freshness !== null && toleranceUntil !== null && input.freshness > toleranceUntil;
      const invested = contributions.some((operation) => hasUnits(operation.units));

      const componentStatus = (component: Component): ComponentStatus => {
        const pool = component === "enrollment" ? enrollments : contributions;
        const accrued =
          competences.length === 0 ? null : sum(competences.map((one) => accruedOf(component, one)));
        const credited =
          pool.length === 0 ? null : sum(pool.map((operation) => creditedOf(component, operation)));
        const difference = accrued !== null && credited !== null ? credited - accrued : null;
        const recorded = input.decisions.find(
          (decision) =>
            decision.year === year && decision.quarter === quarter && decision.component === component,
        );
        const decision =
          recorded && difference !== null && recorded.differenceCents === difference ? recorded : null;
        let status: Status;
        if (credited !== null) {
          if (accrued === null)
            status = pool.some((operation) => hasUnits(operation.units)) ? "invested" : "present";
          else if (missingMonths.length > 0) status = "incomplete";
          else if (difference === 0n) status = "reconciled";
          else if (decision?.decision === "accepted_difference") status = "reconciled";
          else status = "discrepancy";
        } else if ((accrued ?? 0n) === 0n) {
          // Nothing accrued, nothing credited: there is nothing to wait for.
          status = missingMonths.length > 0 ? "incomplete" : "reconciled";
        } else if (!pastTolerance) status = "accrued_not_due";
        else if (freshEnough && missingMonths.length === 0) status = "to_verify";
        // Past the deadline with no export at all: there is nothing for the fund's documents to
        // contradict, and the schedule in Settings is what says when the money leaves (owner,
        // 2026-09-20). Calling that "incomplete data" accused the person of a missing file they
        // were never asked for. An export, once there is one, takes the verdict back.
        else if (input.freshness === null && missingMonths.length === 0) status = "transferred";
        else status = "incomplete";
        return {
          component,
          accruedCents: accrued,
          creditedCents: credited,
          differenceCents: difference,
          status,
          decision,
          competenceIds: competences.map((one) => one.id),
          operationIds: pool.map((operation) => operation.id),
        };
      };

      const components = [...MAIN, "enrollment" as const]
        .map(componentStatus)
        .filter(
          (one) => one.component !== "enrollment" || one.accruedCents !== 0n || one.creditedCents !== null,
        );
      const worst =
        SEVERITY.find((status) => components.some((one) => one.status === status)) ?? "reconciled";
      let reason: IncompleteReason | null = null;
      if (components.some((one) => one.status === "incomplete")) {
        reason = missingMonths.length > 0 ? "missing_payslip" : "stale_export";
      }
      return {
        year,
        quarter,
        due,
        toleranceUntil,
        status: worst,
        reason,
        components,
        missingMonths,
        operationDates: [...new Set(contributions.map((operation) => operation.operationDate))].sort(),
        feesCents: sum(contributions.map((operation) => operation.feesCents)),
        netCents: sum(contributions.map((operation) => operation.netCents)),
        invested,
      };
    });
}

/** A quarter's accrued total, the three main components (enrolment apart, GC §8.2). */
export function accruedTotal(quarter: QuarterStatus): Cents | null {
  const main = quarter.components.filter((one) => MAIN.includes(one.component));
  if (main.every((one) => one.accruedCents === null)) return null;
  return sum(main.map((one) => one.accruedCents));
}

/** A quarter's credited total, the three main components. */
export function creditedTotal(quarter: QuarterStatus): Cents | null {
  const main = quarter.components.filter((one) => MAIN.includes(one.component));
  if (main.every((one) => one.creditedCents === null)) return null;
  return sum(main.map((one) => one.creditedCents));
}

/** True while nothing was credited for the quarter yet: its accrued amount is still to come. */
export function awaitingCredit(quarter: QuarterStatus): boolean {
  return quarter.components
    .filter((one) => MAIN.includes(one.component))
    .every((one) => one.creditedCents === null);
}

export { MAIN as MAIN_COMPONENTS };
