// The event of time off (audit TOF-3) and the use cases of the leave panel that raise it, as a Server
// Action and a route call them alike: the write, the answer «Undo» sends back, and `LeaveChanged`
// when the external calendar has something to hear. Its one subscriber is the port `LeaveCalendarSync`.
import type { Ctx } from "../../platform/context";
import type { CivilDate } from "../../shared/dates";
import { calendarSync } from "./ports";
import type { LeaveRangeFields, LeaveUndo } from "./rules";
import { removeLeave, removeLeaveRange, restoreLeave, saveLeaveRange, toldCalendar } from "./service";

/**
 * `LeaveChanged`: days the external calendar has to hear about were written, removed or put back. A
 * Server Action and a route raise it alike, through the use cases below.
 */
interface LeaveChanged {
  userId: string;
}

/** Raises `LeaveChanged`; its subscriber asks the external calendar for a pass. */
async function leaveChanged(event: LeaveChanged): Promise<void> {
  await calendarSync().requestPass({ userId: event.userId });
}

/** What a write of the panel answers: the undo, the days written, the rows removed and still owed. */
export interface LeaveAnswer {
  undo: LeaveUndo;
  days: number;
  removed: number;
  pending: number;
}

/** «Confirm» in the leave panel: the whole range in one call. */
export async function bookLeave(ctx: Pick<Ctx, "userId">, fields: LeaveRangeFields): Promise<LeaveAnswer> {
  const result = await saveLeaveRange(ctx, fields);
  if (toldCalendar(result)) await leaveChanged(ctx);
  return { undo: result.undo, days: result.totalDays, removed: 0, pending: 0 };
}

/** «Remove»: one row by its id, or everything on one date. */
export async function unbookLeave(
  ctx: Pick<Ctx, "userId">,
  target: { id: string } | { date: CivilDate },
): Promise<LeaveAnswer> {
  const removed = await removeLeave(ctx, target);
  // Only a removal the external calendar has to hear of is worth a pass.
  if (removed.pending > 0) await leaveChanged(ctx);
  return {
    undo: removed.undo,
    days: 0,
    removed: removed.deleted + removed.pending,
    pending: removed.pending,
  };
}

/** «Remove N days»: everything booked between two dates; nothing there is nothing to undo. */
export async function unbookLeaveRange(
  ctx: Pick<Ctx, "userId">,
  range: { from: CivilDate; to: CivilDate },
): Promise<LeaveAnswer> {
  const removed = await removeLeaveRange(ctx, range);
  if (removed.undo === null)
    return { undo: { dates: [range.from], rows: [] }, days: 0, removed: 0, pending: 0 };
  if (removed.pending > 0) await leaveChanged(ctx);
  return {
    undo: removed.undo,
    days: removed.days,
    removed: removed.deleted + removed.pending,
    pending: removed.pending,
  };
}

/** «Undo» in the toast: the touched days go back to what they held. */
export async function undoLeave(ctx: Pick<Ctx, "userId">, undo: LeaveUndo): Promise<void> {
  if (toldCalendar(await restoreLeave(ctx, undo))) await leaveChanged(ctx);
}
