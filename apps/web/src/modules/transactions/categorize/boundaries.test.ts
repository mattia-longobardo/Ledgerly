import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { treeFiles } from "../../../../../../scripts/source-graph";

// "The model does not leave" (rewrite plan N3, "Test e gate"; 04-now.md §4.4 "Dati"): the memory,
// the model, the confidence and the model's version are for the cascade only. What a person takes
// out of the app — the export, the API, MCP — is built field by field from the modules' read
// models, so it is enough that none of those files, and no shape a browser is handed, names them.

// A path of the one source tree, wherever its package keeps the file (R0: `scripts/source-graph.ts`).
const TREE = treeFiles(process.cwd());
/** A file of the tree; a file split in parts (rule Q6) is read whole, its parts one after the other. */
const read = (path: string) => {
  const file = TREE.get(path);
  if (file !== undefined) return readFileSync(file, "utf8");
  const folder = path.replace(/\.tsx?$/, "/");
  const parts = [...TREE]
    .filter(([rel]) => rel.startsWith(folder))
    .map(([, part]) => readFileSync(part, "utf8"));
  if (parts.length === 0) throw new Error(`${path}: no such file`);
  return parts.join("\n");
};

const PRIVATE = [
  "categoryModels",
  "category_models",
  "categoryMemory",
  "category_memory",
  "categoryConfidence",
  "category_confidence",
  "categoryModelVersion",
  "category_model_version",
  "automaticThreshold",
  "suggestionThreshold",
];

describe("what the automatic categories keep to themselves", () => {
  it.each([
    "platform/export/service.ts",
    "platform/mcp/tools.ts",
    "api/transactions/dto.ts",
    "api/accounts/dto.ts",
  ])("is named nowhere in %s", (path) => {
    const source = read(path);
    for (const name of PRIVATE) expect(source).not.toContain(name);
  });

  it.each([
    "modules/transactions/ui/view.ts",
    "modules/transactions/ui/category-cell.tsx",
    "modules/transactions/ui/category-actions.tsx",
    "modules/transactions/ui/review-list.tsx",
    "modules/transactions/ui/similar-dialog.tsx",
    "modules/transactions/categorize/actions.ts",
  ])("is in no shape %s hands a browser", (path) => {
    const source = read(path);
    for (const name of PRIVATE) expect(source).not.toContain(name);
    // No number of the model either: a page gets a state, a category and the code of a reason.
    expect(source).not.toMatch(/\bconfidence\b(?!,| or| and)/);
  });

  it("is in no column the list of the movements returns", () => {
    const queries = read("modules/transactions/queries.ts");
    const row = queries.slice(queries.indexOf("export interface TransactionRow {"));
    const shape = row.slice(0, row.indexOf("\n}\n"));
    for (const name of PRIVATE) expect(shape).not.toContain(name);
  });
});
