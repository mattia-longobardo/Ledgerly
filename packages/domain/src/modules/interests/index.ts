// The public interface of this unit (docs/design/rewrite-plan/10-modularity.md §10.3, rule M7).
export { ensureFreshBalances } from "./service/freshness";
export type { FreshnessOptions, StaleReason } from "./service/freshness";
export { lookUpUnsure, markPosted, postEntry, postPending } from "./service/posting";
export { interestsView, publishingRulesOn, ruleAccounts, ruleDetail, rulesOnAccount } from "./queries";
export type { RuleRow } from "./queries";
export { DAY_BASES, fractionToPercent, ruleInputOf, runsAt, SETTLEMENTS } from "./rules";
export type { PlainRule, Tier } from "./rules";
export { interestRules } from "./schema";
export {
  InterestError,
  accruedInterestByAccount,
  bringUpToDate,
  createRule,
  moveRuleAccount,
  postsUnderAny,
  publishingRuleCount,
  rulesToMove,
  setRuleState,
  stopPublishingOnAccounts,
  updateRule,
} from "./service";
export { restorePublishing, stopPublishing } from "./service/switching";
export { wireInterests } from "./ports";
export type { LedgerPosting } from "./ports";
