// The public interface of this unit (docs/design/rewrite-plan/10-modularity.md §10.3, rule M7).
export { expenseLinkCandidates, pocketsOnAccount, pocketsTotal, pocketsView, searchPockets } from "./queries";
export type { PocketView } from "./queries";
export {
  PocketError,
  accrueMonth,
  addPlannedExpense,
  addToPocket,
  createPocket,
  expensesAmong,
  linkExpense,
  movePocketAccount,
  pocketsToMove,
  purgeExpiredPlanned,
  removePlannedExpense,
  setPocketState,
  unlinkExpense,
  updatePocket,
} from "./service";
