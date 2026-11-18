// The public interface of this unit (docs/design/rewrite-plan/10-modularity.md §10.3, rule M7).
export { searchSubscriptions, subscriptionsOnAccount, subscriptionsView, suggestions } from "./queries";
export type { SubscriptionRow } from "./queries";
export { CYCLES, dueMoment, toleranceParts } from "./rules";
export type { Cycle, SubscriptionState, Suggestion } from "./rules";
export {
  SubscriptionError,
  chargesAmong,
  checkSubscriptions,
  createSubscription,
  deleteSubscription,
  moveSubscriptionAccount,
  setSubscriptionState,
  setUtility,
  subscriptionsToMove,
  updateSubscription,
} from "./service";
