// The public interface of this unit (docs/design/rewrite-plan/10-modularity.md §10.3, rule M7).
export { searchSubscriptions, subscriptionsOnAccount, subscriptionsView, suggestions } from "./queries";
export type { SubscriptionRow } from "./queries";
export {
  CYCLES,
  cycleOf,
  dueMoment,
  everyOf,
  EVERY_UNITS,
  frequencyOf,
  MAX_EVERY,
  toleranceOf,
  toleranceParts,
} from "./rules";
export type { Every, Frequency } from "./rules";
export type { Suggestion } from "./rules";
export {
  SubscriptionError,
  chargesAmong,
  checkSubscriptions,
  createSubscription,
  deleteSubscription,
  moveSubscriptionAccount,
  setSubscriptionState,
  subscriptionsToMove,
  updateSubscription,
} from "./service";
export { wireSubscriptions } from "./ports";
