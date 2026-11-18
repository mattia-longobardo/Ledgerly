// modules/transactions/source-categories.ts — the categories of a source that gives its own, and
// the category each counts under here (rewrite plan N3.1, 12-account-modes.md §12.3). The rules are
// `source-rules.ts`; this file reads and writes the rows.
//
// The movements of such a source are never recategorised: each keeps the source's category
// (`transactions.source_category_id`), and counts under the category the row of that one names.
// A change of the match moves them together, in one transaction, and "Undo" moves them back. A
// movement whose category a person chose by hand is left where they put it.
export {
  SourceCategoryError,
  ensureSourceCategory,
  knownSourceCategory,
  recordSourceCategories,
  listSourceCategories,
  sourceNamesByCategory,
  sourceCategoryFor,
} from "./reading";
export type { SourceCategoryView } from "./reading";
export {
  chooseSourceCategory,
  undoSourceCategory,
  keepSourceCategory,
  sourceCategoryCount,
  forgetSourceCategories,
} from "./choosing";
export type { SourceCategoryChange, SourceCategoryHooks } from "./choosing";
