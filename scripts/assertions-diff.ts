// scripts/assertions-diff.ts — `npm run assertions-diff -- [<base>..<head>] [--all]`. Proof B1 of
// the rewrite plan (docs/design/rewrite-plan/10-modularity.md §10.10): a refactor leaves the
// existing tests as they are. In a refactor commit a test file may only move or change its
// `import` lines; any other changed line, and any deleted test file, stops the gate (G2).
//
// It reads the commits of the range (default `origin/main..HEAD`) whose subject is of type
// `refactor` — `--all` reads every commit, whatever its type — and compares each test file before
// and after the commit with its imports taken out. A new test file is not a difference. A change
// that a written decision asks for goes in `baselines/assertions-exceptions.json`, as
// `{ "file": …, "decision": "D4", "reason": … }`: nothing else is let through.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const TEST_FILE = /(?:\.(?:test|itest)\.tsx?|\.spec\.ts)$|^tests?\//;
const REFACTOR = /^refactor(?:\([^)]*\))?!?:/;
/** A whole `import … from "x";` statement, single-line or wrapped, at the start of a line. */
const IMPORT_STATEMENT = /^import\s[\s\S]*?["'];?[ \t]*$/gm;
/** The path of a dynamic import or of a mock: an import by another spelling. */
const IMPORTED_PATH = /\b(import|vi\.(?:mock|doMock|unmock|importActual))\(\s*["'][^"']+["']/g;

export interface Change {
  status: "modified" | "moved" | "deleted";
  file: string;
  lines: number;
}

/** A test file as what it asserts: without its imports, and without the paths of its mocks. */
export function withoutImports(text: string): string[] {
  return text
    .replace(IMPORT_STATEMENT, "")
    .replace(IMPORTED_PATH, (_, call: string) => `${call}("…"`)
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line !== "");
}

/** How many lines of the two versions have no twin in the other: 0 when only imports changed. */
export function changedLines(before: string, after: string): number {
  const left = new Map<string, number>();
  for (const line of withoutImports(before)) left.set(line, (left.get(line) ?? 0) + 1);
  let unmatched = 0;
  for (const line of withoutImports(after)) {
    const count = left.get(line) ?? 0;
    if (count === 0) unmatched += 1;
    else left.set(line, count - 1);
  }
  for (const count of left.values()) unmatched += count;
  return unmatched;
}

const git = (...args: string[]) =>
  execFileSync("git", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });

/** The test files a commit changed for more than their imports. */
export function changesOf(commit: string): Change[] {
  const changes: Change[] = [];
  const status = git("diff", "-M", "--name-status", "-z", `${commit}^`, commit).split("\0");
  for (let at = 0; at < status.length - 1;) {
    const code = status[at];
    const from = status[at + 1];
    const to = code.startsWith("R") || code.startsWith("C") ? status[at + 2] : from;
    at += code.startsWith("R") || code.startsWith("C") ? 3 : 2;
    if (!TEST_FILE.test(from) && !TEST_FILE.test(to)) continue;
    if (code === "A" || code.startsWith("C")) continue;
    if (code === "D") {
      changes.push({ status: "deleted", file: from, lines: 0 });
      continue;
    }
    const lines = changedLines(git("show", `${commit}^:${from}`), git("show", `${commit}:${to}`));
    if (lines > 0) changes.push({ status: code.startsWith("R") ? "moved" : "modified", file: to, lines });
  }
  return changes;
}

if (process.argv[1]?.endsWith("assertions-diff.ts")) {
  const all = process.argv.includes("--all");
  const range = process.argv.slice(2).find((argument) => argument.includes("..")) ?? "origin/main..HEAD";
  const exceptions = new Set(
    (JSON.parse(readFileSync("baselines/assertions-exceptions.json", "utf8")) as { file: string }[]).map(
      (entry) => entry.file,
    ),
  );
  const commits = git("rev-list", "--reverse", "--no-merges", range).split("\n").filter(Boolean);
  let read = 0;
  let found = 0;
  for (const commit of commits) {
    const subject = git("show", "-s", "--format=%s", commit).trim();
    if (!all && !REFACTOR.test(subject)) continue;
    read += 1;
    const changes = changesOf(commit).filter((change) => !exceptions.has(change.file));
    if (changes.length === 0) continue;
    found += changes.length;
    console.log(`${commit.slice(0, 7)} ${subject}`);
    for (const change of changes) {
      console.log(
        change.status === "deleted"
          ? `  deleted   ${change.file}`
          : `  ${change.status.padEnd(9)} ${change.file}: ${change.lines} lines changed besides imports`,
      );
    }
  }
  console.log(
    `${range}: ${commits.length} commits, ${read} read (${all ? "all" : "refactor only"}), ` +
      `${found} test files changed besides imports`,
  );
  process.exit(found > 0 ? 1 : 0);
}
