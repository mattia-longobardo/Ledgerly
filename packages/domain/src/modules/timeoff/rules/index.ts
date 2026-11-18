/**
 * The vocabulary of time off, and every rule about it that needs no database (spec §7.9).
 *
 * One unit for booking, two for counting. A day off is half a day or a whole one, whatever its
 * kind (N0: ROL used to be free-form minutes, and nobody books leave by the minute). The totals
 * are held in **minutes** because a payslip states ROL in hours and an allowance in days, and
 * minutes are the finer of the two — converting down loses nothing, converting up rounds. The
 * bridge is `minutes_per_day` from the user's preferences; there is no "8 hours" written here.
 */
export {
  LEAVE_DAY_KINDS,
  TREK_KINDS,
  goesToTrek,
  asTrekKind,
  LEAVE_ORIGINS,
  PENDING_STATES,
  stillBooked,
  minutesToDays,
  daysToMinutes,
  bookable,
  dayStatus,
  dayWeight,
  minuteWeight,
} from "./days";
export type { LeaveDayKind, LeaveDayView } from "./days";
export { residual, monthBars, calendar } from "./residual";
export type {
  ResidualBasis,
  ResidualInput,
  ResidualView,
  MonthBar,
  CalendarCell,
  CalendarMonth,
} from "./residual";
export {
  allowanceInputSchema,
  allowanceMismatchDays,
  leaveInputSchema,
  leaveRangeInputSchema,
  leaveRemovalRangeSchema,
  leaveUndoSchema,
  MAX_RANGE_DAYS,
  datesBetween,
} from "./inputs";
export type { AllowanceInput, LeaveInput, LeaveRangeFields, LeaveUndo } from "./inputs";
export { LEAVE_TYPES, otherHalfOf, rangeParts, previewLeaveRange } from "./ranges";
export type { LeaveType } from "./ranges";
export { unrecordedLeave, yearTotals, monthGroups } from "./totals";
export type { UnrecordedLeave, YearTotals, MonthGroup } from "./totals";
