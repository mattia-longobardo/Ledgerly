// scripts/source-graph.ts — the import graph of `src/`, read from the text of the files.
//
// One reader for every structural measure of the rewrite plan (docs/design/rewrite-plan/10-modularity.md
// §10.6): `src/architecture.test.ts` checks the graph against the known lists in
// `baselines/modularity.json`, and `scripts/modularity.ts` writes those lists. No package of its own:
// the same method as the two rules the architecture test already had, a regular expression over the
// import specifiers (decision H11).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix, relative, sep } from "node:path";

/** `from "x"`, `import "x"` and `import("x")`: static, side-effect and dynamic imports. */
const SPECIFIER = /(?:\bfrom\s+|\bimport\s+|\bimport\(\s*)["']([^"']+)["']/g;
const TEST_FILE = /\.(?:test|itest)\.tsx?$/;

export type Edge = { from: string; to: string };

/** Every `.ts`/`.tsx` file under `dir`, as paths relative to it, with `/` separators, sorted. */
export function sourceFiles(dir: string): string[] {
  const walk = (current: string): string[] =>
    readdirSync(current).flatMap((name) => {
      const path = join(current, name);
      if (statSync(path).isDirectory()) return walk(path);
      return /\.(?:ts|tsx)$/.test(name) ? [relative(dir, path).split(sep).join("/")] : [];
    });
  return walk(dir).sort();
}

export function isTestFile(rel: string): boolean {
  return TEST_FILE.test(rel);
}

/**
 * The product trees of the monorepo (R0). Each file keeps the path it had in the one `src/` tree
 * before the packages: `modules/<name>/…` and `platform/<area>/…` whether the file is in the web app
 * or in `packages/domain`, the plugin contract under `platform/plugins/contract/`. The units, the
 * known lists of `baselines/` and the plan's tables keep their names that way.
 */
export const SOURCE_ROOTS: readonly { dir: string; prefix: string }[] = [
  { dir: "apps/web/src", prefix: "" },
  { dir: "packages/domain/src", prefix: "" },
  { dir: "packages/plugin-host/src", prefix: "platform/plugins/" },
  { dir: "packages/plugin-contract/src", prefix: "platform/plugins/contract/" },
];

/** Every `.ts`/`.tsx` file of the product trees under `repo`: its path in the tree → its path on disk. */
export function treeFiles(repo: string): Map<string, string> {
  const files = new Map<string, string>();
  for (const root of SOURCE_ROOTS) {
    const dir = join(repo, root.dir);
    if (!existsSync(dir)) continue;
    for (const rel of sourceFiles(dir)) files.set(`${root.prefix}${rel}`, join(dir, rel));
  }
  return new Map([...files].sort(([a], [b]) => a.localeCompare(b)));
}

/** The product files of the trees: path → text. Tests are not part of the graph. */
export function readProductSources(repo: string): Map<string, string> {
  const files = new Map<string, string>();
  for (const [rel, path] of treeFiles(repo)) {
    if (!isTestFile(rel)) files.set(rel, readFileSync(path, "utf8"));
  }
  return files;
}

/** The packages a file reaches by name, and where their entries are in the tree. */
const PACKAGE_ENTRIES: readonly [string, string][] = [
  ["@ledgerly/plugin-contract", "platform/plugins/contract/index"],
  ["@ledgerly/plugin-host", "platform/plugins/index"],
];
/** The path aliases of the tests and the scripts: a file of a package by its path. */
const ALIASES: readonly [string, string][] = [
  ["@/", ""],
  ["@domain/", ""],
  ["@plugin-host/", "platform/plugins/"],
  ["@plugin-contract/", "platform/plugins/contract/"],
];

/**
 * An import specifier as a tree path with no extension; `null` for a package outside the repository.
 * An entry of `@ledgerly/domain` is the unit it names: `@ledgerly/domain/accounts` is
 * `modules/accounts`, `@ledgerly/domain/platform/db` is `platform/db`.
 */
export function resolveSpecifier(fromRel: string, specifier: string): string | null {
  for (const [name, path] of PACKAGE_ENTRIES) if (specifier === name) return path;
  if (specifier.startsWith("@ledgerly/domain/")) {
    const entry = specifier.slice("@ledgerly/domain/".length);
    return /^(platform|shared)\//.test(entry) ? entry : `modules/${entry}`;
  }
  for (const [alias, path] of ALIASES)
    if (specifier.startsWith(alias)) return path + specifier.slice(alias.length);
  if (specifier.startsWith(".")) return posix.normalize(posix.join(posix.dirname(fromRel), specifier));
  return null;
}

/** A unit's folder stands for its `index.ts`. */
function withIndex(files: ReadonlyMap<string, string>, path: string): string {
  return files.has(`${path}/index.ts`) ? `${path}/index` : path;
}

/**
 * A file split in parts (rule Q6: `service.ts` → `service/…` with its `index.ts`) is read as the
 * one file it was: its parts as `…/service.ts`, an import of it as `…/service`. The known lists
 * keep their entries, and the imports between its parts are not imports between files.
 */
export function asOneFile(files: ReadonlyMap<string, string>, path: string): string {
  const folder = path.endsWith("/index") ? path.slice(0, -"/index".length) : posix.dirname(path);
  const unit = unitOf(path);
  if (folder === unit || !folder.startsWith(`${unit}/`) || !files.has(`${folder}/index.ts`)) return path;
  return path.endsWith("/index") || !/\.tsx?$/.test(path) ? folder : `${folder}.ts`;
}

/** Every import between two files of the tree, once per (file, target), sorted. */
export function importEdges(files: ReadonlyMap<string, string>): Edge[] {
  const edges = new Map<string, Edge>();
  for (const [file, content] of files) {
    const rel = asOneFile(files, file);
    for (const match of content.matchAll(SPECIFIER)) {
      const resolved = resolveSpecifier(file, match[1]);
      if (resolved === null || resolved.startsWith("..")) continue;
      const to = asOneFile(files, withIndex(files, resolved));
      if (to === rel.replace(/\.tsx?$/, "")) continue;
      edges.set(`${rel} → ${to}`, { from: rel, to });
    }
  }
  return [...edges.values()].sort((a, b) => edgeKey(a).localeCompare(edgeKey(b)));
}

export function edgeKey(edge: Edge): string {
  return `${edge.from} → ${edge.to}`;
}

/**
 * The unit a path belongs to: `modules/<name>`, `platform/integrations/<provider>` for a provider's
 * folder, `platform/<area>` for the rest of platform, and the first folder otherwise (`app`, `ui`).
 */
/** The names of a unit's files that grew into a folder of parts (rule Q1, Q6). */
const SPLIT_FILES = ["service", "queries", "rules", "schema", "jobs"];

export function unitOf(rel: string): string {
  const parts = rel.split("/");
  if (parts[0] === "modules" && parts.length > 2) return `modules/${parts[1]}`;
  // The domain's shared primitives (R0, 10-modularity.md §10.3, level 0): one unit each.
  if (parts[0] === "shared" && parts.length > 1) return `shared/${parts[1].replace(/\.tsx?$/, "")}`;
  if (parts[0] === "platform") {
    // A provider has its folder; `service/` is the core's file split in parts (rule Q6), not a provider.
    if (parts[1] === "integrations" && parts.length > 3 && !SPLIT_FILES.includes(parts[2])) {
      return `platform/integrations/${parts[2]}`;
    }
    return `platform/${parts[1].replace(/\.tsx?$/, "")}`;
  }
  return parts[0].replace(/\.tsx?$/, "");
}

export function moduleOf(rel: string): string | null {
  const unit = unitOf(rel);
  return unit.startsWith("modules/") ? unit.slice("modules/".length) : null;
}

/** Imports whose two ends are in different modules (`src/modules/<a>` → `src/modules/<b>`). */
export function crossModuleImports(edges: readonly Edge[]): Edge[] {
  return edges.filter((edge) => {
    const from = moduleOf(edge.from);
    const to = moduleOf(edge.to);
    return from !== null && to !== null && from !== to;
  });
}

/** The graph between units, as `unit → set of units it imports`. */
export function unitGraph(edges: readonly Edge[]): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>();
  for (const edge of edges) {
    const from = unitOf(edge.from);
    const to = unitOf(edge.to);
    if (!graph.has(from)) graph.set(from, new Set());
    if (!graph.has(to)) graph.set(to, new Set());
    if (from !== to) graph.get(from)!.add(to);
  }
  return graph;
}

/** Pairs of units that import each other, as `a ↔ b` with `a < b`, sorted. */
export function reciprocalPairs(graph: ReadonlyMap<string, ReadonlySet<string>>): string[] {
  const pairs: string[] = [];
  for (const [from, targets] of graph) {
    for (const to of targets) {
      if (from < to && graph.get(to)?.has(from)) pairs.push(`${from} ↔ ${to}`);
    }
  }
  return pairs.sort();
}

/**
 * The strongly connected components with more than one unit (Tarjan): each is a group of units
 * where every one reaches every other, which is what "a cycle" means. Units sorted in a group,
 * groups sorted by their first unit.
 */
export function cycleGroups(graph: ReadonlyMap<string, ReadonlySet<string>>): string[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const groups: string[][] = [];
  let counter = 0;

  const visit = (unit: string): void => {
    index.set(unit, counter);
    low.set(unit, counter);
    counter += 1;
    stack.push(unit);
    onStack.add(unit);
    for (const next of graph.get(unit) ?? []) {
      if (!index.has(next)) {
        visit(next);
        low.set(unit, Math.min(low.get(unit)!, low.get(next)!));
      } else if (onStack.has(next)) {
        low.set(unit, Math.min(low.get(unit)!, index.get(next)!));
      }
    }
    if (low.get(unit) !== index.get(unit)) return;
    const group: string[] = [];
    for (;;) {
      const member = stack.pop()!;
      onStack.delete(member);
      group.push(member);
      if (member === unit) break;
    }
    if (group.length > 1) groups.push(group.sort());
  };

  for (const unit of [...graph.keys()].sort()) if (!index.has(unit)) visit(unit);
  return groups.sort((a, b) => a[0].localeCompare(b[0]));
}
