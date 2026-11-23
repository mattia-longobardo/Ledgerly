// scripts/modularity.ts — `npm run modularity`. Writes `baselines/modularity.json`: the known lists
// that `src/architecture.test.ts` holds the tree to, and the counts the rewrite plan tracks
// (docs/design/rewrite-plan/10-modularity.md §10.5, §10.6: rules M2, M3, M4, M6; §10.11: M12, M14).
//
// The lists may only get shorter. Run this after removing a violation, and commit the file with the
// change that removed it; the test fails on a new violation and on a stale entry alike. Running it
// to make a new violation pass is the thing the test exists to stop.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  asOneFile,
  crossModuleImports,
  cycleGroups,
  edgeKey,
  importEdges,
  readProductSources,
  reciprocalPairs,
  treeFiles,
  unitGraph,
} from "./source-graph";
import { measurePackages, workspaces } from "./packages";

export type ModularityBaseline = {
  counts: Record<string, number>;
  crossModuleImports: string[];
  reciprocalUnits: string[];
  moduleCycles: string[][];
  /** Rule M12: `<file>: <name>` for every product file that names a provider, a fund or an employer. */
  forbiddenNames: string[];
  /** Rule M14: the message keys that carry one of those names. */
  forbiddenNameKeys: string[];
  /** Rule M1 (R0): `<package> → <dependency>` that §10.2 does not allow. */
  packageDependencies: string[];
  /** Rule M1 (R0): `<file> → <path>` for a relative import that leaves its package. */
  packageEscapes: string[];
  /** Rule M3 (R0): `<file> → <file>` for an import of another module's file, not its entry. */
  deepImports: string[];
  /** Rule M5 (R0): `<file>: <table>` for a table of another unit, imported or named in SQL. */
  tableAccess: string[];
};

/**
 * The names rule M12 keeps out of the code (10-modularity.md §10.11): a provider, a fund, an
 * employer. A new name in this list is a written decision of the plan.
 */
export const FORBIDDEN_NAMES = [
  "cometa",
  "fideuram",
  "reply",
  "teamsystem",
  "etoro",
  "binance",
  "wallet",
  "trek",
  "authentik",
] as const;

/** Where a name may be written: the provider's own folder (eToro and Binance: their adapter, C1b). */
const OWN_FOLDER: Partial<Record<(typeof FORBIDDEN_NAMES)[number], string>> = {
  etoro: "platform/integrations/etoro/",
  binance: "platform/integrations/ccxt/",
};

/** Rule M12 over the product files: which file writes which name, outside the name's own folder. */
export function forbiddenNamesIn(files: ReadonlyMap<string, string>): string[] {
  const found: string[] = [];
  for (const [rel, content] of files) {
    // An `index.ts` only repeats the names of its unit's files (R0): the file that defines one is listed.
    if (rel.endsWith("/index.ts")) continue;
    const text = content.toLowerCase();
    for (const name of FORBIDDEN_NAMES) {
      const own = OWN_FOLDER[name];
      if (own !== undefined && rel.startsWith(own)) continue;
      if (text.includes(name)) found.push(`${asOneFile(files, rel)}: ${name}`);
    }
  }
  return [...new Set(found)].sort();
}

/** Rule M14 over a catalog of messages: the dotted keys that carry a forbidden name. */
export function forbiddenNameKeys(catalog: unknown, path = ""): string[] {
  if (typeof catalog !== "object" || catalog === null) return [];
  return Object.entries(catalog).flatMap(([key, value]) => {
    const at = path === "" ? key : `${path}.${key}`;
    const named = FORBIDDEN_NAMES.some((name) => key.toLowerCase().includes(name));
    return [...(named ? [at] : []), ...forbiddenNameKeys(value, at)];
  });
}

export function measureModularity(repo: string): ModularityBaseline {
  const sources = readProductSources(repo);
  const edges = importEdges(sources);
  const named = forbiddenNamesIn(sources);
  const namedKeys = forbiddenNameKeys(
    JSON.parse(readFileSync(join(repo, "messages", "en.json"), "utf8")),
  ).sort();
  const graph = unitGraph(edges);
  const modulesOnly = new Map(
    [...graph]
      .filter(([unit]) => unit.startsWith("modules/"))
      .map(([unit, targets]) => [unit, new Set([...targets].filter((to) => to.startsWith("modules/")))]),
  );
  const cross = crossModuleImports(edges);
  const pairs = reciprocalPairs(graph);
  const platformToModules = edges.filter(
    (edge) => edge.from.startsWith("platform/") && edge.to.startsWith("modules/"),
  );
  const uiToFramework = edges.filter(
    (edge) => edge.from.startsWith("ui/") && edge.to.startsWith("platform/"),
  );
  const packages = measurePackages(repo);
  return {
    counts: {
      crossModuleImports: cross.length,
      // No module has an `index.ts`, so every import between modules is a deep one (M3).
      moduleIndexFiles: [...treeFiles(repo).keys()].filter((rel) => /^modules\/[^/]+\/index\.ts$/.test(rel))
        .length,
      reciprocalModulePairs: pairs.filter((pair) =>
        pair.split(" ↔ ").every((unit) => unit.startsWith("modules/")),
      ).length,
      reciprocalUnitPairs: pairs.length,
      moduleCycleGroups: cycleGroups(modulesOnly).length,
      platformToModuleImports: platformToModules.length,
      platformFilesImportingModules: new Set(platformToModules.map((edge) => edge.from)).size,
      uiToPlatformImports: uiToFramework.length,
      forbiddenNameFiles: new Set(named.map((entry) => entry.split(": ")[0])).size,
      forbiddenNameKeys: namedKeys.length,
      packageDependencies: packages.packageDependencies.length,
      packageEscapes: packages.packageEscapes.length,
      deepImports: packages.deepImports.length,
      tableAccess: packages.tableAccess.length,
    },
    crossModuleImports: cross.map(edgeKey),
    reciprocalUnits: pairs,
    moduleCycles: cycleGroups(modulesOnly),
    forbiddenNames: named,
    forbiddenNameKeys: namedKeys,
    packageDependencies: packages.packageDependencies,
    packageEscapes: packages.packageEscapes,
    deepImports: packages.deepImports,
    tableAccess: packages.tableAccess,
  };
}

/**
 * Rule M7: the names each entry of a package exports (`index.ts`, `client.ts`), the reference file
 * `baselines/exports.json`. A change to a package's interface changes this file in the same commit.
 */
export function entryExports(repo: string): Record<string, string[]> {
  const entries: Record<string, string[]> = {};
  for (const space of workspaces(repo)) {
    for (const target of Object.values(space.exports)) {
      if (!/\/(index|client)\.ts$/.test(target)) continue;
      const path = `${space.folder}/${target.replace(/^\.\//, "")}`;
      const text = readFileSync(join(repo, path), "utf8");
      const names = [...text.matchAll(/^export (?:type )?\{([^}]*)\}/gm)].flatMap((match) =>
        match[1]
          .split(",")
          .map((name) =>
            name
              .trim()
              .split(/\s+as\s+/)
              .pop()!,
          )
          .filter(Boolean),
      );
      entries[path] = [...new Set(names)].sort();
    }
  }
  return Object.fromEntries(Object.entries(entries).sort(([a], [b]) => a.localeCompare(b)));
}

if (process.argv[1]?.endsWith("modularity.ts")) {
  writeFileSync(
    join(process.cwd(), "baselines/exports.json"),
    `${JSON.stringify(entryExports(process.cwd()), null, 2)}\n`,
  );
  const baseline = measureModularity(process.cwd());
  writeFileSync(join(process.cwd(), "baselines/modularity.json"), `${JSON.stringify(baseline, null, 2)}\n`);
  console.log(JSON.stringify(baseline.counts, null, 2));
}
