// The days of `GET /timeoff/{year}` as the leave board works from them: the table's rows of days, and
// the ones still booked as the calendar and the panel's preview weigh them.
import type { timeoff } from "@ledgerly/api-contract/timeoff";
import type { RouteOutput } from "@ledgerly/api-client";
import { type LeaveDayView, stillBooked } from "@ledgerly/domain/timeoff/client";
import type { BookedLeave } from "./leave-panel";

type LeaveRow = RouteOutput<typeof timeoff.getTimeOff>["rows"][number];

/** The rows of days, for the panel to open in edit and the table's buttons. */
export function bookedOf(rows: readonly LeaveRow[]): BookedLeave[] {
  return rows
    .filter((row): row is Extract<LeaveRow, { source: "day" }> => row.source === "day")
    .map((row) => ({
      id: row.id,
      on: row.on,
      kind: row.kind,
      fraction: row.fraction,
      note: row.note,
      origin: row.origin,
      pending: row.sync,
    }));
}

/** The rows still booked: one the external calendar still holds is removed for its owner already. */
export function liveDays(days: readonly BookedLeave[]): LeaveDayView[] {
  return days.filter(stillBooked).map((day) => ({ on: day.on, kind: day.kind, fraction: day.fraction }));
}
