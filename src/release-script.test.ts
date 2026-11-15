import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// `scripts/release.sh` against commands that only take notes: `git`, `docker`, `npm` and `curl`
// are small scripts on the PATH that append their arguments to one log. What is tested is the
// order: nothing builds before the numbers snapshot "before" is on disk and equal to its checksum.

const SCRIPT = join(process.cwd(), "scripts/release.sh");
const INSTANT = "2031-03-04T05:06:07.000Z";

let work: string;
let log: string;

const FAKES: Record<string, string> = {
  git: `case "$1 $2" in
  "status --porcelain") ;;
  "rev-parse --short=7") echo abc1234 ;;
  "rev-parse HEAD" | "rev-parse origin/main") echo abc1234abc1234abc1234abc1234abc1234abc123 ;;
  *) ;;
esac`,
  docker: `echo "docker $*" >> "$FAKE_LOG"`,
  curl: `echo "curl" >> "$FAKE_LOG"; echo '{"status":"ok","db":"up"}'`,
  sleep: `:`,
  // npm [--prefix <dir>] run --silent numbers -- <folder> <label> … | … -- --diff <a> <b>
  npm: `echo "npm $*" >> "$FAKE_LOG"
[ "$1" = "--prefix" ] && shift 2
shift 4
if [ "$1" = "--diff" ]; then echo "$FAKE_DIFF"; [ "$FAKE_DIFF" = "uguale" ]; exit $?; fi
folder=$1; label=$2
mode=ok; [ "$label" = "before" ] && mode=$FAKE_BEFORE
case "$mode" in
  fails) echo "docker: invalid mount" >&2; exit 125 ;;
  silent) exit 0 ;;
esac
printf '{"users":{}}' > "$folder/numbers-$label.json"
(cd "$folder" && sha256sum "numbers-$label.json" > "numbers-$label.json.sha256")
[ "$mode" = "tampered" ] && printf 'x' >> "$folder/numbers-$label.json"
echo "numbers-$label.json: 1 users, as of ${INSTANT}, sha256 0"`,
};

function release(before: string, options: string[] = [], diff = "uguale") {
  const result = spawnSync("sh", [SCRIPT, "t1", "--no-dump", ...options], {
    encoding: "utf8",
    env: {
      NODE_ENV: "test",
      PATH: `${join(work, "bin")}:/usr/bin:/bin`,
      FAKE_LOG: log,
      FAKE_BEFORE: before,
      FAKE_DIFF: diff,
      LEDGERLY_DEPLOY_LOCK: join(work, "lock"),
      LEDGERLY_DUMPS_DIR: join(work, "dumps"),
      LEDGERLY_HEALTH_URL: "http://127.0.0.1:9/health",
    },
  });
  const calls = existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : [];
  return { ...result, calls };
}

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "ledgerly-release-"));
  log = join(work, "calls.log");
  mkdirSync(join(work, "bin"));
  for (const [name, body] of Object.entries(FAKES)) {
    const file = join(work, "bin", name);
    writeFileSync(file, `#!/bin/sh\n${body}\n`);
    chmodSync(file, 0o755);
  }
});

afterEach(() => rmSync(work, { recursive: true, force: true }));

const built = (calls: string[]) => calls.some((call) => call.startsWith("docker compose"));

describe("scripts/release.sh", () => {
  it('stops before the build when the snapshot "before" fails', () => {
    const run = release("fails");
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("STOPPED before the build");
    expect(run.stderr).toContain("invalid mount");
    expect(built(run.calls)).toBe(false);
  });

  it("stops before the build when the snapshot command succeeds and leaves no file", () => {
    const run = release("silent");
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("numbers-before.json is missing or empty");
    expect(built(run.calls)).toBe(false);
  });

  it("stops before the build when the snapshot does not match its checksum", () => {
    const run = release("tampered");
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("does not match its checksum");
    expect(built(run.calls)).toBe(false);
  });

  it("tags the image, takes the snapshot, builds, and reads the numbers again at the same instant", () => {
    const run = release("ok");
    expect(run.status).toBe(0);
    const at = (start: string) => run.calls.findIndex((call) => call.startsWith(start));
    expect(at("docker tag ledgerly:latest ledgerly:pre-t1")).toBeGreaterThanOrEqual(0);
    expect(at("docker tag")).toBeLessThan(at("npm"));
    expect(at("npm")).toBeLessThan(at("docker compose build ledgerly"));
    expect(at("docker compose build ledgerly")).toBeLessThan(at("docker compose up -d --wait ledgerly"));
    expect(run.calls.some((call) => call.includes(`after --as-of ${INSTANT}`))).toBe(true);
    expect(run.stdout).toContain("uguale");
  });

  it("tags, builds and starts a plugin with the app when asked", () => {
    const run = release("ok", ["--plugin", "enablebanking"]);
    expect(run.status).toBe(0);
    expect(run.calls).toContain(
      "docker tag ledgerly-plugin-enablebanking:latest ledgerly-plugin-enablebanking:pre-t1",
    );
    expect(run.calls).toContain("docker compose build ledgerly ledgerly-plugin-enablebanking");
    expect(run.calls).toContain("docker compose up -d --wait ledgerly ledgerly-plugin-enablebanking");
  });

  it("keeps no image for a service deployed for the first time, and goes on", () => {
    const docker = join(work, "bin", "docker");
    writeFileSync(
      docker,
      `#!/bin/sh\necho "docker $*" >> "$FAKE_LOG"\n[ "$1 $2" = "image inspect" ] && [ "$3" = "ledgerly-plugin-enablebanking:latest" ] && exit 1\nexit 0\n`,
    );
    chmodSync(docker, 0o755);
    const run = release("ok", ["--plugin", "enablebanking"]);
    expect(run.status).toBe(0);
    expect(run.calls).toContain("docker tag ledgerly:latest ledgerly:pre-t1");
    expect(run.calls.some((call) => call.startsWith("docker tag ledgerly-plugin-enablebanking"))).toBe(false);
    expect(run.stdout).toContain("no image ledgerly-plugin-enablebanking:latest yet");
    expect(run.calls).toContain("docker compose up -d --wait ledgerly ledgerly-plugin-enablebanking");
  });

  it("refuses a plugin id that is not one", () => {
    const run = release("ok", ["--plugin", "../x"]);
    expect(run.status).toBe(1);
    expect(built(run.calls)).toBe(false);
  });

  it('reads the snapshot "before" with the code of another checkout when asked', () => {
    const run = release("ok", ["--before-from", work]);
    expect(run.status).toBe(0);
    expect(run.calls.find((call) => call.includes(" before"))).toContain(`--prefix ${work} `);
    expect(run.calls.find((call) => call.includes(" after "))).not.toContain(`--prefix ${work} `);
  });

  it("ends with status 2, deployed, when the numbers differ", () => {
    const run = release("ok", [], "1 differenze:");
    expect(run.status).toBe(2);
    expect(run.stdout).toContain("deployed");
    expect(built(run.calls)).toBe(true);
  });
});
