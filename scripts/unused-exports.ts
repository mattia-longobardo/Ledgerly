// scripts/unused-exports.ts — `npm run unused-exports`. Rule Q9 of the rewrite plan
// (docs/design/rewrite-plan/10-modularity.md §10.8): no export without a use. An exported name of a
// product file is used when another file of the repository imports it — a test and a script count —
// or when Next.js reads it by convention (a page, a layout, a route, the proxy). A name an `index.ts`
// or a `client.ts` re-exports is used when the name of the entry is.
//
// No package of its own (decision H11): the compiler of `typescript`, which the project already has,
// resolves every import the way `tsc` does.
import { join, relative, sep } from "node:path";
import ts from "typescript";

/** The files Next.js reads by their path, and the names it reads from them. */
const NEXT_FILE =
  /^apps\/web\/src\/app\/(.*\/)?(page|layout|template|default|error|global-error|not-found|loading|route|sitemap|robots|manifest|opengraph-image|icon|apple-icon)\.tsx?$/;
const NEXT_NAMES = new Set([
  "default",
  "metadata",
  "generateMetadata",
  "generateStaticParams",
  "generateViewport",
  "viewport",
  "dynamic",
  "dynamicParams",
  "revalidate",
  "fetchCache",
  "runtime",
  "preferredRegion",
  "maxDuration",
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
]);
/** Other files a tool reads by convention: the name it reads. */
const CONVENTION: Record<string, readonly string[]> = {
  "apps/web/src/proxy.ts": ["proxy", "config"],
  "apps/web/src/instrumentation.ts": ["register"],
  "apps/web/src/platform/i18n/request.ts": ["default"],
};

const isProduct = (rel: string) =>
  /^(apps\/[^/]+\/src|packages\/[^/]+\/src|plugins\/[^/]+\/src)\//.test(rel) &&
  !/\.(test|itest)\.tsx?$/.test(rel) &&
  !rel.endsWith(".d.ts");

/** `<file>: <name>` for every exported name of a product file that nothing uses, sorted. */
export function unusedExports(repo: string): string[] {
  const parsed = ts.getParsedCommandLineOfConfigFile(
    join(repo, "tsconfig.json"),
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: () => {},
    },
  );
  if (!parsed) throw new Error("tsconfig.json not readable");
  const program = ts.createProgram(parsed.fileNames, { ...parsed.options, noEmit: true });
  const checker = program.getTypeChecker();
  const relOf = (file: string) => relative(repo, file).split(sep).join("/");

  /** The declaration a name stands for, through any chain of re-exports. */
  const target = (symbol: ts.Symbol): ts.Symbol =>
    symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  const used = new Set<ts.Symbol>();
  /** `<file>#<name>` of the entries (`index.ts`, `client.ts`) another file imports a name from. */
  const entryNames = new Set<string>();
  const markEntry = (symbol: ts.Symbol) => {
    const immediate = checker.getImmediateAliasedSymbol(symbol);
    const declaration = immediate?.declarations?.[0];
    if (immediate && declaration)
      entryNames.add(`${relOf(declaration.getSourceFile().fileName)}#${immediate.name}`);
  };

  for (const file of program.getSourceFiles()) {
    if (file.isDeclarationFile || relOf(file.fileName).startsWith("node_modules/")) continue;
    const visit = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node) && node.importClause) {
        const { name, namedBindings } = node.importClause;
        if (name) {
          const symbol = checker.getSymbolAtLocation(name);
          if (symbol) used.add(target(symbol));
        }
        if (namedBindings && ts.isNamedImports(namedBindings)) {
          for (const element of namedBindings.elements) {
            const symbol = checker.getSymbolAtLocation(element.name);
            if (symbol) {
              used.add(target(symbol));
              markEntry(symbol);
            }
          }
        }
        if (namedBindings && ts.isNamespaceImport(namedBindings)) {
          const resolved = checker.getSymbolAtLocation(node.moduleSpecifier);
          if (resolved) for (const each of checker.getExportsOfModule(resolved)) used.add(target(each));
        }
      } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && !node.exportClause) {
        // `export * from` marks nothing by itself: what the names of the entry are used for does.
      } else if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments[0] &&
        ts.isStringLiteralLike(node.arguments[0])
      ) {
        const resolved = checker.getSymbolAtLocation(node.arguments[0]);
        if (resolved) for (const each of checker.getExportsOfModule(resolved)) used.add(target(each));
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }

  const found: string[] = [];
  for (const file of program.getSourceFiles()) {
    const rel = relOf(file.fileName);
    if (!isProduct(rel)) continue;
    const moduleSymbol = checker.getSymbolAtLocation(file);
    if (!moduleSymbol) continue;
    if (/\/(index|client)\.ts$/.test(rel)) {
      // An entry's name is used when a file imports it from the entry itself.
      for (const symbol of checker.getExportsOfModule(moduleSymbol)) {
        if (!entryNames.has(`${rel}#${symbol.name}`)) found.push(`${rel}: ${symbol.name}`);
      }
      continue;
    }
    const next = NEXT_FILE.test(rel);
    for (const symbol of checker.getExportsOfModule(moduleSymbol)) {
      if (next && NEXT_NAMES.has(symbol.name)) continue;
      if (CONVENTION[rel]?.includes(symbol.name)) continue;
      if (!used.has(target(symbol))) found.push(`${rel}: ${symbol.name}`);
    }
  }
  return found.sort();
}

if (process.argv[1]?.endsWith("unused-exports.ts")) {
  const found = unusedExports(process.cwd());
  for (const entry of found) console.log(entry);
  console.log(`${found.length} exports without a use`);
  process.exit(found.length > 0 ? 1 : 0);
}
