// scripts/test-select.ts — `npm run test:select -- [<base>..<head>] [--files <file> …] [--doc]`.
//
// Reads a diff with the map of `scripts/test-map.ts` and prints the tests it starts, as commands
// (docs/testing.md). The default range is the release diff: the highest tag `vX.Y.Z` to `HEAD`.
// For the work before a push: `npm run test:select -- origin/main...HEAD`. `--files` reads a list
// instead of a diff; `--doc` prints the two tables of docs/testing.md.
import { execFileSync } from "node:child_process";
import {
  CRITICAL,
  CROSS_CUTTING,
  FLOWS,
  MODULES,
  NESTED_MESSAGES,
  type Selection,
  SIGN_INS,
  SITE_ONLY,
  select,
} from "./test-map";

const PREVIEW = "npx playwright test -c playwright.preview.config.ts";
const INTEGRATION = "sh scripts/test-integration.sh";
export const ALWAYS = "npm run format:check && npm run lint && npm run typecheck && npm test";

const quote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;
const flow = (id: string) => FLOWS.find((one) => one.id === id)!;

/** A spec of a flow, as `<flow>/<name>`: what `SITE_ONLY` names, and what a command filters on. */
const specsOf = (id: string, withScreens: boolean) =>
  [...flow(id).specs, ...(withScreens ? (flow(id).screens ?? []) : [])].map((spec) => `${id}/${spec}`);
const file = (spec: string) => `${spec}.spec.ts`;

/**
 * The `@site` tests of some specs (`<flow>/<name>`), as commands that stay under the site's limit
 * of password sign-ins, with a minute between two of them. They run at the site's origin, as `@smoke`
 * does: through Cloudflare they hit its rate limit (429).
 */
export function siteCommands(specs: readonly string[]): string[] {
  const groups: string[][] = [[]];
  let spent = 0;
  for (const spec of Object.keys(SITE_ONLY).filter((one) => specs.includes(one))) {
    if (spent + SITE_ONLY[spec] > SIGN_INS) {
      groups.push([]);
      spent = 0;
    }
    groups.at(-1)!.push(spec);
    spent += SITE_ONLY[spec];
  }
  return groups
    .filter((group) => group.length > 0)
    .flatMap((group, at) => [
      ...(at > 0 ? ["sleep 60"] : []),
      `E2E_ORIGIN=127.0.0.1 npx playwright test ${group.map(file).join(" ")} -g @site`,
    ]);
}

/** The commands of a selection, in the order they run. */
export function commands(selection: Selection): { before: string[]; after: string[] } {
  if (selection.full.length > 0) {
    return {
      before: [ALWAYS, INTEGRATION, "npm run perf", PREVIEW],
      after: ["npx playwright test -g @smoke", ...siteCommands(Object.keys(SITE_ONLY))],
    };
  }
  const before = [ALWAYS];
  if (selection.integration === "*") before.push(INTEGRATION);
  else if (selection.integration.length > 0) {
    before.push(`${INTEGRATION} ${selection.integration.map(quote).join(" ")}`);
  }
  before.push(selection.perf ? "npm run perf" : "npm run perf -- --queries");
  // A changed module's own flows run their whole folder; the flows of the modules that use it run
  // their journeys alone.
  const flows = selection.flows.filter((id) => id !== "screens");
  const whole = flows.filter((id) => selection.screens.includes(id));
  const journeys = flows.filter((id) => !selection.screens.includes(id));
  const run = [
    ...whole.map((id) => `tests/e2e/${id}/`),
    ...journeys.flatMap((id) => specsOf(id, false).map(file)),
  ];
  if (run.length > 0) before.push(`${PREVIEW} ${run.join(" ")}`);
  const every = selection.flows.includes("screens");
  if (every) before.push(`${PREVIEW} ${CROSS_CUTTING.map(file).join(" ")}`);
  before.push(`${PREVIEW} -g @smoke`);
  const ran = [
    ...whole.flatMap((id) => specsOf(id, true)),
    ...journeys.flatMap((id) => specsOf(id, false)),
    ...(every ? FLOWS.flatMap((one) => (one.screens ?? []).map((spec) => `${one.id}/${spec}`)) : []),
  ];
  return { before, after: ["npx playwright test -g @smoke", ...siteCommands(ran)] };
}

// ——— The tables of docs/testing.md ————————————————————————————————————————————————————————————

const code = (text: string) => `\`${text.replaceAll("|", "\\|")}\``;
const list = (items: readonly string[]) => items.map(code).join(", ");

export function mapTable(): string {
  const rows = MODULES.map((module) => {
    const run: string[] = [];
    if (module.integration) run.push(code(`${INTEGRATION} ${module.integration.map(quote).join(" ")}`));
    for (const id of module.flows ?? []) run.push(`flow ${code(id)}`);
    const usedBy = (module.usedBy ?? []).map((user) =>
      user === "integration:*"
        ? "every integration test"
        : user === "perf"
          ? code("npm run perf")
          : code(user),
    );
    return `| ${list(module.files)} | ${code(module.id)} | ${run.join("<br>") || "—"} | ${usedBy.join(", ") || "—"} |`;
  });
  return ["| Changed files | Module | Command | Used by |", "|---|---|---|---|", ...rows].join("\n");
}

export function flowTable(): string {
  const rows = FLOWS.map((one) => {
    const folder =
      one.id === "screens"
        ? `${PREVIEW} ${CROSS_CUTTING.map(file).join(" ")}`
        : `${PREVIEW} tests/e2e/${one.id}/`;
    const journeys =
      one.specs.length > 0 ? code(`${PREVIEW} ${specsOf(one.id, false).map(file).join(" ")}`) : "—";
    return `| ${code(one.id)} | ${code(folder)} | ${journeys} |`;
  });
  return [
    "| Flow | The whole flow: its folder | Its journeys alone (a module that uses it changed) |",
    "|---|---|---|",
    ...rows,
  ].join("\n");
}

export function criticalTable(): string {
  const rows = CRITICAL.map((group) => `| ${list(group.files)} | ${group.why} |`);
  return ["| Files | Why |", "|---|---|", ...rows].join("\n");
}

// ——— The diff ————————————————————————————————————————————————————————————————————————————————

const git = (...args: string[]) =>
  execFileSync("git", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }).trim();

function show(revision: string, file: string): unknown {
  try {
    return JSON.parse(git("show", `${revision}:${file}`));
  } catch {
    return null;
  }
}

type Messages = Record<string, unknown>;
const differing = (before: Messages, after: Messages) =>
  [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
    (key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]),
  );

/** The namespaces of a messages file that differ between two revisions (`settings`: one level down). */
function changedKeys(base: string, head: string, file: string): string[] {
  const before = (show(base, file) ?? {}) as Messages;
  const after = (show(head, file) ?? {}) as Messages;
  return differing(before, after).flatMap((key) =>
    NESTED_MESSAGES.includes(key)
      ? differing((before[key] ?? {}) as Messages, (after[key] ?? {}) as Messages).map(
          (sub) => `${key}.${sub}`,
        )
      : [key],
  );
}

/** A `package.json` (the root's or a workspace's) or the lockfile, when the version number is all that changed. */
function versionOnly(base: string, head: string, file: string): boolean {
  const without = (revision: string) => {
    const json = show(revision, file) as {
      version?: string;
      packages?: Record<string, { version?: string }>;
    };
    if (json === null) return null;
    delete json.version;
    // The lockfile holds the version of the root and of every workspace (R0): a release sets them all.
    for (const entry of Object.values(json.packages ?? {})) {
      if (!("resolved" in entry)) delete entry.version;
    }
    return JSON.stringify(json);
  };
  const before = without(base);
  return before !== null && before === without(head);
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.includes("--doc")) {
    console.log(`${mapTable()}\n\n${flowTable()}\n\n${criticalTable()}`);
    return;
  }
  let files: string[];
  let diff: Parameters<typeof select>[1] = {};
  let title: string;
  const at = args.indexOf("--files");
  if (at >= 0) {
    files = args.slice(at + 1);
    title = `${files.length} files`;
  } else {
    const previous = git("tag", "--list", "v*", "--sort=-v:refname")
      .split("\n")
      .find((tag) => /^v\d+\.\d+\.\d+$/.test(tag));
    const range = args.find((one) => one.includes("..")) ?? `${previous}..HEAD`;
    const [base, head] = range.split(/\.{2,3}/);
    files = git("diff", "--name-only", range).split("\n").filter(Boolean);
    diff = {
      messages: [
        ...new Set(
          files.filter((file) => /^messages\//.test(file)).flatMap((file) => changedKeys(base, head, file)),
        ),
      ],
      versionOnly: files
        .filter((file) => /(^|\/)package(-lock)?\.json$/.test(file))
        .filter((file) => files.includes(file) && versionOnly(base, head, file)),
    };
    title = `${range}, ${files.length} files`;
  }

  const selection = select(files, diff);
  console.log(`Tests of ${title}`);
  if (selection.full.length > 0) {
    console.log(`\nFULL SUITE, for ${selection.full.length} files:`);
    for (const reason of selection.full) console.log(`  ${reason}`);
  } else {
    console.log("\nFull suite: no, every file is in the map and none is critical.");
    console.log("\nModules:");
    for (const [id, changed] of selection.modules) console.log(`  ${id} (${changed.length} files)`);
    console.log(`Flows: ${selection.flows.join(", ") || "none"}`);
    console.log(`Screens in ${CROSS_CUTTING.join(", ")}: ${selection.screens.join(", ") || "none"}`);
  }
  const { before, after } = commands(selection);
  console.log("\nBefore the deploy (E2E on the local preview):");
  for (const command of before) console.log(`  ${command}`);
  console.log("\nAfter the deploy, on the site:");
  for (const command of after) console.log(`  ${command}`);
}

if (process.argv[1]?.endsWith("test-select.ts")) main();
