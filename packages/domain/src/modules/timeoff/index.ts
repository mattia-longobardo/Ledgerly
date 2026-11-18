// The public interface of this unit (docs/design/rewrite-plan/10-modularity.md §10.3, rule M7).
export { forecastChange } from "./accrual";
export type { AccrualView, ForecastInput, Overdrawn } from "./accrual";
export { timeOffView } from "./queries";
export type { KindView, LeaveRow } from "./queries";
export {
  LEAVE_DAY_KINDS,
  LEAVE_TYPES,
  MAX_RANGE_DAYS,
  calendar,
  otherHalfOf,
  previewLeaveRange,
  stillBooked,
} from "./rules";
export type {
  CalendarCell,
  CalendarMonth,
  LeaveDayKind,
  LeaveDayView,
  LeaveType,
  LeaveUndo,
  MonthBar,
  MonthGroup,
  ResidualInput,
  ResidualView,
} from "./rules";
export {
  TimeOffError,
  allowanceOf,
  closePendingDeletes,
  forgetPendingDays,
  listAllowances,
  listLeaveDays,
  pendingCount,
  removeLeave,
  removeLeaveRange,
  restoreLeave,
  saveAllowance,
  saveLeaveRange,
} from "./service";
export type { Allowance } from "./service";
