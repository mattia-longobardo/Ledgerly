import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(process.cwd(), "src");
const IMPORT_SPECIFIER = /from\s+["']([^"']+)["']/g;
const TABLES_FILE = "platform/db/tables.ts";
const TABLES_TARGET = "platform/db/tables";
const SCHEMA_TARGET = /^modules\/([^/]+)\/schema$/;
const TABLES_IMPORTER_PREFIXES = ["platform/db/", "platform/auth/"];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

/** Resolves an import specifier (the `@/` alias or a relative path) to a src-relative path with no extension; `null` for a package import. */
function resolveSpecifier(fromRel: string, specifier: string): string | null {
  if (specifier.startsWith("@/")) return specifier.slice(2);
  if (specifier.startsWith(".")) return posix.normalize(posix.join(posix.dirname(fromRel), specifier));
  return null;
}

function isSchemaFile(rel: string): boolean {
  return rel.split("/").pop() === "schema.ts";
}

/**
 * Two rules, checked over every import in every file (`files`: src-relative path → source text):
 * 1. Only a module's own files (plus the table barrel and other modules' `schema.ts` files, which
 *    legitimately reference each other's tables for foreign keys) may import `modules/<m>/schema`.
 * 2. Only `platform/db/` and `platform/auth/` (Better Auth needs every table) may import the table
 *    barrel `platform/db/tables`.
 * Does not attempt to detect indirect access such as `getDb().query` (parked by controller ruling).
 */
export function findModuleBoundaryViolations(files: ReadonlyMap<string, string>): string[] {
  const violations: string[] = [];
  for (const [rel, content] of files) {
    for (const match of content.matchAll(IMPORT_SPECIFIER)) {
      const resolved = resolveSpecifier(rel, match[1]);
      if (resolved === null) continue;

      const schemaMatch = resolved.match(SCHEMA_TARGET);
      if (schemaMatch) {
        const owningModule = schemaMatch[1];
        const exempt = rel === TABLES_FILE || isSchemaFile(rel);
        if (!exempt && !rel.startsWith(`modules/${owningModule}/`)) {
          violations.push(`${rel} → ${resolved}`);
        }
      }

      if (resolved === TABLES_TARGET && !TABLES_IMPORTER_PREFIXES.some((prefix) => rel.startsWith(prefix))) {
        violations.push(`${rel} → ${resolved}`);
      }
    }
  }
  return violations;
}

describe("findModuleBoundaryViolations", () => {
  it("flags a module reaching into another module's schema via a relative import", () => {
    const files = new Map([
      ["modules/accounts/rules.ts", `import { userPreferences } from "../users/schema";`],
    ]);
    expect(findModuleBoundaryViolations(files)).toEqual(["modules/accounts/rules.ts → modules/users/schema"]);
  });

  it("flags a module reaching into another module's schema via the @/ alias", () => {
    const files = new Map([["app/page.tsx", `import { userPreferences } from "@/modules/users/schema";`]]);
    expect(findModuleBoundaryViolations(files)).toEqual(["app/page.tsx → modules/users/schema"]);
  });

  it("flags a file outside platform/db and platform/auth importing the table barrel", () => {
    const files = new Map([["app/page.tsx", `import { users } from "@/platform/db/tables";`]]);
    expect(findModuleBoundaryViolations(files)).toEqual(["app/page.tsx → platform/db/tables"]);
  });

  it("allows the table barrel and other schema.ts files to import a module's schema", () => {
    const files = new Map([
      [TABLES_FILE, `export * from "@/modules/users/schema";`],
      ["modules/accounts/schema.ts", `import { users } from "@/modules/users/schema";`],
    ]);
    expect(findModuleBoundaryViolations(files)).toEqual([]);
  });

  it("allows platform/db and platform/auth to import the table barrel", () => {
    const files = new Map([
      ["platform/db/client.ts", `import * as tables from "./tables";`],
      ["platform/auth/provider.ts", `import { users } from "@/platform/db/tables";`],
    ]);
    expect(findModuleBoundaryViolations(files)).toEqual([]);
  });
});

// This file's own name: its synthetic examples above are string literals containing
// `from "..."`, which the text-based scanner cannot tell apart from a real import.
const SELF = "architecture.test.ts";

describe("module boundaries", () => {
  it("holds for the real source tree", () => {
    const files = new Map<string, string>();
    for (const file of sourceFiles(SRC)) {
      const rel = relative(SRC, file).split(sep).join("/");
      if (rel === SELF) continue;
      files.set(rel, readFileSync(file, "utf8"));
    }
    expect(findModuleBoundaryViolations(files)).toEqual([]);
  });
});

/**
 * SEC-05 (docs/design/investments.md §5.1): the key of an investment provider is saved only by
 * `connectInvestmentProvider` and `replaceKey`, after the strict schema, the read-only check and a
 * test reading. Every other `saveConnection` call names a provider that is not in the catalog.
 */
describe("saving an investment key", () => {
  const CALL = /saveConnection\(\s*ctx,\s*\{\s*provider:\s*([A-Za-z_.]+)/g;
  const OTHERS = new Set(["WALLET_PROVIDER", "TREK_PROVIDER", "PAPERLESS_PROVIDER"]);
  const OWNER = "modules/investments/sync.ts";

  function calls(): Map<string, string[]> {
    const found = new Map<string, string[]>();
    for (const file of sourceFiles(SRC)) {
      const rel = relative(SRC, file).split(sep).join("/");
      if (rel === SELF || /\.(test|itest)\.tsx?$/.test(rel) || rel === "platform/integrations/service.ts")
        continue;
      const content = readFileSync(file, "utf8");
      const providers = [...content.matchAll(CALL)].map((match) => match[1]);
      if (content.includes("saveConnection(") || providers.length > 0) found.set(rel, providers);
    }
    return found;
  }

  it("happens only in the investments sync, twice: connecting and replacing the key", () => {
    const found = calls();
    expect(found.get(OWNER)).toEqual(["provider.id", "provider.id"]);
    const owner = readFileSync(join(SRC, OWNER), "utf8");
    const connect = owner.slice(owner.indexOf("export async function connectInvestmentProvider("));
    const replace = owner.slice(owner.indexOf("export async function replaceKey("));
    expect(connect.split("export async function")[1]).toContain("saveConnection(");
    expect(replace.split("export async function")[1]).toContain("saveConnection(");
  });

  it("names a non-investment provider everywhere else", () => {
    for (const [file, providers] of calls()) {
      if (file === OWNER) continue;
      expect(providers.length, file).toBeGreaterThan(0);
      for (const provider of providers) expect(OTHERS.has(provider), `${file}: ${provider}`).toBe(true);
    }
  });
});

describe("the image's dependencies (PERS-87 SEC-04)", () => {
  it("are installed without their install scripts", () => {
    const dockerfile = readFileSync(join(process.cwd(), "Dockerfile"), "utf8");
    const installs = dockerfile.split("\n").filter((line) => /\bnpm (ci|install|i)\b/.test(line));
    expect(installs).toEqual(["RUN npm ci --ignore-scripts"]);
  });
});
