// modules/transactions/categorize/user-rules-service.ts — the rules of a person as a use case
// (categories-and-rules.md §4): keep them, check them on the movements, apply one to the movements
// already here and undo that. Every decision is in `user-rules.ts`; this file reads and writes.
//
// A rule never writes on a choice of a person (`user`), on a movement of a source that gives its
// own categories, or on a leg of a pair (QC4). Its category is automatic (`rule`): it counts at
// once and is never learnt from (`CONFIRMED` in `service.ts` reads `user` and `provider` only).
export {
  listRules,
  rulesForCategory,
  createRule,
  updateRule,
  setRuleActive,
  deleteRule,
  restoreRule,
  reorderRules,
} from "./rules";
export { applyRulesToNew } from "./new-movements";
export { previewRule, previewSavedRule } from "./previews";
export type { RulePreview } from "./previews";
export { applyRule, undoRuleApply } from "./applying";
