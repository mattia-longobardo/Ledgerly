// The ports and the event of time off (audit TOF-1, TOF-3, PAY-6; 10-modularity.md §10.3): the
// external calendar the days off are kept level with, realised by its integration (a plugin from
// R5c), and the leave balances a payslip printed, realised by payroll. Both are declared here. The application wires it once per process (`wireDomain` in `apps/api`): a port that is
// not wired fails loudly. The module never names the provider.
import type { Ctx } from "../../platform/context";
import type { CivilDate } from "../../shared/dates";
import {
  calendarDaysOf,
  datesHeld,
  markRefused,
  markSynced,
  recordFromCalendar,
  yearsWithPending,
  yearWindow,
} from "./service";

/** The external calendar of the days off. */
export interface LeaveCalendarSync {
  /** One pass now; null when the person keeps no external calendar. `refused`: what it said no to. */
  passNow(ctx: Ctx): Promise<{ refused: unknown } | null>;
  /** The error of a pass that did not start because one was already running for the person. */
  isBusy(error: unknown): boolean;
  /** Asks the worker for a pass, so a write never waits on the provider; nothing without a calendar. */
  requestPass(ctx: Pick<Ctx, "userId">): Promise<void>;
  /** What the calendar's last pass said of `year`, in days; null without a calendar or that pass. */
  figuresOf(
    ctx: Pick<Ctx, "userId">,
    year: number,
  ): Promise<{ used: number; remaining: number; totalAvailable: number } | null>;
}

/**
 * The word a payslip prints a leave balance and its use under, in hours (PAY-6): payroll's own
 * vocabulary, which a type of leave names as its `balance_key` (R5g). A use payroll counts against
 * another balance arrives under that balance's word.
 */
type BalanceKind = string;

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
  /** The balance the use counts against: `kind` itself, or the balance payroll spends it from. */
  balance: BalanceKind;
  hours: number;
  /** The payslip's own month. */
  payrollPeriod: string;
  /** The month the hours were used in. */
  usagePeriod: string;
}

/** The leave balances of the applied payslips. */
export interface LeaveBalanceSource {
  /** Every balance of every year, oldest first. */
  snapshotHistory(ctx: Pick<Ctx, "userId" | "addons">): Promise<LeaveBalance[]>;
  /** The leave taken in `year`, by the month it was used in, oldest first. */
  eventsOf(ctx: Pick<Ctx, "userId" | "addons">, year: number): Promise<LeaveTaken[]>;
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

/*
 * The days of time off as the leave engine of a plugin with a calendar reads and writes them (rewrite
 * plan R5c, P3b): the adapter of its port, realised here from the module's own services, by year. The
 * application wires it (`wireDomain`); the engine never reaches the module's tables. The words of the
 * calendar are the types' own (R5g): a word no type has is refused by `recordFromCalendar`.
 */
export const calendarDays = {
  daysOf: (ctx: Pick<Ctx, "userId">, year: number) => calendarDaysOf(ctx, yearWindow(year)),
  datesHeld: (ctx: Pick<Ctx, "userId">, year: number) => datesHeld(ctx, yearWindow(year)),
  yearsWithPending,
  markSynced,
  markRefused,
  recordFromCalendar: (
    ctx: Pick<Ctx, "userId">,
    day: { on: CivilDate; kind: string; fraction: number },
    now: Date,
  ) => recordFromCalendar(ctx, day, now),
};
