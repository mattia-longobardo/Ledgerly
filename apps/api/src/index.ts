// The entry of `apps/api` (rule M7): the router the web process mounts until R4.
export { apiRoutes } from "./app";
export { readTools } from "./tools";
export type { ReadTool } from "./tools";
export type { ApiEnv } from "./serve";
export type { ConnectionCases } from "./settings/connections";
export type { ServerCases } from "./settings/server";
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
export { savePreferences } from "./settings/profile";
export type { AccountCases, MonthlyFigures } from "./accounts/routes";
export { wireDomain } from "./wiring";
