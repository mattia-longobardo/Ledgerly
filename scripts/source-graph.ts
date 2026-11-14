// scripts/source-graph.ts — the import graph of `src/`, read from the text of the files.
//
// One reader for every structural measure of the rewrite plan (docs/design/rewrite-plan/10-modularity.md
// §10.6): `src/architecture.test.ts` checks the graph against the known lists in
// `baselines/modularity.json`, and `scripts/modularity.ts` writes those lists. No package of its own:
// the same method as the two rules the architecture test already had, a regular expression over the
// import specifiers (decision H11).
import { readdirSync, readFileSync, statSync } from "node:fs";
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

/** The product files of `src/`: path → text. Tests are not part of the graph. */
export function readProductSources(src: string): Map<string, string> {
  const files = new Map<string, string>();
  for (const rel of sourceFiles(src)) {
    if (!isTestFile(rel)) files.set(rel, readFileSync(join(src, rel), "utf8"));
  }
  return files;
}

/** An import specifier as a src-relative path with no extension; `null` for a package. */
export function resolveSpecifier(fromRel: string, specifier: string): string | null {
  if (specifier.startsWith("@/")) return specifier.slice(2);
  if (specifier.startsWith(".")) return posix.normalize(posix.join(posix.dirname(fromRel), specifier));
  return null;
}

/** Every import between two files of the tree, once per (file, target), sorted. */
export function importEdges(files: ReadonlyMap<string, string>): Edge[] {
  const edges = new Map<string, Edge>();
  for (const [rel, content] of files) {
    for (const match of content.matchAll(SPECIFIER)) {
      const to = resolveSpecifier(rel, match[1]);
      if (to === null || to.startsWith("..")) continue;
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
export function unitOf(rel: string): string {
  const parts = rel.split("/");
  if (parts[0] === "modules" && parts.length > 2) return `modules/${parts[1]}`;
  if (parts[0] === "platform") {
    if (parts[1] === "integrations" && parts.length > 3) return `platform/integrations/${parts[2]}`;
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
