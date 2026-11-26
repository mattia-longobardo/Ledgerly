// service: one entry for its parts (rule Q6).
export { FundError } from "./model";
export type { FeeInput, Fund, FundFee, FundInput, FundOperation, FundSource, SourceInput } from "./model";
export { feesOf, requireFund, sourcesOf, takenComponents } from "./reads";
export { createFund, setFundState, updateFund } from "./fund";
export {
  addSource,
  contributionsBySource,
  removeSource,
  restoreSource,
  setSourceState,
  updateSource,
} from "./contribution-sources";
export { addFee, removeFee, updateFee } from "./fees";
export { deleteValuation, recordValuation, updateValuation } from "./valuations";
export { addContribution, deleteContribution, updateContribution } from "./operations";
export { linkAllFundLegs } from "./legs";
export type { ContributionInput } from "./operations";
export { matchDebits, movementCandidates, proposeDebitMatch } from "./debits";
export { fundsOnAccount, moveFundAccount, moveFundSourceAccount } from "./accounts";
