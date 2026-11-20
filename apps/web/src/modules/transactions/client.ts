// Transactions, the entry of what the screens of `app` use (rule M3): the calls to `/api/v1` of the
// rules, the automatic categories and the manual movement, and the colours of the categories.
export { ApiCategoryActions, ApiManualMovement } from "./ui/api-commands";
export { createDefaultGroups, dismissMerge } from "./category-calls";
export {
  applyRuleAction,
  deleteRuleAction,
  previewRuleAction,
  previewSavedRuleAction,
  reorderRulesAction,
  ruleAmount,
  saveRuleAction,
  setRuleActiveAction,
  undoRuleApplyAction,
} from "./rule-calls";
export type { PreviewView, RuleCondition, RuleInput } from "./rule-calls";
export { categoryColors, withMacroTitles } from "./ui/display";
