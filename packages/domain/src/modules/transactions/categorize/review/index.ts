// modules/transactions/categorize/review.ts — what a person does about the automatic categories
// (rewrite plan N3; ux/n3-categories-manual.md §2-§7): confirm, choose for a group, apply to the
// similar ones, undo, merge two categories, start from the default groups. The rules are in
// `review-rules.ts`; an action on several movements is one transaction — all of them or none.
export { reviewOf, categoryCounts, changeCategories, undoChange } from "./changes";
export {
  similarTo,
  listMergeProposals,
  dismissMergeProposal,
  restoreMergeProposal,
  mergeUndoSchema,
  mergeCategories,
  unmergeCategories,
  createDefaultGroups,
} from "./merges";
export type { MergeProposal, MergeUndo } from "./merges";
