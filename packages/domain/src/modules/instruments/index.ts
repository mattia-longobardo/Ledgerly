// The public interface of this unit (docs/design/rewrite-plan/10-modularity.md §10.3, rule M7).
export type { PriceAnswer, PriceRequest, PriceSource } from "./ports";
export { DEFAULT_DAILY_CALLS, FALLBACK_MIC, INSTRUMENT_CLASSES, isStale } from "./rules";
export { closesUpTo, lastCloses, pricedListings, refreshPrices } from "./prices";
export type { Close, PricedMarket, PricesRun } from "./prices";
export { searchInstruments } from "./service";
export type { InstrumentHit, SearchDeps } from "./service";
