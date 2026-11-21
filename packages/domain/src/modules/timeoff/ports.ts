// The port and the event of time off (audit TOF-1, TOF-3; 10-modularity.md §10.3): the external
// calendar the days off are kept level with, declared here and realised by its integration (a
// plugin from R5c). The application wires it once per process (`wireDomain` in `apps/api`): a port that is
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

// On `globalThis`, as the pool of the database: one process may load this file in more than one
// bundle (Next.js), and the wiring of one must be seen by the others.
declare global {
  var ledgerlyLeaveCalendar: LeaveCalendarSync | undefined;
}

/** Wires the port; the application calls it once per process, before any request or job. */
export function wireTimeoff(ports: { calendar: LeaveCalendarSync }): void {
  globalThis.ledgerlyLeaveCalendar = ports.calendar;
}

export function calendarSync(): LeaveCalendarSync {
  return globalThis.ledgerlyLeaveCalendar ?? notWired();
}

function notWired(): never {
  throw new Error("timeoff: the ports are not wired (wireDomain of @ledgerly/api)");
}
