// The public interface of this unit (docs/design/rewrite-plan/10-modularity.md §10.3, rule M7).
export { markPosted, postEntry } from "./service/posting";
export { interestsView, publishingRulesOn, ruleAccounts, ruleDetail, rulesOnAccount } from "./queries";
export type { RuleRow } from "./queries";
export { ACCRUAL_READING_MAX_AGE_HOURS, fractionToPercent, ruleInputOf, runsAt, SETTLEMENTS } from "./rules";
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
export { stopPublishing } from "./service/switching";
