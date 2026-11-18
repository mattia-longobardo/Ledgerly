// The entry of `apps/api` (rule M7): the router the web process mounts until R4.
export { apiRoutes } from "./app";
export type { ApiEnv } from "./serve";
export { deleteCategoryEverywhere } from "./settings/categories";
export {
  macroMoveView,
  mergeTwoCategories,
  moveToMacro,
  setSourceCategory,
  sourceNotes,
  undoMergeOfTwo,
  undoMoveToMacro,
  undoSourceCategoryChange,
} from "./settings/taxonomy";
export type { MacroMoveUndo, MacroMoveView } from "./settings/taxonomy";
