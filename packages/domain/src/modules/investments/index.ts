// The public interface of this unit (docs/design/rewrite-plan/10-modularity.md §10.3, rule M7).
export { ACTIVITY_FAMILIES, describeEvent, priceText, quantityText } from "./activity";
export type { ActivityFamily } from "./activity";
export {
  MANUAL_PROVIDER,
  PORTFOLIO_PROVIDER,
  PROVIDER_SCHEDULE,
  accountTypeOf,
  connectableProvider,
  providerOf,
} from "./catalog";
export { managedSinceOf, serviceAccountIds, syncedServicesOf } from "./managed";
export { SECTION_PRESETS, legacyPeriodQuery, periodSpan, sectionPeriod, yearQuery } from "./period";
export type { Query } from "./period";
export type { HoldingPnl, PeriodParams, PnlParts, PositionAt, ServicePnl } from "./pnl";
export { portfolioMeasure } from "./pnl";
export { closedGroups, contributionsOf, onCostOf, periodReturnOf } from "./positions";
export type { ClosedGroup } from "./positions";
export {
  ACTIVITY_PAGE_SIZE,
  catalogView,
  investmentOperationsExport,
  investmentsExport,
  investmentsHome,
  investmentsPnl,
  investmentsPnlView,
  investmentsPortfolio,
  investmentsSnapshot,
  serviceActivity,
  serviceDetail,
  serviceHoldings,
  serviceMovements,
  servicePnlView,
  servicePositions,
} from "./queries";
export type {
  ActivityRow,
  HoldingRow,
  InvestmentsPnl,
  InvestmentsSnapshot,
  Portfolio,
  ServiceDetail,
  ServiceSummary,
} from "./queries";
export {
  BROKER_PRODUCTS,
  PRICE_SCALE,
  PRODUCTS,
  QUANTITY_SCALE,
  RATE_SCALE,
  STALE_VALUE_DAYS,
  plainDecimal,
  unitPriceOf,
} from "./rules";
export {
  InvestmentError,
  confirmZeroReading,
  createManualService,
  createManualServiceWithAccount,
  backfillPlan,
  confirmRun,
  convertToPortfolio,
  createPlan,
  linkRunDebit,
  linkedPayeeKeys,
  listPastRuns,
  listPlans,
  listRuns,
  plansOfEvents,
  plansToDo,
  runDuePlans,
  skipRun,
  updatePlan,
  createPortfolio,
  createPortfolioWithAccount,
  addAsset,
  assetPrices,
  isPortfolio,
  pricedMarkets,
  revalueAfterPrices,
  setPriceMode,
  deleteOperation,
  ensureAssetSeed,
  linkTransfer,
  listInvestmentAccounts,
  reconcileHolding,
  recordOperation,
  transfersToConfirm,
  unlinkTransfer,
  updateServiceUrl,
  updateServiceValue,
} from "./service";
export type {
  AssetPrice,
  Backfill,
  InvestmentAsset,
  InvestmentPlan,
  InvestmentPlanRun,
  ManualServiceInput,
  OperationInput,
  PastRuns,
  PlanFact,
  PlanInput,
  PlanUpdate,
  PlanView,
  RunConfirmation,
  RunView,
} from "./service";
export {
  SyncError,
  confirmKeyRevoked,
  connectInvestmentProvider,
  readFirstFlows,
  disconnectProvider,
  investmentProviderName,
  replaceKey,
  runInvestmentPass,
  checkSyncNow,
  verifyKey,
} from "./sync";
export type { ConnectTarget } from "./sync";
export type { Xirr } from "../../shared/returns";
export { managedAccountsOfInvestments, wireInvestments } from "./ports";
