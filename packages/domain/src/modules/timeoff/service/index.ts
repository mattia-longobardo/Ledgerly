// The services of time off (spec §7.9), by what they keep: the records of allowances and days, the
// ranges of the leave panel with their use cases, and what the pass of the external calendar needs
// (audit TOF-8: one file of 730 lines, split without changing a function).
export {
  type Allowance,
  type LeaveDay,
  MAX_RANGE_DAYS,
  TimeOffError,
  allowanceOf,
  deleteLeaveDay,
  listAllowances,
  listLeaveDays,
  saveAllowance,
  saveLeaveDay,
  yearWindow,
} from "./records";
export {
  clearDay,
  removeLeave,
  removeLeaveRange,
  restoreLeave,
  saveLeaveRange,
  toldCalendar,
} from "./ranges";
export {
  type Observed,
  type TrekDay,
  closePendingDeletes,
  datesHeld,
  forgetPendingDays,
  markRefused,
  markSynced,
  pendingCount,
  pendingForTrek,
  recordFromTrek,
  trekDaysOf,
  yearsWithPending,
} from "./external";
