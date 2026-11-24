// The words of a connection's state that the server keeps under one value (UX review, points 2 and 4):
// one place for the rows of Settings › Plugins and the short row of an account's page.
import type { RowStatusValue } from "@ledgerly/ui/connection-row";

/** The value a row draws: a key that may only read, and a connection read by hand, have their own. */
export function rowValue(status: { value: RowStatusValue; text: string }): RowStatusValue {
  if (status.text === "readOnly") return "readOnly";
  return status.text === "pausedSchedule" ? "manual" : status.value;
}

/** «Turn on automatic update» for a connection read by hand, not «Turn on again» (point 2). */
export const resumeLabel = (text: string) =>
  text === "pausedSchedule" ? "actions.resumeSchedule" : "actions.resume";
