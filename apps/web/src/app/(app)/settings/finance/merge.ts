// src/app/(app)/settings/finance/merge.ts — the merge of two categories as one use case
// (rewrite plan N3; ux/n3-categories-manual.md §6.3). The categories and their movements are the
// transactions module's, the limits of their budgets are the budgets module's: only the
// application joins them (rule M8), in one transaction — both halves, or nothing.
import "server-only";

// The proposals, the merge and its "Undo" join two modules: they live in `apps/api`, with the routes.
export { mergeProposalsView, mergeTwoCategories, undoMergeOfTwo } from "@ledgerly/api";
