import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
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

/** The files of `folders` that hold a match of `word`: product files and messages, no test. */
function filesWith(word: RegExp, folders: readonly string[]): string[] {
  return folders
    .flatMap(filesUnder)
    .filter((path) => /\.(ts|tsx|json|css|mjs)$/.test(path) && !/\.(test|itest)\.tsx?$/.test(path))
    .filter((path) => word.test(readFileSync(join(ROOT, path), "utf8")));
}

describe("what release N6 removed from Funds", () => {
  it("has no deductible limit, figure or text (exception X1, decision H18)", () => {
    expect(filesWith(new RegExp(["deduct", "ib"].join(""), "i"), ["src", "messages"])).toEqual([]);
  });

  it("has no fund type left: the word of the plan with a debit is in no text and in no code of Funds (criterion 9)", () => {
    const word = new RegExp(`\\b${["P", "A", "C"].join("")}\\b`);
    expect(filesWith(word, ["messages", "src/modules/funds", "src/app/(app)/funds"])).toEqual([]);
    const types = new RegExp(["fund", "\\.", "type", "\\b"].join(""));
    expect(filesWith(types, ["src", "scripts"])).toEqual([]);
  });

  it("has no upload, reader, page or job for a fund's documents (decision H19, criterion 13)", () => {
    for (const gone of [
      "src/app/(app)/funds/[id]/documents",
      "src/modules/funds/parse",
      "src/modules/funds/pension/imports.ts",
    ]) {
      expect(existsSync(join(ROOT, gone)), gone).toBe(false);
    }
    const jobs = readFileSync(join(ROOT, "src/platform/jobs/registry.ts"), "utf8");
    expect(jobs).not.toMatch(/sweep[A-Za-z]*Job[^\n]*funds/);
    expect(
      filesWith(/upload[A-Z][A-Za-z]*Document|process[A-Z][A-Za-z]*Document/, [
        "src/modules/funds",
        "src/app/(app)/funds",
      ]),
    ).toEqual([]);
  });

  it("writes nothing on a read: no seed of a tariff is left in the module (criterion 8)", () => {
    expect(
      filesWith(/seedTariffs|fundFeeTariffs/, ["src/modules/funds", "src/app/(app)/funds"]).sort(),
    ).toEqual([
      // The table stays in the schema, untouched, for the image before the release: removed in R5f.
      "src/modules/funds/schema.ts",
    ]);
  });
});
