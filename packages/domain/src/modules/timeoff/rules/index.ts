/**
 * The vocabulary of time off, and every rule about it that needs no database (spec §7.9).
 *
 * The types of leave are data of the person since R5g (E6): a rule takes them as a list. A row is
 * half a day or a whole one, or hours for a type counted in hours. The totals are held in
 * **minutes** because a payslip states leave in hours and an allowance in days, and minutes are
 * the finer of the two. The bridge is `minutes_per_day` from the user's preferences.
 */
export {
  LEAVE_UNITS,
  LEAVE_COLORS,
  EXTERNAL_STATES,
  PENDING_STATES,
  DAY_FRACTIONS,
  DEFAULT_WORK_DAYS,
  calendarWordOf,
  stillBooked,
  minutesToDays,
  daysToMinutes,
  isRestDay,
  bookable,
  dayStatus,
  minuteWeight,
  fractionOfMinutes,
  byTypeOrder,
} from "./days";
export type { LeaveColor, LeaveDayView, LeaveType, LeaveUnit } from "./days";
export { RESIDUAL_BASES, residual, monthBars, calendar, leaveYearMonths } from "./residual";
export type {
  ResidualBasis,
  ResidualInput,
  ResidualView,
  MonthBar,
  CalendarCell,
  CalendarContext,
  CalendarMonth,
} from "./residual";
export {
  allowanceInputSchema,
  leaveInputSchema,
  leaveRangeInputSchema,
  leaveRemovalRangeSchema,
  leaveSettingsInputSchema,
  leaveTypeInputSchema,
  leaveUndoSchema,
  restDayInputSchema,
  MAX_RANGE_DAYS,
  datesBetween,
} from "./inputs";
export type {
  AllowanceInput,
  LeaveInput,
  LeaveRangeFields,
  LeaveSettingsInput,
  LeaveTypeInput,
  LeaveUndo,
  RestDayInput,
} from "./inputs";
export { otherHalfOf, rangeParts, previewLeaveRange } from "./ranges";
export { unrecordedLeave, yearTotals, monthGroups } from "./totals";
export type { TypeMinutes, UnrecordedLeave, YearTotals, MonthGroup } from "./totals";
