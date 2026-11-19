// scripts/server-actions.ts — rule M10 of the rewrite plan (10-modularity.md §10.6), its Server Actions
// half: every file "use server" of the product and the actions it exports. R3 empties the list module by
// module; `baselines/server-actions.json` holds the ones left, each with the step that closes it, and
// `tools/server-actions.test.ts` holds the tree to it: a new action fails, and so does one that is gone.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Every file "use server" outside the tests, with the names of the actions it exports. */
export function serverActions(repo: string): Record<string, string[]> {
  const listed = execFileSync("git", ["grep", "-l", '^"use server"', "--", "apps", "packages"], {
    cwd: repo,
    encoding: "utf8",
  });
  const found: Record<string, string[]> = {};
  for (const file of listed
    .split("\n")
    .filter((one) => one && !/\.(test|itest)\.tsx?$/.test(one))
    .sort()) {
    const text = readFileSync(join(repo, file), "utf8");
    found[file] = [...text.matchAll(/^export async function (\w+)/gm)].map((match) => match[1]).sort();
  }
  return found;
}
