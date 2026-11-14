import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// What release N6 of the rewrite plan takes out of Funds, held out: a word that comes back in the
// code or in the messages fails here (docs/design/rewrite-plan/11-standardization.md §11.2.5-§11.2.6).
// The words are written in two halves so that this file is not a use of them.

const ROOT = process.cwd();

function filesUnder(folder: string): string[] {
  return readdirSync(join(ROOT, folder)).flatMap((name) => {
    const path = join(folder, name);
    return statSync(join(ROOT, path)).isDirectory() ? filesUnder(path) : [path];
  });
}

/** The files of `folders` that hold a match of `word`, this file left out. */
function filesWith(word: RegExp, folders: readonly string[]): string[] {
  return folders
    .flatMap(filesUnder)
    .filter((path) => /\.(ts|tsx|json|css|mjs)$/.test(path) && !path.endsWith("removed.test.ts"))
    .filter((path) => word.test(readFileSync(join(ROOT, path), "utf8")));
}

describe("what release N6 removed from Funds", () => {
  it("has no deductible limit, figure or text (exception X1, decision H18)", () => {
    expect(filesWith(new RegExp(["deduct", "ib"].join(""), "i"), ["src", "messages"])).toEqual([]);
  });
});
