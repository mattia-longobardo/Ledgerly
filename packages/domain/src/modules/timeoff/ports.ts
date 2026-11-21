// The ports and the event of time off (audit TOF-1, TOF-3, PAY-6; 10-modularity.md §10.3): the
// external calendar the days off are kept level with, realised by its integration (a plugin from
// R5c), and the leave balances a payslip printed, realised by payroll. Both are declared here. The application wires it once per process (`wireDomain` in `apps/api`): a port that is
// not wired fails loudly. The module never names the provider.
import type { Ctx } from "../../platform/context";

/** The external calendar of the days off. */
export interface LeaveCalendarSync {
  /** One pass now; null when the person keeps no external calendar. `refused`: what it said no to. */
  passNow(ctx: Ctx): Promise<{ refused: unknown } | null>;
  /** The error of a pass that did not start because one was already running for the person. */
  isBusy(error: unknown): boolean;
  /** Asks the worker for a pass, so a write never waits on the provider; nothing without a calendar. */
  requestPass(ctx: Pick<Ctx, "userId">): Promise<void>;
}

/**
 * The kinds of leave a payslip prints, in hours (PAY-6): the one vocabulary of the balances. A
 * `permit` is counted as ROL here (`rules/totals.ts`), the one place that maps it.
 */
export const BALANCE_KINDS = ["vacation", "rol", "permit"] as const;
export type BalanceKind = (typeof BALANCE_KINDS)[number];

/** A leave balance as one applied payslip printed it. */
interface LeaveBalance {
  kind: BalanceKind;
  /** The payslip's own month. */
  period: string;
  previousYearHours: number | null;
  accruedHours: number | null;
  usedHours: number | null;
  remainingHours: number | null;
}

/** Leave taken, as an applied payslip accounted for it, in the month it was used. */
interface LeaveTaken {
  kind: BalanceKind;
  hours: number;
  /** The payslip's own month. */
  payrollPeriod: string;
  /** The month the hours were used in. */
  usagePeriod: string;
}

/** The leave balances of the applied payslips. */
export interface LeaveBalanceSource {
  /** Every balance of every year, oldest first. */
  snapshotHistory(ctx: Pick<Ctx, "userId">): Promise<LeaveBalance[]>;
  /** The leave taken in `year`, by the month it was used in, oldest first. */
  eventsOf(ctx: Pick<Ctx, "userId">, year: number): Promise<LeaveTaken[]>;
}

// On `globalThis`, as the pool of the database: one process may load this file in more than one
// bundle (Next.js), and the wiring of one must be seen by the others.
declare global {
  var ledgerlyLeaveCalendar: LeaveCalendarSync | undefined;
  var ledgerlyLeaveBalances: LeaveBalanceSource | undefined;
}

/**
 * Wires the ports; the application calls it once per process, before any request or job. A test
 * may wire one port alone: the other keeps what the application wired.
 */
export function wireTimeoff(ports: { calendar?: LeaveCalendarSync; balances?: LeaveBalanceSource }): void {
  if (ports.calendar) globalThis.ledgerlyLeaveCalendar = ports.calendar;
  if (ports.balances) globalThis.ledgerlyLeaveBalances = ports.balances;
}

export function leaveBalances(): LeaveBalanceSource {
  return globalThis.ledgerlyLeaveBalances ?? notWired();
}

export function calendarSync(): LeaveCalendarSync {
  return globalThis.ledgerlyLeaveCalendar ?? notWired();
}

function notWired(): never {
  throw new Error("timeoff: the ports are not wired (wireDomain of @ledgerly/api)");
}
