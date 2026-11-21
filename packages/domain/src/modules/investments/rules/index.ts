// src/modules/investments/rules — the Investments engine (docs/design/investments.md §2): what
// an investment account is worth on a day, from its dated events, readings and reconciliations
// only. Pure: no database, no clock. Every amount is bigint — cents, or fixed-point decimals for
// quantities, prices and rates — so nothing here ever meets a float.
export {
  ADJUSTMENT_CLASSES,
  ASSET_CLASSES,
  atRate,
  BROKER_PRODUCTS,
  COVERAGE_STATUSES,
  EVENT_ORIGINS,
  HOLDING_ORIGINS,
  INVESTMENT_CATEGORIES,
  KEY_CHECK_ORIGINS,
  KEY_CHECK_RESULTS,
  LEGS,
  MANUAL_MODE,
  MODES,
  NEGATIVE_KINDS,
  OPERATION_KINDS,
  ORIGINS,
  PERIOD_REASONS,
  positionCents,
  POSITIVE_KINDS,
  PRICE_SCALE,
  PRICE_SOURCES,
  PRODUCT_PATTERN,
  PRODUCTS,
  QUANTITY_BASES,
  QUANTITY_SCALE,
  RATE_SCALE,
  READING_STATUSES,
  RECONCILIATION_KINDS,
  unitPriceOf,
} from "./vocabulary";
export type {
  AccountOrigin,
  AdjustmentClass,
  AssetClass,
  EventOrigin,
  InvestmentCategory,
  KeyCheckOrigin,
  Leg,
  Mode,
  OperationKind,
  ReadingStatus,
} from "./vocabulary";
export { compareEvents, eventsOn, periodIndexOf, sortedPeriods } from "./book";
export type { AccountBalanceLike, Book, EventLike, HoldingLike, OperationLike, ReadingLike } from "./book";
export { holdingStates } from "./positions";
export type { HoldingState } from "./positions";
export {
  computePoints,
  DUST_QUANTITY,
  isUnpricedDust,
  missingPricesOf,
  oldestDay,
  pointDays,
  readingOn,
  reconciliationOn,
  valueAt,
} from "./value";
export type { DayValue } from "./value";
export {
  accountPnl,
  flowEntriesOn,
  flowsOn,
  investorFlows,
  performance,
  STALE_VALUE_DAYS,
  sumFlows,
} from "./flows";
export type { AccountPnl, FlowEntry, Performance } from "./flows";
export { TRANSFER_WINDOW_DAYS, transferProposals } from "./transfers";
export type { TransferLeg } from "./transfers";
export { emptyReadingStatus, monthsBack, plainDecimal } from "./readings";
