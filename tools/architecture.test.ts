import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { entryExports, measureModularity, type ModularityBaseline } from "../scripts/modularity";
import {
  findClientDatabaseReach,
  findWebServerReach,
  measurePackages,
  workspaces,
} from "../scripts/packages";
import {
  asOneFile,
  cycleGroups,
  reciprocalPairs,
  resolveSpecifier,
  treeFiles,
  unitGraph,
  unitOf,
} from "../scripts/source-graph";

const ROOT = process.cwd();
const TREE = treeFiles(ROOT);
const IMPORT_SPECIFIER = /from\s+["']([^"']+)["']/g;
const TABLES_FILE = "platform/db/tables.ts";
const TABLES_TARGET = "platform/db/tables";
const SCHEMA_TARGET = /^modules\/([^/]+)\/schema$/;
const TABLES_IMPORTER_PREFIXES = ["platform/db/", "platform/auth/"];

function isSchemaFile(rel: string): boolean {
  // A schema split in parts (rule Q6) is a folder `schema/`.
  return rel.split("/").pop() === "schema.ts" || rel.split("/").at(-2) === "schema";
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
    for (const [rel, file] of TREE) {
      if (rel === SELF) continue;
      files.set(rel, readFileSync(file, "utf8"));
    }
    expect(findModuleBoundaryViolations(files)).toEqual([]);
  });
});

/**
 * The known lists of the rewrite plan (docs/design/rewrite-plan/10-modularity.md §10.6, rules M2 and
 * M4; release N0). The tree is held to `baselines/modularity.json` in both directions: an import
 * between modules, a pair of units importing each other or a cycle that is not in the file fails, and
 * so does an entry of the file that no longer exists — so the lists can only get shorter, and the
 * file is always what the code is. `npm run modularity` rewrites it after a violation is removed.
 */
describe("the known modularity violations", () => {
  const known = JSON.parse(
    readFileSync(join(ROOT, "baselines/modularity.json"), "utf8"),
  ) as ModularityBaseline;
  const now = measureModularity(ROOT);
  const added = (before: readonly string[], after: readonly string[]) =>
    after.filter((entry) => !before.includes(entry));

  it("gain no import between two modules (M2)", () => {
    // A file and the module it imports: the same import read through the module's entry instead of
    // one of its files (M3) is not a new import between two modules.
    const toModule = (entries: readonly string[]) =>
      entries.map((entry) => entry.replace(/ → (modules\/[^/]+)\/.*$/, " → $1"));
    expect(added(toModule(known.crossModuleImports), toModule(now.crossModuleImports))).toEqual([]);
  });

  it("gain no pair of units that import each other (M4)", () => {
    expect(added(known.reciprocalUnits, now.reciprocalUnits)).toEqual([]);
  });

  it("gain no cycle between modules, and no module joins one (M4)", () => {
    const flat = (groups: readonly string[][]) => groups.map((group) => group.join(" · "));
    expect(added(flat(known.moduleCycles), flat(now.moduleCycles))).toEqual([]);
  });

  it("gain no file that names a provider, a fund or an employer (M12)", () => {
    expect(added(known.forbiddenNames, now.forbiddenNames)).toEqual([]);
  });

  it("gain no message key that carries such a name (M14)", () => {
    expect(added(known.forbiddenNameKeys, now.forbiddenNameKeys)).toEqual([]);
  });

  it("name no provider, fund or employer in Funds: the list of that module is empty from N6 (M12)", () => {
    const inFunds = (entry: string) => /^(modules\/funds\/|app\/\(app\)\/funds\/)/.test(entry);
    expect(now.forbiddenNames.filter(inFunds)).toEqual([]);
    expect(now.forbiddenNameKeys.filter((key) => key.startsWith("funds."))).toEqual([]);
  });

  it("gain no dependency of a package outside §10.2, and no import out of a package (M1)", () => {
    expect(added(known.packageDependencies, now.packageDependencies)).toEqual([]);
    expect(added(known.packageEscapes, now.packageEscapes)).toEqual([]);
  });

  it("gain no import of another module's file past its entry (M3)", () => {
    expect(added(known.deepImports, now.deepImports)).toEqual([]);
  });

  it("gain no use of another unit's table, imported or written in SQL (M5)", () => {
    expect(added(known.tableAccess, now.tableAccess)).toEqual([]);
  });

  it("list nothing that is gone: remove the entry with `npm run modularity`", () => {
    expect(added(now.packageDependencies, known.packageDependencies)).toEqual([]);
    expect(added(now.packageEscapes, known.packageEscapes)).toEqual([]);
    expect(added(now.deepImports, known.deepImports)).toEqual([]);
    expect(added(now.tableAccess, known.tableAccess)).toEqual([]);
    expect(added(now.crossModuleImports, known.crossModuleImports)).toEqual([]);
    expect(added(now.reciprocalUnits, known.reciprocalUnits)).toEqual([]);
    expect(added(now.forbiddenNames, known.forbiddenNames)).toEqual([]);
    expect(added(now.forbiddenNameKeys, known.forbiddenNameKeys)).toEqual([]);
    expect(now.counts).toEqual(known.counts);
  });
});

describe("the import graph reader", () => {
  it("names the unit of a file", () => {
    expect(unitOf("modules/accounts/ui/period.ts")).toBe("modules/accounts");
    expect(unitOf("platform/integrations/wallet/sync.ts")).toBe("platform/integrations/wallet");
    expect(unitOf("platform/integrations/service.ts")).toBe("platform/integrations");
    expect(unitOf("platform/dates.ts")).toBe("platform/dates");
    expect(unitOf("app/(app)/page.tsx")).toBe("app");
  });

  it("finds the units that import each other and the groups that form a cycle", () => {
    const graph = unitGraph([
      { from: "modules/a/service.ts", to: "modules/b/queries" },
      { from: "modules/b/queries.ts", to: "modules/a/rules" },
      { from: "modules/b/rules.ts", to: "modules/c/rules" },
      { from: "modules/c/rules.ts", to: "modules/d/rules" },
      { from: "modules/d/rules.ts", to: "modules/b/rules" },
      { from: "modules/e/rules.ts", to: "modules/a/rules" },
    ]);
    expect(reciprocalPairs(graph)).toEqual(["modules/a ↔ modules/b"]);
    expect(cycleGroups(graph)).toEqual([["modules/a", "modules/b", "modules/c", "modules/d"]]);
  });
});

/**
 * SEC-05 (docs/design/investments.md §5.1): the key of an investment provider is saved only by
 * `connectInvestmentProvider` and `replaceKey`, after the strict schema, the read-only check and a
 * test reading. Every other `saveConnection` call names a provider that is not in the catalog.
 */
describe("saving an investment key", () => {
  const CALL = /saveConnection\(\s*ctx,\s*\{\s*provider:\s*([A-Za-z_.]+)/g;
  const OTHERS = new Set(["WALLET_PROVIDER", "TREK_PROVIDER"]);
  const OWNER = "modules/investments/sync.ts";

  /** The tree, a file split in parts read as the one file it was (rule Q6, scripts/source-graph.ts). */
  function asFiles(): Map<string, string> {
    const joined = new Map<string, string>();
    for (const [rel, file] of TREE) {
      const one = asOneFile(TREE, rel);
      joined.set(one, (joined.get(one) ?? "") + readFileSync(file, "utf8"));
    }
    return joined;
  }

  function calls(): Map<string, string[]> {
    const found = new Map<string, string[]>();
    for (const [rel, content] of asFiles()) {
      if (rel === SELF || /\.(test|itest)\.tsx?$/.test(rel) || rel === "platform/integrations/service.ts")
        continue;
      const providers = [...content.matchAll(CALL)].map((match) => match[1]);
      if (content.includes("saveConnection(") || providers.length > 0) found.set(rel, providers);
    }
    return found;
  }

  it("happens only in the investments sync, twice: connecting and replacing the key", () => {
    const found = calls();
    expect(found.get(OWNER)).toEqual(["provider.id", "provider.id"]);
    const owner = asFiles().get(OWNER)!;
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
    const dockerfile = readFileSync(join(ROOT, "Dockerfile"), "utf8");
    const installs = dockerfile.split("\n").filter((line) => /\bnpm (ci|install|i)\b/.test(line));
    expect(installs).toEqual(["RUN npm ci --ignore-scripts"]);
  });
});

/**
 * The packages of the monorepo (rewrite plan R0, 10-modularity.md §10.2, §10.6): what has no known
 * list must hold for the whole tree.
 */
describe("the packages", () => {
  const measure = measurePackages(ROOT);

  it("import only what their package.json declares (M1)", () => {
    expect(measure.undeclared).toEqual([]);
  });

  it("keep the domain off Next.js, React and Hono, and the contracts on zod alone (M6)", () => {
    expect(measure.layers).toEqual([]);
  });

  it("form no cycle (M4)", () => {
    expect(measure.packageCycles).toEqual([]);
  });

  it("are reached by their entries only: the aliases of the tests stay in the tests (M3)", () => {
    expect(measure.aliases).toEqual([]);
  });

  it("give a client component the browser's entries only: no server code in a bundle", () => {
    expect(measure.clientReach).toEqual([]);
  });

  it("give a browser file nothing that reaches the database, through any chain of imports", () => {
    expect(measure.clientDatabase).toEqual([]);
  });

  it("give the web's container nothing of the server: no database, no key, no API (R4)", () => {
    expect(measure.webServerReach).toEqual([]);
  });

  it("export named names from every entry, no `export *` (M7)", () => {
    expect(measure.starExports).toEqual([]);
  });

  it("export what the reference file says, entry by entry (M7)", () => {
    const reference = JSON.parse(readFileSync(join(ROOT, "baselines/exports.json"), "utf8"));
    expect(entryExports(ROOT)).toEqual(reference);
  });

  it("give every module of the domain its entry (M7)", () => {
    const modules = readdirSync(join(ROOT, "packages/domain/src/modules"));
    expect(
      modules.filter((name) => !existsSync(join(ROOT, "packages/domain/src/modules", name, "index.ts"))),
    ).toEqual([]);
  });

  it("carry the version of the root: a release sets every package.json to the tag it deploys", () => {
    const root = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { version: string };
    const versions = workspaces(ROOT).map(
      (space) =>
        `${space.name} ${(JSON.parse(readFileSync(join(ROOT, space.folder, "package.json"), "utf8")) as { version: string }).version}`,
    );
    expect(versions).toEqual(workspaces(ROOT).map((space) => `${space.name} ${root.version}`));
  });

  it("declare a name once in a unit of the domain (Q4)", () => {
    expect(measure.duplicateNames).toEqual([]);
  });
});

describe("findClientDatabaseReach", () => {
  const spaces = [
    {
      name: "@ledgerly/domain",
      folder: "packages/domain",
      dependencies: ["pg"],
      exports: {
        "./accounts": "./src/modules/accounts/index.ts",
        "./accounts/client": "./src/modules/accounts/client.ts",
      },
    },
  ];
  // The chain that broke the image's build: a client form, a pure helper of the web app that
  // re-exports from the domain's server entry, the queries, the database client.
  const chain = (entry: string) =>
    new Map([
      ["apps/web/src/modules/accounts/ui/form.tsx", `"use client";\nimport { shareOf } from "./display";`],
      ["apps/web/src/modules/accounts/ui/display.ts", `export { shareOf } from "@ledgerly/domain/${entry}";`],
      [
        "packages/domain/src/modules/accounts/index.ts",
        `export { shareOf } from "./rules";\nexport { list } from "./queries";`,
      ],
      ["packages/domain/src/modules/accounts/client.ts", `export { shareOf } from "./rules";`],
      ["packages/domain/src/modules/accounts/rules.ts", `export const shareOf = 1;`],
      [
        "packages/domain/src/modules/accounts/queries/index.ts",
        `import { db } from "../../../platform/db/client";`,
      ],
      ["packages/domain/src/platform/db/client.ts", `import { Pool } from "pg";`],
    ]);

  it("finds a client file that reaches platform/db through a pure file in between", () => {
    expect(findClientDatabaseReach(chain("accounts"), spaces)).toEqual([
      "apps/web/src/modules/accounts/ui/form.tsx → packages/domain/src/platform/db/client.ts",
    ]);
  });

  it("stops at a Server Action: the bundle holds a reference, not its code", () => {
    const files = chain("accounts");
    files.set("apps/web/src/modules/accounts/ui/display.ts", `export { save } from "./actions";`);
    files.set(
      "apps/web/src/modules/accounts/ui/actions.ts",
      `"use server";\nexport { list } from "@ledgerly/domain/accounts";`,
    );
    expect(findClientDatabaseReach(files, spaces)).toEqual([]);
  });

  it("lets a client file read the domain's browser entry", () => {
    expect(findClientDatabaseReach(chain("accounts/client"), spaces)).toEqual([]);
  });

  it("finds a file of packages/ui or apps/static that imports pg, and ignores types", () => {
    const files = new Map([
      ["packages/ui/src/a.ts", `import { Pool } from "pg";`],
      ["apps/static/src/b.ts", `import type { Pool } from "pg";`],
    ]);
    expect(findClientDatabaseReach(files, spaces)).toEqual(["packages/ui/src/a.ts → packages/ui/src/a.ts"]);
  });
});

describe("findWebServerReach (R4)", () => {
  const spaces = [
    {
      name: "@ledgerly/domain",
      folder: "packages/domain",
      dependencies: ["pg"],
      exports: {
        "./accounts": "./src/modules/accounts/index.ts",
        "./accounts/client": "./src/modules/accounts/client.ts",
      },
    },
  ];
  const tree = (page: string) =>
    new Map([
      ["apps/web/src/app/(app)/accounts/page.tsx", page],
      ["apps/web/src/app/api/v1/route.ts", `import { list } from "@ledgerly/domain/accounts";`],
      ["apps/web/src/platform/helper.ts", `export { list } from "@ledgerly/domain/accounts";`],
      ["packages/domain/src/modules/accounts/index.ts", `export { list } from "./queries";`],
      ["packages/domain/src/modules/accounts/client.ts", `export const shareOf = 1;`],
      ["packages/domain/src/modules/accounts/queries.ts", `import { db } from "../../platform/db/client";`],
      ["packages/domain/src/platform/db/client.ts", `import { Pool } from "pg";`],
      ["packages/domain/src/platform/env.ts", `export const readEnv = () => process.env;`],
    ]);

  it("finds a page that reaches the database through a helper in between", () => {
    expect(findWebServerReach(tree(`import { list } from "@/platform/helper";`), spaces)).toEqual([
      "apps/web/src/app/(app)/accounts/page.tsx → packages/domain/src/platform/db/client.ts",
    ]);
  });

  it("finds a page that reads the server's environment, and one that names Better Auth's server", () => {
    const files = tree(`import { readEnv } from "@domain/platform/env";`);
    files.set("apps/web/src/app/(auth)/sign-in/page.tsx", `import { betterAuth } from "better-auth";`);
    expect(findWebServerReach(files, spaces)).toEqual([
      "apps/web/src/app/(app)/accounts/page.tsx → packages/domain/src/platform/env.ts",
      "apps/web/src/app/(auth)/sign-in/page.tsx → apps/web/src/app/(auth)/sign-in/page.tsx",
    ]);
  });

  it("leaves the server's routes and a page on the browser's entries alone", () => {
    const files = tree(
      `import { shareOf } from "@ledgerly/domain/accounts/client";\nimport type { X } from "@/platform/helper";`,
    );
    files.set("apps/web/src/proxy.ts", `import { getSessionCookie } from "better-auth/cookies";`);
    expect(findWebServerReach(files, spaces)).toEqual([]);
  });
});
