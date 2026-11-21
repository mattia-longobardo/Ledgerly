// src/modules/investments/pnl — the profit and loss of a period (docs/design/investments-ux.md §4,
// U1): what a service and the portfolio earned or lost between two days, split into additive parts,
// with how far the number can be trusted. Pure: no database, no clock. Amounts are bigint cents; the
// one float is a rate of return, a ratio that is never written back.
export { periodOf } from "./period";
export type { PeriodParams, PnlPeriod } from "./period";
export type { AdjustmentClass, CoverageWindow, HoldingPnl, PnlParts, PnlService, ServicePnl } from "./types";
export { replayHoldings } from "./replay";
export type { Exit } from "./replay";
export { firstDayOf, positionsOn } from "./positions";
export type { PositionAt } from "./positions";
export { incomeAndFees, measuredStart, periodFlows } from "./start";
export { attribute, costBases } from "./parts";
export { pnlOf, pnlThrough } from "./measure";
export { portfolioPnl } from "./portfolio";
export type { PortfolioPnl } from "./portfolio";
