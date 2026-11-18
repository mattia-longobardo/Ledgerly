// The browser's entry of this unit: the pure names the client components use (R0). Nothing here
// may reach the database, the network or a secret: a client component bundles every file it names.
export { PERIOD_KEYS, SECTION_PRESETS, periodSpan, sectionPeriod } from "./period";
export type { PnlPeriod } from "./pnl";
export { PRODUCTS } from "./rules";
export type { AdjustmentClass, AssetClass, InvestmentCategory } from "./rules";
