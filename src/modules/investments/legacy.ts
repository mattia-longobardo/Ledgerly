/**
 * The movement kinds of the legacy tables (`investment_platforms`, `investment_movements`,
 * `investment_valuations`). Since phase 2 (docs/design/investments.md §7) those tables are read
 * only — a trigger refuses every write — and their rows live on as events of the accounts the
 * migration `0037_investments_v2` created. They are dropped at least 30 days after that deploy.
 */
export const MOVEMENT_KINDS = ["deposit", "withdrawal"] as const;
