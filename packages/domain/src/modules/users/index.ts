// The public interface of this unit (docs/design/rewrite-plan/10-modularity.md §10.3, rule M7).
export { contextFor, forEachUser, personById } from "./jobs";
export type { Person } from "./jobs";
export { describeUserAgent } from "./rules";
export { buildCtx } from "./rules";
export type { Preferences, TimeOffPreferences } from "./rules";
export type { Region, SavedPreferences } from "./service";
export {
  changePreferences,
  findSessionToken,
  getPreferences,
  getSavedPreferences,
  listOwnSessions,
  profileChange,
  setAddon,
  OnboardingError,
  completeOnboarding,
  instanceDefaults,
  onboardingOf,
  saveInstanceDefaults,
  setCountry,
  startOnboarding,
  updatePreferences,
  updateTimeOffPreferences,
} from "./service";
