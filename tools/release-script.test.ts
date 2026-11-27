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
  // `docker inspect --format '{{.Image}}' <container>` answers the image the container runs.
  // `docker images` answers `$FAKE_IMAGES` ("<created>|<ref>" lines), with or without the date.
  docker: `echo "docker $*" >> "$FAKE_LOG"; [ "$1" = "inspect" ] && echo "sha256:run-$4"
if [ "$1" = "images" ]; then
  case "$3" in *CreatedAt*) printf '%s\\n' $FAKE_IMAGES ;; *) printf '%s\\n' $FAKE_IMAGES | cut -d'|' -f2 ;; esac
fi
exit 0`,
  curl: `echo "curl" >> "$FAKE_LOG"; echo '{"status":"ok","db":"up"}'`,
  sleep: `:`,
  // The browser check before the build, and `npx playwright test --grep @smoke` after it.
  node: `[ "$FAKE_BROWSER" = "missing" ] && exit 1; exit 0`,
  npx: `echo "npx $*" >> "$FAKE_LOG"; [ "$FAKE_SMOKE" != "red" ]`,
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

function release(
  before: string,
  options: string[] = [],
  diff = "uguale",
  extra: Record<string, string> = {},
) {
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
      ...extra,
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

  // A `docker` that answers `image inspect --format …` of the preview with the commit it was built from.
  function previewOf(revision: string): void {
    const docker = join(work, "bin", "docker");
    writeFileSync(
      docker,
      `#!/bin/sh\necho "docker $*" >> "$FAKE_LOG"\n[ "$1 $2 $3" = "image inspect --format" ] && echo "${revision}"\n[ "$1" = "inspect" ] && echo "sha256:run-$4"\nexit 0\n`,
    );
    chmodSync(docker, 0o755);
  }

  it("starts the image of the preview, and builds only the interface, when it was built from the same commit", () => {
    previewOf("abc1234abc1234abc1234abc1234abc1234abc123");
    const run = release("ok");
    expect(run.status).toBe(0);
    const at = (start: string) => run.calls.findIndex((call) => call.startsWith(start));
    // The way back is kept before the tag `latest` moves to the preview's image.
    expect(at("docker tag ledgerly:latest ledgerly:pre-t1")).toBeGreaterThanOrEqual(0);
    expect(at("docker tag ledgerly:latest ledgerly:pre-t1")).toBeLessThan(
      at("docker tag ledgerly:preview ledgerly:latest"),
    );
    expect(at("npm")).toBeLessThan(at("docker tag ledgerly:preview ledgerly:latest"));
    expect(run.calls.filter((call) => call.startsWith("docker compose build"))).toEqual([
      "docker compose build ledgerly-web",
    ]);
    expect(at("docker tag ledgerly:preview ledgerly:latest")).toBeLessThan(
      at("docker compose up -d --wait ledgerly"),
    );
    expect(run.stdout).toContain("not built again");
  });

  it("builds the application when the image of the preview is of another commit", () => {
    previewOf("fffffffffffffffffffffffffffffffffffffff0");
    const run = release("ok");
    expect(run.status).toBe(0);
    expect(run.calls).toContain("docker compose build ledgerly ledgerly-web");
    expect(run.calls.some((call) => call.startsWith("docker tag ledgerly:preview"))).toBe(false);
  });

  it("with the image of the preview, still builds the other services of the release", () => {
    previewOf("abc1234abc1234abc1234abc1234abc1234abc123");
    const run = release("ok", ["--plugin", "enablebanking"]);
    expect(run.status).toBe(0);
    expect(run.calls).toContain("docker compose build ledgerly-web ledgerly-plugin-enablebanking");
    expect(run.calls).toContain(
      "docker compose up -d --wait ledgerly ledgerly-web ledgerly-plugin-enablebanking",
    );
  });

  it("tags, builds and starts a plugin with the app when asked", () => {
    const run = release("ok", ["--plugin", "enablebanking"]);
    expect(run.status).toBe(0);
    expect(run.calls).toContain(
      "docker tag ledgerly-plugin-enablebanking:latest ledgerly-plugin-enablebanking:pre-t1",
    );
    expect(run.calls).toContain("docker compose build ledgerly ledgerly-web ledgerly-plugin-enablebanking");
    expect(run.calls).toContain(
      "docker compose up -d --wait ledgerly ledgerly-web ledgerly-plugin-enablebanking",
    );
  });

  it("after the start, tags the image each container runs as latest", () => {
    const run = release("ok", ["--plugin", "enablebanking"]);
    expect(run.status).toBe(0);
    const at = (call: string) => run.calls.indexOf(call);
    const tag = "docker tag sha256:run-ledgerly-plugin-enablebanking ledgerly-plugin-enablebanking:latest";
    expect(at(tag)).toBeGreaterThan(
      at("docker compose up -d --wait ledgerly ledgerly-web ledgerly-plugin-enablebanking"),
    );
    expect(run.calls).toContain("docker tag sha256:run-ledgerly ledgerly:latest");
  });

  it("keeps no image for a service deployed for the first time, and goes on", () => {
    const docker = join(work, "bin", "docker");
    writeFileSync(
      docker,
      `#!/bin/sh\necho "docker $*" >> "$FAKE_LOG"\n[ "$1 $2" = "image inspect" ] && [ "$3" = "ledgerly-plugin-enablebanking:latest" ] && exit 1\n[ "$1" = "inspect" ] && echo "sha256:run-$4"\nexit 0\n`,
    );
    chmodSync(docker, 0o755);
    const run = release("ok", ["--plugin", "enablebanking"]);
    expect(run.status).toBe(0);
    expect(run.calls).toContain("docker tag ledgerly:latest ledgerly:pre-t1");
    expect(run.calls.some((call) => call.startsWith("docker tag ledgerly-plugin-enablebanking"))).toBe(false);
    expect(run.stdout).toContain("no image ledgerly-plugin-enablebanking:latest yet");
    expect(run.calls).toContain(
      "docker compose up -d --wait ledgerly ledgerly-web ledgerly-plugin-enablebanking",
    );
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

  it("stops before the build when the browser of the smoke tests does not start", () => {
    const run = release("ok", [], "uguale", { FAKE_BROWSER: "missing" });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("STOPPED before the build");
    expect(built(run.calls)).toBe(false);
  });

  it("runs the smoke tests on the site after the numbers, and nothing else of the suite", () => {
    const run = release("ok");
    const smoke = run.calls.indexOf("npx playwright test --grep @smoke");
    expect(smoke).toBeGreaterThan(run.calls.findIndex((call) => call.includes(" after ")));
    expect(run.calls.filter((call) => call.startsWith("npx"))).toHaveLength(1);
  });

  it("fails, with the way back, when a smoke test is red", () => {
    const run = release("ok", [], "uguale", { FAKE_SMOKE: "red" });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("FAILED after the build started: the @smoke tests are red on the site");
    expect(run.stderr).toContain("Rollback: docker tag ledgerly:pre-t1 ledgerly:latest");
    expect(run.stdout).not.toContain("deployed");
  });

  it("after the plugins, removes the pre-* images of the releases older than the last 5", () => {
    const releases = ["r1", "r2", "r3", "r4", "r5", "r6", "r7"];
    const images = releases.flatMap((id, day) => [
      `2031-01-0${day + 1}T10:00|ledgerly:pre-${id}`,
      `2031-01-0${day + 1}T09:00|ledgerly-web:pre-${id}`,
    ]);
    // An old image tagged again by a newer release dates that release by its newest image.
    images.push("2030-12-01T00:00|ledgerly-plugin-prices:pre-r7");
    const run = release("ok", [], "uguale", { FAKE_IMAGES: images.join(" ") });
    expect(run.status).toBe(0);
    const removed = run.calls.filter((call) => call.startsWith("docker image rm"));
    expect(removed).toEqual([
      "docker image rm ledgerly:pre-r1",
      "docker image rm ledgerly-web:pre-r1",
      "docker image rm ledgerly:pre-r2",
      "docker image rm ledgerly-web:pre-r2",
    ]);
    expect(run.calls.indexOf(removed[0])).toBeGreaterThan(
      run.calls.findIndex((c) => c.startsWith("npx playwright")),
    );
  });

  it("removes the dump folders of the releases that no longer have a pre-* image", () => {
    const dumps = join(work, "dumps");
    const folder = (name: string, release?: string) => {
      mkdirSync(join(dumps, name), { recursive: true });
      if (release) writeFileSync(join(dumps, name, "MANIFEST.txt"), `release: ${release}\nsha: x\n`);
      return join(dumps, name);
    };
    folder("r1-aaaaaaa", "r1");
    folder("r6-bbbbbbb", "r6");
    folder("r7-ccccccc", "r7");
    folder("fix-ddddddd", "fix (data fix, not a release)");
    writeFileSync(join(folder("kept-eeeeeee", "kept"), "KEEP"), "the only copy of something\n");
    folder("notes");
    const images = ["r1", "r2", "r3", "r4", "r5", "r6", "r7"].map(
      (id, day) => `2031-01-0${day + 1}T10:00|ledgerly:pre-${id}`,
    );
    const run = release("ok", [], "uguale", { FAKE_IMAGES: images.join(" ") });
    expect(run.status).toBe(0);
    for (const gone of ["r1-aaaaaaa", "fix-ddddddd"]) expect(existsSync(join(dumps, gone))).toBe(false);
    for (const kept of ["r6-bbbbbbb", "r7-ccccccc", "kept-eeeeeee", "notes", "t1-abc1234"]) {
      expect(existsSync(join(dumps, kept))).toBe(true);
    }
  });

  it("removes no dump folder when it reads no pre-* image", () => {
    const old = join(work, "dumps", "r1-aaaaaaa");
    mkdirSync(old, { recursive: true });
    writeFileSync(join(old, "MANIFEST.txt"), "release: r1\n");
    expect(release("ok").status).toBe(0);
    expect(existsSync(old)).toBe(true);
  });

  it("ends with status 2, deployed, when the numbers differ", () => {
    const run = release("ok", [], "1 differenze:");
    expect(run.status).toBe(2);
    expect(run.stdout).toContain("deployed");
    expect(built(run.calls)).toBe(true);
  });
});

describe("scripts/release-dump.sh", () => {
  it("makes the folder beside the main checkout, also when it runs from a worktree", () => {
    const sh = (cwd: string, command: string) =>
      spawnSync("sh", ["-c", command], {
        cwd,
        encoding: "utf8",
        env: { ...process.env, PATH: `${join(work, "bin")}:/usr/bin:/bin` },
      });
    const main = join(work, "projects", "ledgerly");
    mkdirSync(join(main, "scripts"), { recursive: true });
    mkdirSync(join(main, "drizzle"));
    writeFileSync(join(main, "drizzle", "0001_first.sql"), "");
    writeFileSync(
      join(main, "scripts", "release-dump.sh"),
      readFileSync(join(process.cwd(), "scripts/release-dump.sh")),
    );
    rmSync(join(work, "bin", "git"));
    const git = "git -c user.name=t -c user.email=t@t -c commit.gpgsign=false";
    expect(
      sh(
        main,
        `git init -q -b main && ${git} add . && ${git} commit -qm x && git worktree add -q ${join(work, "wt")}`,
      ).status,
    ).toBe(0);
    const run = sh(join(work, "wt"), "sh scripts/release-dump.sh t1 --no-dump");
    expect(run.status).toBe(0);
    expect(run.stdout.trim().split("\n").at(-1)).toMatch(
      new RegExp(`^${join(work, "projects", "ledgerly-dumps")}/t1-[0-9a-f]{7}$`),
    );
  });
});
