// The public interface of this unit (docs/design/rewrite-plan/10-modularity.md §10.3, rule M7).
export { alertSettings, budgetDetail, budgetsView } from "./queries";
export {
  ALERT_PRESETS,
  DEFAULT_ALERT_SETTINGS,
  budgetName,
  budgetSlug,
  closestToLimit,
  parseBudgetSlug,
  percentOf,
  reachedThreshold,
  thresholdReached,
} from "./rules";
export type { AlertSettings, BudgetRow, BudgetScope } from "./rules";
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
