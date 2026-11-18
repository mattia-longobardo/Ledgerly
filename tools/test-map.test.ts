import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { importEdges, treeFiles } from "../scripts/source-graph";
import {
  CROSS_CUTTING,
  FLOWS,
  MODULES,
  SITE_ONLY,
  criticalOf,
  matches,
  modulesOf,
  select,
} from "../scripts/test-map";
import { commands, criticalTable, flowTable, mapTable, siteCommands } from "../scripts/test-select";

// The map of docs/testing.md against the tree (`test-policy` §4): a file that is in no row, a test
// that no command starts and a module that is missing from a "Used by" are found here, not at a
// release.

const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8" }).trim().split("\n");
const ids = new Set(MODULES.map((module) => module.id));
const flowIds = new Set(FLOWS.map((flow) => flow.id));
/** Rows that add tests to a file of another row: the file's own tests are the other row's. */
const CROSS_ROWS = ["data", "queries", "shared-domain"];

describe("the map covers the repository", () => {
  it("every file is in a row of the map or in the critical list", () => {
    const outside = tracked.filter(
      (file) => !/^messages\/[^/]+\.json$/.test(file) && !criticalOf(file) && modulesOf(file).length === 0,
    );
    expect(outside).toEqual([]);
  });

  it("every pattern names a file that exists", () => {
    const dead = [...MODULES.flatMap((module) => module.files)].filter(
      (pattern) => !tracked.some((file) => matches(pattern, file)),
    );
    expect(dead).toEqual([]);
  });

  it("every integration test is started by the command of a module", () => {
    const paths = MODULES.flatMap((module) => module.integration ?? []);
    for (const path of paths) expect(existsSync(path), path).toBe(true);
    const orphans = tracked
      .filter((file) => file.endsWith(".itest.ts") && !criticalOf(file))
      .filter((file) => !paths.some((path) => file === path || file.startsWith(`${path}/`)));
    expect(orphans).toEqual([]);
  });

  it("every spec is in the folder of one flow, and the flows of the map exist", () => {
    const specs = tracked.flatMap((file) => /^tests\/e2e\/(.+)\.spec\.ts$/.exec(file)?.[1] ?? []);
    const listed = FLOWS.flatMap((flow) =>
      [...flow.specs, ...(flow.screens ?? [])].map((spec) => `${flow.id}/${spec}`),
    );
    expect(specs.sort()).toEqual(listed.sort());
    for (const flow of FLOWS) {
      for (const spec of flow.screens ?? []) expect(CROSS_CUTTING, `${flow.id}/${spec}`).toContain(spec);
      for (const spec of flow.specs) expect(CROSS_CUTTING, `${flow.id}/${spec}`).not.toContain(spec);
    }
    for (const row of MODULES) {
      for (const flow of row.flows ?? []) expect(flowIds.has(flow), `${row.id}: ${flow}`).toBe(true);
      for (const user of row.usedBy ?? []) {
        const known =
          ["integration:*", "e2e:*", "perf"].includes(user) ||
          (user.startsWith("e2e:") ? flowIds.has(user.slice(4)) : ids.has(user));
        expect(known, `${row.id}: ${user}`).toBe(true);
      }
    }
  });

  it("the folder of a flow holds its specs only, and what they share is in _shared", () => {
    const loose = tracked.filter(
      (file) =>
        file.startsWith("tests/e2e/") &&
        !file.startsWith("tests/e2e/_shared/") &&
        !/^tests\/e2e\/[^/]+\/[^/]+\.spec\.ts$/.test(file),
    );
    expect(loose).toEqual([]);
  });

  it("the specs with a test for the site only are the ones the map names", () => {
    const tagged = tracked
      .filter(
        (file) => /^tests\/e2e\/.+\.spec\.ts$/.test(file) && readFileSync(file, "utf8").includes("@site"),
      )
      .map((file) => file.slice("tests/e2e/".length, -".spec.ts".length));
    expect(tagged.sort()).toEqual(Object.keys(SITE_ONLY).sort());
  });
});

describe("Used by", () => {
  // A file that imports another one is tested when the other one changes: its integration tests
  // when it is code a server runs, its flows when it is a page or a component.
  it("the tests of every file that imports a changed file are selected", () => {
    // The one source tree of every package (R0), and where each of its files is on disk.
    const tree = treeFiles(".");
    const sources = new Map([...tree].map(([rel, path]) => [rel, readFileSync(path, "utf8")]));
    const fileOf = (target: string) =>
      ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]
        .map((end) => target + end)
        .find((one) => sources.has(one));
    const missing = new Set<string>();
    const selections = new Map<string, ReturnType<typeof select>>();
    for (const edge of importEdges(sources)) {
      const target = fileOf(edge.to);
      if (target === undefined) continue;
      const to = tree.get(target)!;
      // A file split in parts is read as one file (Q6): its `index.ts` stands for it.
      const from = tree.get(edge.from) ?? tree.get(edge.from.replace(/\.tsx?$/, "/index.ts"))!;
      if (!selections.has(to)) selections.set(to, select([to]));
      const selection = selections.get(to)!;
      // Critical code runs everything; the common interface is measured on every screen.
      if (selection.full.length > 0 || selection.flows.includes("screens")) continue;
      const page = from.endsWith(".tsx") || from.startsWith("apps/web/src/app/");
      for (const importer of modulesOf(from).filter((row) => !CROSS_ROWS.includes(row.id))) {
        if (!page || from.endsWith(".ts")) {
          for (const path of importer.integration ?? []) {
            if (selection.integration !== "*" && !selection.integration.includes(path)) {
              missing.add(`${modulesOf(to).map((row) => row.id)} is used by ${importer.id} (integration)`);
            }
          }
        }
        if (page) {
          for (const flow of importer.flows ?? []) {
            if (!selection.flows.includes(flow)) {
              missing.add(`${modulesOf(to).map((row) => row.id)} is used by e2e:${flow} (${importer.id})`);
            }
          }
        }
      }
    }
    expect([...missing].sort()).toEqual([]);
  });
});

describe("the selection", () => {
  it("a file outside the map and a critical file start the full suite", () => {
    expect(select(["somewhere/new.ts"]).full).toEqual(["somewhere/new.ts: outside the map"]);
    expect(select(["packages/domain/src/platform/auth/auth.ts"]).full).toHaveLength(1);
    expect(select(["package.json"]).full).toHaveLength(1);
    expect(commands(select(["package.json"])).before).toContain("sh scripts/test-integration.sh");
  });

  it("the version number alone starts nothing", () => {
    const files = ["package.json", "package-lock.json", "docs/RELEASE.md"];
    const selection = select(files, { versionOnly: ["package.json", "package-lock.json"] });
    expect(selection.full).toEqual([]);
    expect(commands(selection).before.join("\n")).not.toContain("test-integration");
  });

  it("a message starts the module that shows it, and an unknown one everything", () => {
    expect(select(["messages/en.json"]).full).toHaveLength(1);
    expect(select(["messages/en.json"], { messages: ["timeoff"] }).screens).toEqual(["timeoff"]);
    // A source's categories are on the source's page too (rewrite plan N7.2).
    // ... and the page of the categories in Expenses calls its actions (N3.2, N3.3).
    expect(select(["messages/en.json"], { messages: ["settings.categories"] }).flows).toEqual([
      "transactions",
      "categories",
      "connections",
    ]);
    expect(select(["messages/en.json"], { messages: ["new-namespace"] }).full).toHaveLength(1);
  });

  it("one module: its tests, the tests of who uses it, and its own screens only", () => {
    const selection = select(["packages/domain/src/modules/timeoff/rules.ts", "docs/features.md"]);
    expect(selection.full).toEqual([]);
    expect(selection.integration).toContain("packages/domain/src/modules/timeoff");
    expect(selection.integration).not.toContain("packages/domain/src/modules/funds");
    expect(selection.flows).toEqual(["timeoff", "connections"]);
    expect(selection.screens).toEqual(["timeoff"]);
    expect(selection.perf).toBe(false);
  });

  it("a migration starts every integration test and the times", () => {
    const selection = select(["drizzle/0099_new.sql"]);
    expect(selection.integration).toBe("*");
    expect(selection.perf).toBe(true);
    expect(selection.flows).toEqual([]);
  });

  it("the common interface and the engines of the checks start every screen", () => {
    for (const file of ["apps/web/src/ui/modal.tsx", "tests/e2e/_shared/a11y.ts"]) {
      const selection = select([file]);
      expect(selection.flows, file).toContain("screens");
      expect(commands(selection).before, file).toContain(
        "npx playwright test -c playwright.preview.config.ts a11y.spec.ts keyboard.spec.ts mobile.spec.ts",
      );
    }
  });

  it("a changed spec starts the folder of its flow, and nothing else", () => {
    const selection = select(["tests/e2e/pockets/a11y.spec.ts"]);
    expect(selection.flows).toEqual(["pockets"]);
    expect(commands(selection).before).toContain(
      "npx playwright test -c playwright.preview.config.ts tests/e2e/pockets/",
    );
  });

  it("a module runs the folder of its flow, and the journeys alone of the flows that use it", () => {
    const { before } = commands(select(["packages/domain/src/modules/timeoff/rules.ts"]));
    expect(before).toContain(
      "npx playwright test -c playwright.preview.config.ts tests/e2e/timeoff/ " +
        "connections/connections.spec.ts connections/plugins.spec.ts connections/schedule.spec.ts",
    );
  });

  it("the tests for the site stay under the limit of password sign-ins", () => {
    // Two failed on the site when one command spent six sign-ins in forty seconds.
    expect(siteCommands(Object.keys(SITE_ONLY))).toEqual([
      "npx playwright test auth/auth.spec.ts auth/two-factor.spec.ts -g @site",
      "sleep 60",
      "npx playwright test auth/preferences.spec.ts shell/mobile.spec.ts api/security.spec.ts " +
        "api/mcp.spec.ts accounts/currency.spec.ts investments/investments-service.spec.ts " +
        "connections/plugins.spec.ts -g @site",
    ]);
    expect(siteCommands(["connections/plugins", "auth/auth", "transactions/expenses"])).toEqual([
      "npx playwright test auth/auth.spec.ts connections/plugins.spec.ts -g @site",
    ]);
    expect(siteCommands(["transactions/expenses"])).toEqual([]);
  });

  it("docs alone start nothing but the checks that always run", () => {
    const { before, after } = commands(select(["docs/features.md", "README.md"]));
    expect(before).toHaveLength(3);
    expect(before[1]).toBe("npm run perf -- --queries");
    expect(after).toEqual(["npx playwright test -g @smoke"]);
  });
});

describe("docs/testing.md", () => {
  it("has the tables of the map as the script prints them (`npm run test:select -- --doc`)", () => {
    const text = readFileSync("docs/testing.md", "utf8");
    expect(text).toContain(mapTable());
    expect(text).toContain(flowTable());
    expect(text).toContain(criticalTable());
  });
});
