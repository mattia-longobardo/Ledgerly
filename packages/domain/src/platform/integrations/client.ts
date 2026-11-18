// The browser's entry of this unit: the pure names the client components use (R0). Nothing here
// may reach the database, the network or a secret: a client component bundles every file it names.
export {
  LAST_DAY,
  MAX_RULES,
  MAX_TIMES,
  MIN_SYNC_GAP_MINUTES,
  minutesOf,
  nextSyncTimes,
  scheduleProblems,
  syncRuleSchema,
  syncScheduleSchema,
} from "./schedule";
export type { RuleKind, ScheduleProblem, SyncDays, SyncRule, SyncSchedule } from "./schedule";
