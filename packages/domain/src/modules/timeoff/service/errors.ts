import type { CivilDate } from "../../../shared/dates";

type TimeOffErrorCode =
  | "not_found"
  | "invalid_input"
  /** The date is not a working day or is a holiday: the reason travels with the error. */
  | "not_bookable"
  /** A range that would write more days than anyone books in one go. */
  | "range_too_long"
  /** A name or a date the person already uses. */
  | "conflict"
  /** A type with days booked: removing it would leave them without one. */
  | "in_use";

export class TimeOffError extends Error {
  constructor(
    readonly code: TimeOffErrorCode,
    /** For `not_bookable`: which dates were refused and why. */
    readonly refused: ReadonlyArray<{ on: CivilDate; reason: "weekend" | "holiday" }> = [],
  ) {
    super(code);
    this.name = "TimeOffError";
  }
}
