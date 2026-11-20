/**
 * Pure rules of the transactions module (spec §7.2). No database, no clock of its own: every
 * function takes data and returns a decision the service applies, the same shape as
 * `modules/accounts/rules.ts`. The constants below are the vocabulary `schema.ts` builds its
 * columns and checks on.
 */
export {
  TRANSACTION_TYPES,
  TRANSACTION_STATES,
  CATEGORY_TYPES,
  TRANSACTION_ORIGINS,
  SEND_STATES,
  CATEGORY_ORIGINS,
  categoryStateOf,
  NAME_MAX,
  RECURRENCE_BANDS,
  PROVIDER_OWNED_FIELDS,
  AUTOMATIC_CATEGORY_ORIGINS,
} from "./vocabulary";
export type {
  SendState,
  TransactionType,
  TransactionState,
  TransactionOrigin,
  CategoryState,
  CategoryType,
  MergeableField,
  Cadence,
} from "./vocabulary";
export {
  displayPayee,
  payeeKeyOf,
  isHidden,
  excludeHidden,
  CATEGORY_COLORS,
  autoCategoryColor,
  categoryColor,
  treeOrder,
} from "./records";
export type { IncomingTransaction, ProviderResolution, StoredTransaction, TransactionPatch } from "./records";
export { transferPairKey, pairTransfers, planIbanTransfers } from "./transfers";
export type { TransferLeg, OwnIban, IbanRuleRow } from "./transfers";
export {
  resolveType,
  toNewTransaction,
  isLocallyEdited,
  planProviderMerge,
  planUserEdit,
  markLocallyEdited,
  markCategoryEdited,
  planUpstreamRemovals,
} from "./merges";
export type { UserEdit, WindowRow } from "./merges";
export { cadenceOfInterval, detectRecurrences } from "./recurrences";
export type { RecurrenceInput } from "./recurrences";
export { typeByMacro, typeMarkerByMacro, macrosFor } from "./macros";
export type { TypedMovement } from "./macros";
export { normalizeIban } from "../../../platform/iban";
