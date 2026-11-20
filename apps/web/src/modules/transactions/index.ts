// Transactions, the light entry of `app` (rule M3): the calls of the rules and of the categories'
// settings, and the colours of the categories. The screens that list movements use `client.ts`.
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
export { categoryColor, categoryColors, withMacroTitles } from "./ui/display";
