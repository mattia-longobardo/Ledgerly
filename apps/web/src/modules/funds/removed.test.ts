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
    expect(
      filesWith(new RegExp(["deduct", "ib"].join(""), "i"), [
        "apps/web/src",
        "packages/domain/src",
        "messages",
      ]),
    ).toEqual([]);
  });

  it("has no fund type left: the word of the plan with a debit is in no text and in no code of Funds (criterion 9)", () => {
    const word = new RegExp(`\\b${["P", "A", "C"].join("")}\\b`);
    expect(
      filesWith(word, [
        "messages",
        "apps/web/src/modules/funds",
        "packages/domain/src/modules/funds",
        "apps/web/src/app/(app)/funds",
      ]),
    ).toEqual([]);
    const types = new RegExp(["fund", "\\.", "type", "\\b"].join(""));
    expect(filesWith(types, ["apps/web/src", "packages/domain/src", "scripts"])).toEqual([]);
  });

  it("has no upload, reader, page or job for a fund's documents (decision H19, criterion 13)", () => {
    for (const gone of [
      "apps/web/src/app/(app)/funds/[id]/documents",
      "apps/web/src/modules/funds/parse",
      "apps/web/src/modules/funds/pension/imports.ts",
      "packages/domain/src/modules/funds/parse",
      "packages/domain/src/modules/funds/pension/imports.ts",
    ]) {
      expect(existsSync(join(ROOT, gone)), gone).toBe(false);
    }
    const jobs = readFileSync(join(ROOT, "apps/web/src/platform/jobs/registry.ts"), "utf8");
    expect(jobs).not.toMatch(/sweep[A-Za-z]*Job[^\n]*funds/);
    expect(
      filesWith(/upload[A-Z][A-Za-z]*Document|process[A-Z][A-Za-z]*Document/, [
        "apps/web/src/modules/funds",
        "packages/domain/src/modules/funds",
        "apps/web/src/app/(app)/funds",
      ]),
    ).toEqual([]);
  });

  it("writes nothing on a read: no seed of a tariff is left in the module (criterion 8)", () => {
    expect(
      filesWith(/seedTariffs|fundFeeTariffs/, [
        "apps/web/src/modules/funds",
        "packages/domain/src/modules/funds",
        "apps/web/src/app/(app)/funds",
      ]).sort(),
    ).toEqual([
      // The table stays in the schema, untouched, for the image before the release: removed in R5f.
      "packages/domain/src/modules/funds/schema/index.ts",
      "packages/domain/src/modules/funds/schema/register.ts",
    ]);
  });
});
