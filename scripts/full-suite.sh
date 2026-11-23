#!/bin/sh
# scripts/full-suite.sh — gate G10 of the rewrite plan: every test of G1-G6 and G9, complete, each
# night and at the end of a phase (docs/testing.md, "The full suite").
#
# Usage: sh scripts/full-suite.sh
#
# It runs on the checkout it is in, at its commit, and never touches production or `ledgerly_test`
# (the database of a release's preview and of `npm run perf`):
#   - the integration tests run on `ledgerly_<1-4>_test` (scripts/test-integration.sh, its own lock);
#   - the E2E preview and `npm run perf` run on `ledgerly_1_test`, under the same lock, so that no
#     integration run of a release resets the database under them: a release that starts its
#     integration tests meanwhile waits, and this script waits for one that is running;
#   - the preview is its own container (`ledgerly-full-suite`, 127.0.0.1:3995, S3 prefix
#     `tests/full-suite/`) and its own image (`ledgerly:full-suite`): it does not touch the release's
#     `ledgerly-preview` on 3999 or the image `ledgerly:preview` that `scripts/release.sh` reuses.
#
# A checkout with no `.env.homelab` names the file with LEDGERLY_ENV_FILE. The browser goes in
# PLAYWRIGHT_BROWSERS_PATH, by default `test-results/pw` of this checkout (never `~/.cache`).
# The summary, with the result and the time of each gate, is printed at the end and written to
# `test-results/full-suite/summary.md`; the output of each gate is next to it. Exit 1 when a gate is red.
set -u
cd "$(dirname "$0")/.."

out=test-results/full-suite
rm -rf "$out"
mkdir -p "$out"

LEDGERLY_ENV_FILE="${LEDGERLY_ENV_FILE:-.env.homelab}"
case "$LEDGERLY_ENV_FILE" in /*) ;; *) LEDGERLY_ENV_FILE="$PWD/$LEDGERLY_ENV_FILE" ;; esac
[ -r "$LEDGERLY_ENV_FILE" ] || { echo "no environment file: $LEDGERLY_ENV_FILE" >&2; exit 1; }
PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-$PWD/test-results/pw}"
export LEDGERLY_ENV_FILE PLAYWRIGHT_BROWSERS_PATH

# The second preview, beside the one of a release. Not 3997 or 3998: the client stream's previews
# use them, and a port already taken turned a night red.
LEDGERLY_TEST_DATABASE=ledgerly_1_test
LEDGERLY_PREVIEW_PORT=3995
LEDGERLY_PREVIEW_NAME=ledgerly-full-suite
LEDGERLY_PREVIEW_S3_PREFIX=tests/full-suite/
E2E_BASE_URL="http://localhost:$LEDGERLY_PREVIEW_PORT"
export LEDGERLY_TEST_DATABASE LEDGERLY_PREVIEW_PORT LEDGERLY_PREVIEW_NAME LEDGERLY_PREVIEW_S3_PREFIX E2E_BASE_URL
image=ledgerly:full-suite

sha=$(git rev-parse HEAD)
started=$(date +%s)
rows=
red=
failed=0

# gate <id> <title> <command…>: runs one gate, its output in "$out/<id>.log", and keeps its row.
gate() {
  id=$1
  title=$2
  shift 2
  echo "===== $title" >&2
  t0=$(date +%s)
  if "$@" >"$out/$id.log" 2>&1; then result=ok; else result=FAILED; failed=1; red="$red $id"; fi
  seconds=$(($(date +%s) - t0))
  load=$(cut -d' ' -f1 /proc/loadavg)
  rows="$rows
| $title | $result | ${seconds} s | $load |"
  echo "      $result in ${seconds} s" >&2
  [ "$result" = ok ]
}
skip() {
  rows="$rows
| $1 | skipped: $2 | — | — |"
  failed=1
}

# The highest release tag: `assertions-diff` reads the commits since it.
previous=$(git tag --list 'v*' --sort=-v:refname | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -n 1)

static() { npm run format:check && npm run lint && npm run typecheck; }
unit() { npm test && npm run assertions-diff -- "${previous:-HEAD}..HEAD"; }
browser() {
  npx playwright install chromium-headless-shell &&
    node --input-type=module -e 'import { chromium } from "@playwright/test"; await (await chromium.launch()).close()'
}
preview() {
  # `up` puts the preview on the plugins' network too.
  sh scripts/preview-on-test.sh up "$image" || return 1
  i=0
  until curl -fsS "$E2E_BASE_URL/api/health" >/dev/null 2>&1; do
    i=$((i + 1))
    [ "$i" -le 90 ] || { docker logs --tail 50 "$LEDGERLY_PREVIEW_NAME"; return 1; }
    sleep 1
  done
  sh scripts/preview-on-test.sh seed
}
# Playwright empties its output folder: this run's goes inside "$out", not over it.
e2e() { npx playwright test -c playwright.preview.config.ts --reporter=line --output "$out/e2e"; }
# G4, the measure of the clones: the share of duplicated lines may not grow over the one recorded in
# `baselines/duplication.json`. The file itself is not rewritten: it is the record, not the tree.
duplication() {
  npx tsx -e '
    import { readFileSync } from "node:fs";
    import { measureDuplication } from "./scripts/duplication.ts";
    import { readProductSources } from "./scripts/source-graph.ts";
    const now = measureDuplication(readProductSources(process.cwd())).total;
    const was = JSON.parse(readFileSync("baselines/duplication.json", "utf8")).total;
    console.log(`${now.duplicatedLines} of ${now.lines} lines (${now.percent}%); recorded ${was.percent}%`);
    if (now.percent > was.percent) process.exit(1);
  '
}

# Whatever happens, the preview goes, its users with it, and the lock is released (exit closes it).
cleanup() {
  if docker inspect "$LEDGERLY_PREVIEW_NAME" >/dev/null 2>&1; then
    sh scripts/preview-on-test.sh remove >"$out/remove.log" 2>&1 || echo "seed remove failed: $out/remove.log" >&2
    sh scripts/preview-on-test.sh down >/dev/null 2>&1
  fi
  docker image rm "$image" >/dev/null 2>&1 || true
}
trap cleanup EXIT
trap 'exit 130' INT TERM

[ -d node_modules ] || npm ci >"$out/npm-ci.log" 2>&1 || { echo "npm ci failed: $out/npm-ci.log" >&2; exit 1; }

gate static "G1 static (format, lint, typecheck)" static
gate unit "G2 unit + assertions-diff ${previous:-HEAD}..HEAD" unit
gate duplication "G4 duplicated lines, not above the record" duplication
# The running plugins against the catalog (decision H28): read only, `docker exec … sha256sum`.
gate plugins "plugins: the running bundles are the catalog's" sh scripts/plugins-check.sh
gate integration "G3/G5 integration, 4 shards" sh scripts/test-integration.sh
ready=no
gate build "build $image" sh scripts/preview-on-test.sh build "$image" &&
  gate browser "E2E browser" browser && ready=yes

exec 9>/run/lock/ledgerly-integration.lock
if ! flock -n 9; then
  echo "an integration run uses the test databases: waiting for it" >&2
  flock -w 1800 9 || { echo "the lock stayed busy for 30 minutes" >&2; exit 1; }
fi
if [ "$ready" = no ]; then
  skip "G6 E2E, 4 workers" "no image or browser"
elif gate preview "preview on $LEDGERLY_TEST_DATABASE + seed" preview; then
  gate e2e "G6 E2E, 4 workers" e2e
else
  skip "G6 E2E, 4 workers" "no preview"
fi
cleanup
# After the preview, with the host quiet: the times of G9 want it.
gate perf "G9 perf (times and queries)" npm run perf
exec 9>&-

total=$(($(date +%s) - started))
{
  echo "# Full suite (G10): $([ "$failed" -eq 0 ] && echo GREEN || echo RED)"
  echo
  echo "Commit \`$sha\`, $(date -d "@$started" '+%Y-%m-%d %H:%M %Z'), $((total / 60)) min $((total % 60)) s."
  echo
  echo "| Gate | Result | Time | Load (1 min) |"
  echo "|---|---|---|---|$rows"
  # The end of the output of each red gate: the failed tests are there.
  for id in $red; do
    echo
    echo "## $id: the last lines of \`$out/$id.log\`"
    echo
    echo '```'
    sed 's/\x1b\[[0-9;]*m//g' "$out/$id.log" | tail -n 40
    echo '```'
  done
} >"$out/summary.md"
cat "$out/summary.md"
exit "$failed"
