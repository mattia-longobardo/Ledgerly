import { describe, expect, it } from "vitest";
import { unusedExports } from "../scripts/unused-exports";

// Rule Q9 of the rewrite plan (docs/design/rewrite-plan/10-modularity.md §10.8), from R0: no export
// without a use. `tsc` holds the locals and the parameters (`noUnusedLocals`, `noUnusedParameters`);
// this holds what a file exports.
describe("dead code (Q9)", () => {
  it("no product file exports a name that nothing uses", () => {
    expect(unusedExports(process.cwd())).toEqual([]);
  }, 60_000);
});
