// The public interface of this unit (docs/design/rewrite-plan/10-modularity.md §10.3, rule M7).
export { ACTIVITY_FAMILIES, describeEvent, priceText, quantityText } from "./activity";
export type { ActivityFamily } from "./activity";
export {
  MANUAL_PROVIDER,
  PROVIDER_SCHEDULE,
  accountTypeOf,
  connectableProvider,
  providerOf,
} from "./catalog";
export { managedSinceOf, serviceAccountIds, syncedServicesOf } from "./managed";
export {
  PERIOD_KEYS,
  SECTION_PRESETS,
  legacyPeriodQuery,
  periodSpan,
  sectionPeriod,
  yearQuery,
} from "./period";
export type { Query } from "./period";
export type { HoldingPnl, PeriodParams, PnlParts, PnlPeriod, PositionAt, ServicePnl } from "./pnl";
export { closedGroups, contributionsOf, onCostOf, periodReturnOf } from "./positions";
export type { ClosedGroup } from "./positions";
export {
  ACTIVITY_PAGE_SIZE,
  catalogView,
  investmentOperationsExport,
  investmentServices,
  investmentsHome,
  investmentsPnl,
  investmentsPnlView,
  investmentsPortfolio,
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
  Portfolio,
  ServiceDetail,
  ServiceSummary,
} from "./queries";
export {
  BROKER_PRODUCTS,
  PRICE_SCALE,
  PRODUCTS,
  QUANTITY_SCALE,
  STALE_VALUE_DAYS,
  formatDecimal,
  parseDecimal,
  plainDecimal,
  unitPriceOf,
} from "./rules";
export type { AdjustmentClass, AssetClass, InvestmentCategory } from "./rules";
export {
  InvestmentError,
  confirmZeroReading,
  createManualService,
  deleteOperation,
  ensureAssetSeed,
  linkTransfer,
  listInvestmentAccounts,
  reconcileHolding,
  recordOperation,
  unlinkTransfer,
  updateServiceUrl,
  updateServiceValue,
} from "./service";
export type { ManualServiceInput, OperationInput } from "./service";
export {
  SyncError,
  confirmKeyRevoked,
  connectInvestmentProvider,
  disconnectProvider,
  investmentProviderName,
  replaceKey,
  runInvestmentPass,
  syncNow,
  verifyKey,
} from "./sync";
export type { ConnectTarget } from "./sync";
export type { Xirr } from "./xirr";
