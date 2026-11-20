// The public interface of this unit (docs/design/rewrite-plan/10-modularity.md §10.3, rule M7).
export type { ReviewGroup } from "./categorize/review-rules";
export {
  categoryCounts,
  changeCategories,
  createDefaultGroups,
  dismissMergeProposal,
  listMergeProposals,
  mergeCategories,
  mergeUndoSchema,
  restoreMergeProposal,
  reviewOf,
  similarTo,
  undoChange,
  unmergeCategories,
} from "./categorize/review";
export type { MergeProposal, MergeUndo } from "./categorize/review";
export { categorise, isPreparing, suggestFor } from "./categorize/service";
export { DEFAULT_GROUPS } from "./categorize/tables";
export {
  applyRule,
  createRule,
  deleteRule,
  listRules,
  previewRule,
  previewSavedRule,
  reorderRules,
  restoreRule,
  ruleDraft,
  rulesForCategory,
  setRuleActive,
  undoRuleApply,
  updateRule,
} from "./categorize/user-rules-service";
export type { RulePreview } from "./categorize/user-rules-service";
export type { RuleCondition } from "./categorize/user-rules";
export { MANUAL_KINDS, signedAmount } from "./manual-rules";
export type { ManualKind } from "./manual-rules";
export { createManualTransaction, deleteManualTransaction, updateManualTransaction } from "./manual";
export {
  MAX_LIMIT,
  categoryMacroTotals,
  chargeCandidates,
  expensesView,
  facetCounts,
  getTransaction,
  listTransactions,
  manualMovementsByAccount,
  matchMovements,
  movementSpanByAccount,
  rulesForExport,
  searchPayees,
  shareOf,
  spending,
  spendingOverTime,
  transactionsByIds,
  transactionsInWindow,
  transactionsSummary,
} from "./queries";
export type { CategoryMacroTotal, SpendingGroup, Transaction, TransactionRow } from "./queries";
export {
  CATEGORY_TYPES,
  TRANSACTION_TYPES,
  detectRecurrences,
  displayPayee,
  isHidden,
  macrosFor,
} from "./rules";
export type {
  CategoryType,
  IncomingTransaction,
  MovementRule,
  RecurrenceInput,
  TransactionState,
  TransactionType,
} from "./rules";
export { recurringPatterns, transactions } from "./schema";
export { forgetSends, pendingSends } from "./sending";
export {
  CATEGORY_NAME_MAX,
  TransactionError,
  adoptProviderCategory,
  categorisableAccountIds,
  deleteHiddenTransactions,
  followProviderCategoryName,
  hideTransactions,
  linkOwnTransfers,
  linkProviderCategory,
  listProviderCategories,
  markNotSent,
  purgeRemovedUpstream,
  recordSourceCategories,
  releaseLocalEdits,
  restoreTransactions,
  setCategory,
  settleProviderCategoryName,
  settleSent,
  sourceCategoryFor,
  updateTransaction,
  upsertFromProvider,
} from "./service";
export type { ProviderCategory } from "./service";
export {
  SourceCategoryError,
  chooseSourceCategory,
  forgetSourceCategories,
  keepSourceCategory,
  listSourceCategories,
  sourceCategoryCount,
  sourceNamesByCategory,
  undoSourceCategory,
} from "./source-categories";
export type { SourceCategoryChange, SourceCategoryHooks, SourceCategoryView } from "./source-categories";
export {
  SWITCH_MATCH_MAX_DAYS,
  compareSources,
  comparisonFrom,
  matchDoubles,
  planTransfers,
} from "./switch-rules";
export type { DoubleMatch, SwitchMovement, TransferPair } from "./switch-rules";
export {
  choicesToCarry,
  doubleMovements,
  joinDoubles,
  linkFoundInBoth,
  movementsToCompare,
  retireBankRows,
  transferCandidates,
  undoJoinedDoubles,
  undoTransferPairs,
  writeTransferPairs,
} from "./switching";
export {
  TaxonomyError,
  alignCategoryTypesToMovements,
  archiveCategory,
  categoryOptions,
  colorOfCategory,
  createCategory,
  createLabel,
  deleteCategory,
  deleteLabel,
  getCategory,
  listCategories,
  listCategoriesWithUsage,
  listLabels,
  listLabelsWithUsage,
  macroMoveFacts,
  moveCategory,
  moveCategoryToMacro,
  movesBetweenMacros,
  restoreCategories,
  restoreCategory,
  updateCategory,
  updateLabel,
} from "./taxonomy";
export type { MacroPlace } from "./taxonomy";
export { movementsOfAccounts } from "./ports";
export type { TransactionsProvider } from "./ports";
