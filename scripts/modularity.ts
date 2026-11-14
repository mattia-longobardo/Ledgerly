// scripts/modularity.ts — `npm run modularity`. Writes `baselines/modularity.json`: the known lists
// that `src/architecture.test.ts` holds the tree to, and the counts the rewrite plan tracks
// (docs/design/rewrite-plan/10-modularity.md §10.5, §10.6: rules M2, M3, M4, M6).
//
// The lists may only get shorter. Run this after removing a violation, and commit the file with the
// change that removed it; the test fails on a new violation and on a stale entry alike. Running it
// to make a new violation pass is the thing the test exists to stop.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  crossModuleImports,
  cycleGroups,
  edgeKey,
  importEdges,
  readProductSources,
  reciprocalPairs,
  sourceFiles,
  unitGraph,
} from "./source-graph";

export type ModularityBaseline = {
  counts: Record<string, number>;
  crossModuleImports: string[];
  reciprocalUnits: string[];
  moduleCycles: string[][];
};

export function measureModularity(src: string): ModularityBaseline {
  const edges = importEdges(readProductSources(src));
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
  return {
    counts: {
      crossModuleImports: cross.length,
      // No module has an `index.ts`, so every import between modules is a deep one (M3).
      moduleIndexFiles: sourceFiles(src).filter((rel) => /^modules\/[^/]+\/index\.ts$/.test(rel)).length,
      reciprocalModulePairs: pairs.filter((pair) =>
        pair.split(" ↔ ").every((unit) => unit.startsWith("modules/")),
      ).length,
      reciprocalUnitPairs: pairs.length,
      moduleCycleGroups: cycleGroups(modulesOnly).length,
      platformToModuleImports: platformToModules.length,
      platformFilesImportingModules: new Set(platformToModules.map((edge) => edge.from)).size,
      uiToPlatformImports: uiToFramework.length,
    },
    crossModuleImports: cross.map(edgeKey),
    reciprocalUnits: pairs,
    moduleCycles: cycleGroups(modulesOnly),
  };
}

if (process.argv[1]?.endsWith("modularity.ts")) {
  const baseline = measureModularity(join(process.cwd(), "src"));
  writeFileSync(join(process.cwd(), "baselines/modularity.json"), `${JSON.stringify(baseline, null, 2)}\n`);
  console.log(JSON.stringify(baseline.counts, null, 2));
}
