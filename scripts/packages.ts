// scripts/packages.ts — the boundaries of the packages of the monorepo (rewrite plan R0,
// docs/design/rewrite-plan/10-modularity.md §10.2, §10.6: rules M1, M3, M5, M6, M7; §10.8: Q4).
// `tools/architecture.test.ts` holds the tree to what this reads: the lists that are known today
// are written by `npm run modularity` into `baselines/modularity.json` and can only get shorter; the
// rest must be empty. Same method as the rest of the gate: the text of the files (decision H11).
import { readdirSync, readFileSync } from "node:fs";
import ts from "typescript";
import { join, posix } from "node:path";
import { importEdges, readProductSources, treeFiles, unitOf } from "./source-graph";

/** A workspace: its name, its folder and what its `package.json` declares. */
export interface Workspace {
  name: string;
  folder: string;
  dependencies: string[];
  exports: Record<string, string>;
}

export function workspaces(repo: string): Workspace[] {
  const found: Workspace[] = [];
  for (const group of ["apps", "packages", "plugins"]) {
    for (const entry of readdirSync(join(repo, group), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const folder = `${group}/${entry.name}`;
      let manifest: { name: string; dependencies?: Record<string, string>; exports?: Record<string, string> };
      try {
        manifest = JSON.parse(readFileSync(join(repo, folder, "package.json"), "utf8"));
      } catch {
        continue;
      }
      found.push({
        name: manifest.name,
        folder,
        dependencies: Object.keys(manifest.dependencies ?? {}),
        exports: manifest.exports ?? {},
      });
    }
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The dependencies §10.2 allows, by workspace: `only` lists every package it may import (Node's own
 * modules are always there), `never` the packages it may not. Where a package of R0 still holds
 * what a later release takes out (the web app holds the API and the jobs until R4), the import is on
 * the known list of M1, not here.
 */
export const ALLOWED: Record<string, { only?: string[]; never?: string[]; typesOnly?: string[] }> = {
  "@ledgerly/domain": { only: ["drizzle-orm", "pg", "zod"] },
  "@ledgerly/api-contract": { only: ["zod"] },
  "@ledgerly/plugin-contract": { only: ["zod"] },
  "@ledgerly/plugin-host": {
    only: ["@ledgerly/plugin-contract", "@ledgerly/domain"],
    typesOnly: ["@ledgerly/domain"],
  },
  "@ledgerly/api": { only: ["@ledgerly/api-contract", "@ledgerly/domain", "@ledgerly/plugin-host", "hono"] },
  "@ledgerly/web": { never: ["@ledgerly/domain", "drizzle-orm", "@ledgerly/plugin-host"] },
  "@ledgerly/plugin-enablebanking": { only: ["@ledgerly/plugin-contract", "zod"] },
};

/** M6: what a layer never imports, whatever its known lists say. */
export const FORBIDDEN_LAYERS: Record<string, RegExp> = {
  "@ledgerly/domain": /^(next|react|react-dom|hono)(\/|$)/,
  "@ledgerly/api-contract": /^(?!zod$)/,
  "@ledgerly/plugin-contract": /^(?!zod$)/,
};

const ALIASES = /^@(domain|plugin-host|plugin-contract)\//;

/** The package a bare specifier names: `@scope/name` or `name`. */
const packageOf = (specifier: string) =>
  specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0];

interface Imported {
  specifier: string;
  /** Types only: `import type`, or every name marked `type`. */
  typeOnly: boolean;
  /** The local names it brings. */
  names: string[];
}

/** Every import of a file, read by the parser of `typescript` (comments and strings are not imports). */
function importsOf(path: string, text: string): Imported[] {
  const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const found: Imported[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      let typeOnly = false;
      let names: string[] = [];
      if (ts.isImportDeclaration(node)) {
        const clause = node.importClause;
        const elements =
          clause?.namedBindings && ts.isNamedImports(clause.namedBindings)
            ? clause.namedBindings.elements
            : [];
        names = elements.map((element) => element.name.text);
        if (clause?.name) names.push(clause.name.text);
        typeOnly =
          clause?.isTypeOnly === true ||
          (clause !== undefined &&
            !clause.name &&
            elements.length > 0 &&
            elements.every((element) => element.isTypeOnly));
      } else {
        typeOnly = node.isTypeOnly;
      }
      found.push({ specifier: node.moduleSpecifier.text, typeOnly, names });
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] !== undefined &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      found.push({ specifier: node.arguments[0].text, typeOnly: false, names: [] });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

export interface PackageMeasure {
  /** M1, known list: `<workspace> → <package>` for an import §10.2 does not allow. */
  packageDependencies: string[];
  /** M1, known list: `<file> → <path>` for a relative import that leaves its workspace. */
  packageEscapes: string[];
  /** M3, known list: `<file> → <file>` for an import of another module's file, not its entry. */
  deepImports: string[];
  /** M5, known list: `<file>: <table>` for a table of another unit, imported or named in SQL. */
  tableAccess: string[];
  /** Must be empty: an import of a package the workspace does not declare. */
  undeclared: string[];
  /** Must be empty: M6, an import of a layer the package may never reach. */
  layers: string[];
  /** Must be empty: a product file that reaches a package through the aliases of the tests. */
  aliases: string[];
  /** Must be empty: a client component that reaches the server side of the domain. */
  clientReach: string[];
  /** Must be empty: two workspaces that import each other, directly or not. */
  packageCycles: string[];
  /** Must be empty: an entry with `export *`. */
  starExports: string[];
  /** Must be empty: Q4, one name declared by two files of a unit. */
  duplicateNames: string[];
}

/** The tables of the schemas: the name of the constant → the unit that owns it, and its SQL name. */
function tablesOf(sources: ReadonlyMap<string, string>): Map<string, { unit: string; sql: string }> {
  const tables = new Map<string, { unit: string; sql: string }>();
  for (const [rel, text] of sources) {
    if (!/(^|\/)schema(\.ts|\/)/.test(rel)) continue;
    for (const match of text.matchAll(/export const (\w+) = pgTable\(\s*["'](\w+)["']/g)) {
      tables.set(match[1], { unit: unitOf(rel), sql: match[2] });
    }
  }
  return tables;
}

export function measurePackages(repo: string): PackageMeasure {
  const spaces = workspaces(repo);
  const disk = treeFiles(repo);
  const sources = readProductSources(repo);
  const measure: PackageMeasure = {
    packageDependencies: [],
    packageEscapes: [],
    deepImports: [],
    tableAccess: [],
    undeclared: [],
    layers: [],
    aliases: [],
    clientReach: [],
    packageCycles: [],
    starExports: [],
    duplicateNames: [],
  };
  const reaches = new Map<string, Set<string>>();
  const pairs = new Set<string>();
  const files = [...readProductFilesOf(repo, spaces)];
  for (const { path, text, space } of files) {
    const client = /^["']use client["']/.test(text.trimStart());
    for (const { specifier, typeOnly } of importsOf(path, text)) {
      if (specifier.startsWith(".")) {
        const target = posix.normalize(posix.join(posix.dirname(path), specifier));
        if (!target.startsWith(`${space.folder}/`)) measure.packageEscapes.push(`${path} → ${target}`);
        continue;
      }
      if (specifier.startsWith("node:") || (specifier.startsWith("@/") && space.name === "@ledgerly/web"))
        continue;
      if (ALIASES.test(specifier) || specifier.startsWith("@/")) {
        measure.aliases.push(`${path} → ${specifier}`);
        continue;
      }
      const name = packageOf(specifier);
      if (name === space.name) continue;
      if (!space.dependencies.includes(name)) measure.undeclared.push(`${path} → ${name}`);
      if (FORBIDDEN_LAYERS[space.name]?.test(name)) measure.layers.push(`${path} → ${name}`);
      const rule = ALLOWED[space.name] ?? {};
      const refused =
        (rule.only !== undefined && !rule.only.includes(name)) ||
        (rule.never !== undefined && rule.never.includes(name)) ||
        (rule.typesOnly?.includes(name) === true && !typeOnly);
      if (refused) pairs.add(`${space.name} → ${name}${rule.typesOnly?.includes(name) ? " (values)" : ""}`);
      if (name.startsWith("@ledgerly/")) {
        if (!reaches.has(space.name)) reaches.set(space.name, new Set());
        reaches.get(space.name)!.add(name);
      }
      if (client && !typeOnly) {
        const entry = specifier.slice(name.length);
        const browserSafe =
          name === "@ledgerly/domain"
            ? /\/client$/.test(entry) || /^\/(platform|shared)\/[^/]+$/.test(entry)
            : !name.startsWith("@ledgerly/");
        if (!browserSafe) measure.clientReach.push(`${path} → ${specifier}`);
      }
    }
    if (
      /\/(index|client)\.ts$/.test(path) &&
      Object.values(space.exports).includes(`./${path.slice(space.folder.length + 1)}`)
    ) {
      if (/^export \*/m.test(text)) measure.starExports.push(path);
    }
  }
  measure.packageDependencies = [...pairs].sort();

  // Packages that import each other, directly or through others.
  const reach = (from: string, seen = new Set<string>()): Set<string> => {
    for (const next of reaches.get(from) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        reach(next, seen);
      }
    }
    return seen;
  };
  for (const space of spaces) if (reach(space.name).has(space.name)) measure.packageCycles.push(space.name);

  // M3 and M5 over the one tree of the sources.
  const tables = tablesOf(sources);
  const edges = importEdges(sources);
  for (const edge of edges) {
    const toUnit = unitOf(edge.to);
    if (!toUnit.startsWith("modules/") || unitOf(edge.from) === toUnit) continue;
    const entry = edge.to === toUnit || edge.to === `${toUnit}/index` || edge.to === `${toUnit}/client`;
    const schemaReference = /(^|\/)schema(\.ts|\/)/.test(edge.from) || edge.from === "platform/db/tables.ts";
    if (!entry && !schemaReference && !/(^|\/)schema$/.test(edge.to))
      measure.deepImports.push(`${edge.from} → ${edge.to}`);
  }
  for (const [rel, text] of sources) {
    if (/(^|\/)schema(\.ts|\/)/.test(rel) || rel === "platform/db/tables.ts") continue;
    const unit = unitOf(rel);
    const named = new Set<string>();
    for (const { names } of importsOf(rel, text)) {
      for (const local of names) {
        const table = tables.get(local);
        if (table && table.unit !== unit) named.add(local);
      }
    }
    for (const match of text.matchAll(/\.query\.(\w+)\b/g)) {
      const table = tables.get(match[1]);
      if (table && table.unit !== unit) named.add(match[1]);
    }
    for (const match of text.matchAll(/sql`([^`]*)`/g)) {
      for (const [constant, table] of tables) {
        if (
          table.unit !== unit &&
          new RegExp(`(from|join|into|update)\\s+"?${table.sql}\\b`, "i").test(match[1])
        ) {
          named.add(constant);
        }
      }
    }
    for (const table of named) measure.tableAccess.push(`${rel}: ${table}`);
  }

  // Q4: a name is declared once in a unit.
  const declared = new Map<string, string[]>();
  for (const [rel, text] of sources) {
    // In the domain: the web app's Next.js files repeat `GET`, `dynamic`, `generateMetadata` by convention.
    if (/\/(index|client)\.ts$/.test(rel) || !disk.get(rel)!.includes("/packages/domain/")) continue;
    for (const match of text.matchAll(
      /^export (?:async )?(?:function\*?|const|let|class|type|interface|enum) (\w+)/gm,
    )) {
      const key = `${unitOf(rel)}: ${match[1]}`;
      declared.set(key, [...(declared.get(key) ?? []), rel]);
    }
  }
  for (const [key, where] of declared) {
    const distinct = [...new Set(where)];
    if (distinct.length > 1) measure.duplicateNames.push(`${key} (${distinct.join(", ")})`);
  }

  for (const key of Object.keys(measure) as (keyof PackageMeasure)[])
    measure[key] = [...new Set(measure[key])].sort();
  return measure;
}

function* readProductFilesOf(repo: string, spaces: Workspace[]) {
  for (const [, path] of treeFiles(repo)) {
    const rel = path.slice(repo.length + 1);
    if (/\.(test|itest)\.tsx?$/.test(rel) || rel.endsWith(".d.ts")) continue;
    const space = spaces.find((one) => rel.startsWith(`${one.folder}/`));
    if (space) yield { path: rel, text: readFileSync(path, "utf8"), space };
  }
  for (const space of spaces.filter((one) => one.folder.startsWith("plugins/"))) {
    const walk = (dir: string): string[] =>
      readdirSync(join(repo, dir), { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory()
          ? walk(`${dir}/${entry.name}`)
          : /\.tsx?$/.test(entry.name)
            ? [`${dir}/${entry.name}`]
            : [],
      );
    for (const rel of walk(`${space.folder}/src`)) {
      if (/\.(test|itest)\.tsx?$/.test(rel)) continue;
      yield { path: rel, text: readFileSync(join(repo, rel), "utf8"), space };
    }
  }
}

if (process.argv[1]?.endsWith("packages.ts")) {
  const measure = measurePackages(process.cwd());
  for (const [key, list] of Object.entries(measure)) {
    console.log(`${key}: ${list.length}`);
    for (const entry of list.slice(0, 50)) console.log(`  ${entry}`);
  }
}
