import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { importEdges } from "../scripts/source-graph";
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
import { commands, criticalTable, flowTable, mapTable } from "../scripts/test-select";

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

  it("every spec is in one flow, and the flows of the map exist", () => {
    const specs = tracked.flatMap((file) => /^tests\/e2e\/(.+)\.spec\.ts$/.exec(file)?.[1] ?? []);
    for (const spec of specs) {
      expect(FLOWS.filter((flow) => flow.specs.includes(spec)).length, spec).toBe(1);
    }
    for (const flow of FLOWS) for (const spec of flow.specs) expect(specs, flow.id).toContain(spec);
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

  it("the specs with a test for the site only are the ones the map names", () => {
    const tagged = tracked
      .filter(
        (file) => /^tests\/e2e\/.+\.spec\.ts$/.test(file) && readFileSync(file, "utf8").includes("@site"),
      )
      .map((file) => file.slice("tests/e2e/".length, -".spec.ts".length));
    expect(tagged.sort()).toEqual([...SITE_ONLY].sort());
  });
});

describe("Used by", () => {
  // A file that imports another one is tested when the other one changes: its integration tests
  // when it is code a server runs, its flows when it is a page or a component.
  it("the tests of every file that imports a changed file are selected", () => {
    const sources = new Map(
      tracked
        .filter((file) => /^src\/.+\.tsx?$/.test(file))
        .map((file) => [file.slice(4), readFileSync(file, "utf8")]),
    );
    const fileOf = (target: string) =>
      ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]
        .map((end) => target + end)
        .find((one) => sources.has(one));
    const missing = new Set<string>();
    const selections = new Map<string, ReturnType<typeof select>>();
    for (const edge of importEdges(sources)) {
      const target = fileOf(edge.to);
      if (target === undefined) continue;
      const to = `src/${target}`;
      const from = `src/${edge.from}`;
      if (!selections.has(to)) selections.set(to, select([to]));
      const selection = selections.get(to)!;
      // Critical code runs everything; the common interface is measured on every screen.
      if (selection.full.length > 0 || selection.flows.includes("screens")) continue;
      const page = from.endsWith(".tsx") || from.startsWith("src/app/");
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

describe("the screens of a flow", () => {
  // The titles Playwright matches `-g` against, read once from the suite itself.
  const listed = JSON.parse(
    execFileSync(
      "npx",
      [
        "playwright",
        "test",
        "-c",
        "playwright.preview.config.ts",
        "--list",
        "--reporter=json",
        ...CROSS_CUTTING,
      ],
      {
        encoding: "utf8",
        env: { ...process.env, E2E_BASE_URL: "http://localhost:3999" },
        maxBuffer: 64 * 1024 * 1024,
      },
    ),
  ) as { suites: Suite[] };
  interface Suite {
    title: string;
    suites?: Suite[];
    specs?: { title: string; tags: string[]; tests: { projectName: string }[] }[];
  }
  const titles: string[] = [];
  const walk = (suite: Suite, path: string[]) => {
    for (const spec of suite.specs ?? []) {
      titles.push([spec.tests[0].projectName, ...path, suite.title, spec.title].join(" "));
    }
    for (const child of suite.suites ?? []) walk(child, [...path, suite.title]);
  };
  for (const suite of listed.suites) walk(suite, []);

  it("every filter finds a screen", () => {
    expect(titles.length).toBeGreaterThan(400);
    for (const flow of FLOWS) {
      if (flow.screens === undefined) continue;
      expect(
        titles.some((title) => new RegExp(flow.screens!).test(title)),
        flow.id,
      ).toBe(true);
    }
  });

  it("every screen of the cross-cutting specs belongs to a flow", () => {
    const filters = FLOWS.flatMap((flow) => (flow.screens ? [new RegExp(flow.screens)] : []));
    expect(titles.filter((title) => !filters.some((filter) => filter.test(title)))).toEqual([]);
  });
});

describe("the selection", () => {
  it("a file outside the map and a critical file start the full suite", () => {
    expect(select(["somewhere/new.ts"]).full).toEqual(["somewhere/new.ts: outside the map"]);
    expect(select(["src/platform/auth/auth.ts"]).full).toHaveLength(1);
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
    expect(select(["messages/en.json"], { messages: ["settings.categories"] }).flows).toEqual(["categories"]);
    expect(select(["messages/en.json"], { messages: ["new-namespace"] }).full).toHaveLength(1);
  });

  it("one module: its tests, the tests of who uses it, and its own screens only", () => {
    const selection = select(["src/modules/timeoff/rules.ts", "docs/features.md"]);
    expect(selection.full).toEqual([]);
    expect(selection.integration).toContain("src/modules/timeoff");
    expect(selection.integration).not.toContain("src/modules/funds");
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

  it("the common interface starts every screen", () => {
    const selection = select(["src/ui/modal.tsx"]);
    expect(selection.flows).toContain("screens");
    expect(commands(selection).before.join("\n")).toContain(CROSS_CUTTING.join(" "));
  });

  it("a cross-cutting spec runs whole only when no module changed with it", () => {
    expect(select(["tests/e2e/a11y.spec.ts"]).flows).toEqual(["screens"]);
    const withModule = select(["tests/e2e/a11y.spec.ts", "src/modules/pockets/service.ts"]);
    expect(withModule.flows).not.toContain("screens");
    expect(withModule.screens).toEqual(["pockets"]);
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
