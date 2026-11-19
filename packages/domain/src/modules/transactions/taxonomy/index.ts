// modules/transactions/taxonomy.ts — the categories and labels of spec §7.2, kept apart from
// `service.ts` because they are their own use case: Settings › Data edits them by hand, while the
// Wallet sync adopts them by name (§9.1). Both entry points come through here.
export {
  TaxonomyError,
  listCategories,
  colorOfCategory,
  categoryOptions,
  typeFromMovements,
  alignCategoryTypesToMovements,
  listCategoriesWithUsage,
  getCategory,
  requireCategory,
} from "./category-reads";
export type { Label, TreeCategory, ProviderGroupRef } from "./category-reads";
export {
  createCategory,
  updateCategory,
  renameCategory,
  archiveCategory,
  restoreCategory,
  restoreCategories,
  moveCategory,
  movesBetweenMacros,
  macroMoveFacts,
  moveCategoryToMacro,
  deleteCategory,
} from "./category-writes";
export type { MacroPlace } from "./category-writes";
export { adoptOrCreateCategory, adoptOrCreateLabel } from "./category-adoption";
export {
  listLabels,
  listLabelsWithUsage,
  createLabel,
  updateLabel,
  renameLabel,
  deleteLabel,
} from "./labels";
export { NAME_MAX } from "../rules";
