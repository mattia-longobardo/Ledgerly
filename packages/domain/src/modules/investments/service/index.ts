// src/modules/investments/service — the writes of the section (docs/design/investments.md §1, §2): the
// services, the assets, the events and operations, the readings, the transfers, and the book they rebuild.
export { InvestmentError, translated } from "./types";
export type {
  InvestmentAccount,
  InvestmentAsset,
  InvestmentErrorCode,
  InvestmentEvent,
  InvestmentHolding,
  InvestmentOperation,
  InvestmentPeriod,
  InvestmentReading,
  WriteCtx,
} from "./types";
export {
  currencyOf,
  loadBook,
  lockInvestmentAccount,
  ratesFor,
  rebuild,
  rebuildAll,
  requireInvestmentAccount,
  valuedBook,
} from "./book";
export type { LoadedBook } from "./book";
export {
  createManualService,
  eligibleAccounts,
  manualServiceSchema,
  serviceValueSchema,
  updateServiceUrl,
  updateServiceValue,
} from "./services";
export type { ManualServiceInput, ServiceValueInput } from "./services";
export { assetInputSchema, createAsset, ensureAssetSeed } from "./assets";
export type { AssetInput } from "./assets";
export { addAsset, buyInputSchema, insertEvent, periodOn } from "./events";
export type { BuyInput, LegInput } from "./events";
export { deleteOperation, operationInputSchema, recordOperation, updateOperation } from "./operations";
export type { OperationInput } from "./operations";
export { confirmZeroReading, reconcileHolding, reconciliationInputSchema, saveReading } from "./readings";
export type { ReadingInput, ReconciliationInput } from "./readings";
export { linkTransfer, transferInputSchema, transferLegs, unlinkTransfer } from "./transfers";
export type { TransferInput } from "./transfers";
export { listAssets, listInvestmentAccounts } from "./reads";
