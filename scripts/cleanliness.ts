// scripts/cleanliness.ts — `npm run cleanliness [-- --check]`. The rules of cleanliness of the
// rewrite plan (docs/design/rewrite-plan/10-modularity.md §10.8), measured over the product code:
// Q1-Q3 from the paths and the imports, Q5-Q8 and Q10 with the core rules of ESLint. Where the code
// breaks a rule today the file is on a known list, `baselines/cleanliness.json`, which can only get
// shorter: `eslint.config.mjs` turns a rule off for the files on its list only, and `--check` fails
// when the tree measures anything else than the file — a new violation or an entry that is gone.
// Without `--check` it rewrites the file: run it after removing a violation, never to let one in.
//
// No package of its own (decision H11): ESLint and its TypeScript parser are already there.
import { readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { ESLint, type Linter } from "eslint";
import tseslint from "typescript-eslint";
import { asOneFile, importEdges, readProductSources, treeFiles } from "./source-graph";

const BASELINE = "baselines/cleanliness.json";

/** The product code, and the rules of Q5-Q8 and Q10 with their thresholds (decision I15). */
const settings: { files: string[]; ignores: string[]; rules: Linter.RulesRecord } = JSON.parse(
  readFileSync(new URL("./cleanliness-rules.json", import.meta.url), "utf8"),
);
const { files: PRODUCT_FILES, ignores: NOT_PRODUCT, rules: CLEANLINESS_RULES } = settings;

export type Counts = Record<string, Record<string, number>>;

/** Q5-Q8, Q10: per rule, the files that break it and how many times. */
async function lintCounts(repo: string): Promise<Counts> {
  const eslint = new ESLint({
    cwd: repo,
    overrideConfigFile: true,
    overrideConfig: [
      { linterOptions: { reportUnusedDisableDirectives: "off" } },
      {
        files: ["**/*.{ts,tsx}"],
        languageOptions: { parser: tseslint.parser },
        plugins: { "@typescript-eslint": tseslint.plugin },
      },
      { files: PRODUCT_FILES, ignores: NOT_PRODUCT, rules: CLEANLINESS_RULES },
    ],
  });
  const results = await eslint.lintFiles(PRODUCT_FILES);
  const counts: Counts = {};
  for (const result of results) {
    const file = result.filePath.slice(repo.length + 1);
    for (const message of result.messages) {
      if (message.ruleId === null) throw new Error(`${file}: ${message.message}`);
      // A directive about another rule (`react-hooks/…`) is not a measure of these.
      if (!(message.ruleId in CLEANLINESS_RULES)) continue;
      counts[message.ruleId] ??= {};
      counts[message.ruleId][file] = (counts[message.ruleId][file] ?? 0) + 1;
    }
  }
  return counts;
}

/** The names a module's file may have (Q1): a file that grows becomes a folder with its name. */
export const MODULE_FILE_NAMES = [
  "index",
  "client",
  "schema",
  "rules",
  "queries",
  "service",
  "ports",
  "events",
  "jobs",
];
/** Names that say nothing of what a file holds (Q2). */
const GENERIC = /^(utils?|helpers?|common|misc|lib)$/;
/** What a pure file may not reach (Q3): the database, the network, the clock. */
const IMPURE_IMPORT =
  /^(drizzle-orm|pg|nodemailer|@aws-sdk\/|ccxt|node:(http|https|net|dns|fs))|\/platform\/(db|storage|mail)\b/;
const CLOCK = /\bDate\.now\(\)|\bnew Date\(\)/;

/** Q1-Q3 and the file names of Q5, over the product files. */
function structureCounts(repo: string): Counts {
  const counts: Counts = {
    "Q1 module file name": {},
    "Q2 generic name": {},
    "Q3 impure rules": {},
    "Q5 file name": {},
  };
  const sources = readProductSources(repo);
  const disk = treeFiles(repo);
  const edges = importEdges(sources);
  for (const [rel, text] of sources) {
    // A file split in parts (Q6) is counted as the one file it was, at its old path.
    const one = asOneFile(sources, rel);
    const file =
      one === rel
        ? disk.get(rel)!.slice(repo.length + 1)
        : `${disk.get(`${one.replace(/\.ts$/, "")}/index.ts`)!.slice(repo.length + 1, -"/index.ts".length)}.ts`;
    const inDomain = file.startsWith("packages/domain/src/modules/");
    if (inDomain) {
      const [, , ...rest] = rel.split("/");
      const first = rest[0].replace(/\.tsx?$/, "");
      if (!MODULE_FILE_NAMES.includes(first)) counts["Q1 module file name"][file] = 1;
    }
    const parts = file.split("/");
    if (parts.some((part) => GENERIC.test(part.replace(/\.tsx?$/, "")))) counts["Q2 generic name"][file] = 1;
    if (basename(file).replace(/\.tsx?$/, "") === "rules" || file.includes("/rules/")) {
      const specifiers = [...text.matchAll(/(?:\bfrom\s+|\bimport\s+)["']([^"']+)["']/g)].map(
        (match) => match[1],
      );
      const reached = edges.filter((edge) => edge.from === rel).map((edge) => `/${edge.to}`);
      const impure =
        [...specifiers, ...reached].filter((one) => IMPURE_IMPORT.test(one)).length +
        (CLOCK.test(text) ? 1 : 0);
      if (impure > 0) counts["Q3 impure rules"][file] = (counts["Q3 impure rules"][file] ?? 0) + impure;
    }
    // A folder of the Next.js app is a segment of the URL (`[id]`, `(app)`, `export.csv`): the file names are checked.
    const routes = file.startsWith("apps/web/src/app/") ? parts.slice(0, -1).length : 0;
    const named = parts.slice(routes).map((part) => part.replace(/(\.test|\.itest|\.d)?\.tsx?$/, ""));
    if (named.some((part) => !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(part))) counts["Q5 file name"][file] = 1;
  }
  return counts;
}

function sorted(counts: Counts): Counts {
  return Object.fromEntries(
    Object.keys(counts)
      .sort()
      .filter((rule) => Object.keys(counts[rule]).length > 0)
      .map((rule) => [
        rule,
        Object.fromEntries(Object.entries(counts[rule]).sort(([a], [b]) => a.localeCompare(b))),
      ]),
  );
}

export async function measureCleanliness(repo: string): Promise<Counts> {
  return sorted({ ...structureCounts(repo), ...(await lintCounts(repo)) });
}

if (process.argv[1]?.endsWith("cleanliness.ts")) {
  const repo = process.cwd();
  const measured = `${JSON.stringify(await measureCleanliness(repo), null, 2)}\n`;
  if (process.argv.includes("--check")) {
    if (readFileSync(join(repo, BASELINE), "utf8") !== measured) {
      console.error(
        `${BASELINE} is not what the tree measures: run \`npm run cleanliness\` and read the diff`,
      );
      process.exit(1);
    }
    console.log(`${BASELINE}: unchanged`);
  } else {
    writeFileSync(join(repo, BASELINE), measured);
    const counts = JSON.parse(measured) as Counts;
    for (const [rule, files] of Object.entries(counts)) {
      const total = Object.values(files).reduce((sum, count) => sum + count, 0);
      console.log(`${rule}: ${Object.keys(files).length} files, ${total}`);
    }
  }
}
