// modules/transactions/queries.ts — the read models Expenses renders (spec §7.2): the filtered
// list, the month groups, the "By category" card and the payee search the ⌘K palette uses. Every
// query is scoped with `userScoped(ctx)` and every list has a deterministic `ORDER BY`.
export { DEFAULT_LIMIT, MAX_LIMIT, boundedLimit, escapeLike, incomeLessExpense, shareOf } from "./filters";
export type { Transaction, TransactionRow, MonthTotal } from "./filters";
export {
  transactionsByIds,
  getTransaction,
  transactionIdsOfAccount,
  transactionsInWindow,
  dailyNetByAccount,
  manualMovementsByAccount,
  movementsByAccount,
} from "./movements";
export { monthSpending, findMovements, chargeCandidates, payeeSamples, recurrences } from "./candidates";
export { matchMovements } from "./matching";
export {
  countAllTransactions,
  listTransactions,
  transactionsSummary,
  monthlyTotals,
  categoryTotals,
} from "./listing";
export {
  categoryMacroTotals,
  spendingOverTime,
  facetCounts,
  searchPayees,
  monthGroups,
  expensesView,
  movementSpanByAccount,
  rulesForExport,
  spending,
} from "./views";
export type { CategoryMacroTotal, SpendingGroup } from "./views";
