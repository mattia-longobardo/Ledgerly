// The public interface of this unit (docs/design/rewrite-plan/10-modularity.md §10.3, rule M7).
export { contextFor, forEachUser, personById } from "./jobs";
export type { Person } from "./jobs";
export { describeUserAgent, initialsOf } from "./rules";
export { buildCtx } from "./rules";
export type { Preferences, TimeOffPreferences } from "./rules";
export {
  changePreferences,
  findSessionToken,
  getPreferences,
  listOwnSessions,
  profileChange,
  updatePreferences,
  updateTimeOffPreferences,
} from "./service";
