// src/modules/investments/queries — the reads of the section: one snapshot of the books per request
// (audit INV-4), and the views that derive from it.
export { investmentsSnapshot } from "./snapshot";
export type { InvestmentsSnapshot } from "./snapshot";
export type { ServiceSummary } from "./summary";
export { investmentsHome, investmentsPortfolio } from "./home";
export type { AllocationSlice, InvestmentsHome, Portfolio } from "./home";
export { catalogView } from "./catalog";
export type { CatalogView } from "./catalog";
export { serviceHoldings } from "./holdings";
export type {
  HoldingRow,
  LinkOption,
  OperationLeg,
  OperationRow,
  ServiceDetail,
  TransferProposalRow,
} from "./holdings";
export { serviceDetail } from "./detail";
export { investmentOperationsExport, investmentsExport } from "./export";
export { investmentsPnl, investmentsPnlView, servicePnlView, servicePositions } from "./views";
export type { InvestmentsPnl, InvestmentsPnlView, PnlChartService, ServicePositions } from "./views";
export { ACTIVITY_PAGE_SIZE, serviceActivity, serviceMovements } from "./activity-tab";
export type { ActivityQuery, ActivityRow, ServiceActivity, ServiceMovement } from "./activity-tab";
