// The public interface of this unit (docs/design/rewrite-plan/10-modularity.md §10.3, rule M7).
export { DISPLAY_CURRENCIES, convertCents, rangesToFetch } from "./rules";
export { ratesOn, saveRates, storedRange } from "./service";
export { fetchEcbRates } from "./sources";
export type { FxFetchOptions } from "./sources";
