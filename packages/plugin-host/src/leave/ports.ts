/**
 * What the leave engine needs from the domain (rewrite plan R5c, step P3b): the services of time off,
 * by the port the application wires (rule M8: only the application joins a port and its adapter,
 * `apps/api`). Nothing here imports a module: the shapes are the ones the engine reads and writes.
 */
import type { Ctx } from "@ledgerly/domain/platform/context";
import type { CivilDate } from "@ledgerly/domain/shared/dates";
import { sinkOf } from "../sinks";

type Who = Pick<Ctx, "userId">;

/** One of the person's days as a pass needs to see it. */
export interface CalendarDay {
  id: string;
  on: CivilDate;
  kind: string;
  fraction: number | null;
  pending: "none" | "upsert" | "delete";
}

/** What a pass observed about one day once it had re-read the year; `kind` `null`: no longer held. */
export interface Observed {
  id: string;
  fraction: number | null;
  kind: string | null;
}

export interface LeaveSink {
  /** The kinds the calendar's own days can be in, and therefore the only ones a write may name. */
  calendarKinds: readonly string[];
  /** What a kind of day off becomes on the calendar. */
  asCalendarKind: (kind: string) => string;
  /** Every day of a year that goes to the calendar, pending or not. */
  daysOf: (ctx: Who, year: number) => Promise<CalendarDay[]>;
  /** Every date of a year the person holds a day on, whatever its kind. */
  datesHeld: (ctx: Who, year: number) => Promise<Set<CivilDate>>;
  /** The years the person has a day waiting to be sent or taken back in, oldest first. */
  yearsWithPending: (ctx: Who) => Promise<number[]>;
  markSynced: (ctx: Who, observed: readonly Observed[], now: Date) => Promise<void>;
  markRefused: (ctx: Who, ids: readonly string[]) => Promise<void>;
  /** A day the calendar holds and the person did not: recorded, already reconciled. */
  recordFromCalendar: (
    ctx: Who,
    day: { on: CivilDate; kind: string; fraction: number },
    now: Date,
  ) => Promise<unknown>;
}

/** The wired port. */
export const leaveSink = (): LeaveSink => sinkOf("leave");
