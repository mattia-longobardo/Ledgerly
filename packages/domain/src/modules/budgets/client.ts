// The browser's entry of this unit: the pure names the client components use (R0). Nothing here
// may reach the database, the network or a secret: a client component bundles every file it names.
export { ALERT_PRESETS, MAX_ALERT_THRESHOLDS } from "./rules";
export type { AlertSettings, BudgetScope, BudgetStatus } from "./rules";
