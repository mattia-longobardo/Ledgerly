// The public interface of this unit (docs/design/rewrite-plan/10-modularity.md §10.3, rule M7).
export { alertSettings, budgetDetail, budgetsView } from "./queries";
export {
  ALERT_PRESETS,
  DEFAULT_ALERT_SETTINGS,
  MAX_ALERT_THRESHOLDS,
  budgetSlug,
  parseBudgetSlug,
  percentOf,
  reachedThreshold,
  thresholdReached,
} from "./rules";
export type { AlertSettings, BudgetRow, BudgetScope, BudgetStatus } from "./rules";
export {
  BudgetError,
  categoriesWithLimit,
  limitsOnAccount,
  limitsSnapshot,
  mergeLimits,
  moveLimitsAccount,
  restoreLimits,
  saveAlerts,
  setLimit,
  stopLimit,
  stopLimitsOf,
} from "./service";
export type { LimitsSnapshot } from "./service";
