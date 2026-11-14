#!/bin/sh
# scripts/release.sh — one release of Ledgerly, from the way back to the numbers "after".
#
# Usage: sh scripts/release.sh <release-id> [--no-dump] [--cron] [--before-from <checkout>]
#        e.g. `n5-1 --no-dump`, `r1 --cron`, `n6 --before-from ../ledgerly-v0.14.0`
#
# The steps of docs/RELEASE.md §2-§4, in the one order that keeps a way back:
#   1. the lock, a clean tree, HEAD = origin/main;
#   2. the image `pre-<id>` (and `ledgerly-cron:pre-<id>` with `--cron`);
#   3. the release's folder and its dump (`scripts/release-dump.sh`; `--no-dump`: the folder only);
#   4. the numbers snapshot "before" (`npm run numbers`), with its checksum verified;
#   5. the build and the start, waiting for the health check;
#   6. the health of the site, the numbers "after" at the same instant, and their comparison.
#
# Every step before 5 has to succeed, and the snapshot "before" has to be on disk, not empty and
# equal to its checksum: otherwise the script stops there, with the application untouched. A
# snapshot taken after the build has started says nothing about a release that moves data — in N5.1
# a failed mount went unnoticed and the deploy went on.
#
# `--before-from <checkout>`: the snapshot "before" is read by the code of another checkout (the
# release in production, with its `node_modules` and `.env.homelab`). A release with a migration
# needs it: the new read services ask for tables the database does not have yet.
#
# The comparison prints "uguale" or the names of the numbers that differ, never a value. Names
# that differ end the script with status 2: the release is deployed, and each name is either a
# difference the release declares or a reason to roll back.
#
# A failure after the build has started does not roll back by itself: the script prints the
# rollback command and exits 1. The tag `vX.Y.Z` and the E2E stay with the caller.
#
# `LEDGERLY_DEPLOY_LOCK`, `LEDGERLY_DUMPS_DIR` and `LEDGERLY_HEALTH_URL` exist for the test
# (`src/release-script.test.ts`), which runs this file against commands that only take notes.
set -eu
cd "$(dirname "$0")/.."

release=${1:?usage: release.sh <release-id> [--no-dump] [--cron] [--before-from <checkout>]}
shift
dump_mode=""
services="ledgerly"
before_from="$PWD"
while [ $# -gt 0 ]; do
  case "$1" in
    --no-dump) dump_mode="--no-dump" ;;
    --cron) services="ledgerly ledgerly-cron" ;;
    --before-from)
      shift
      before_from=$(cd "${1:?--before-from needs a checkout}" && pwd)
      ;;
    *) echo "unknown option: $1" >&2; exit 1 ;;
  esac
  shift
done

stop() {
  echo "release $release STOPPED before the build: $1" >&2
  echo "The application is untouched. Fix the cause and start again." >&2
  exit 1
}

# ——— 1. Lock and preconditions ———————————————————————————————————————————————————————————————
lock=${LEDGERLY_DEPLOY_LOCK:-/var/lock/deploy-ledgerly.lock}
exec 9> "$lock" || stop "the lock $lock cannot be opened"
flock -n 9 || stop "another deploy holds $lock"

[ -z "$(git status --porcelain)" ] || stop "the working tree is not clean"
git fetch --quiet --tags origin || stop "git fetch failed"
sha=$(git rev-parse HEAD)
[ "$sha" = "$(git rev-parse origin/main)" ] || stop "HEAD is not origin/main"

# ——— 2. The image to go back to ———————————————————————————————————————————————————————————————
for service in $services; do
  docker tag "$service:latest" "$service:pre-$release" || stop "docker tag $service:pre-$release failed"
done

# ——— 3. The folder and the dump ———————————————————————————————————————————————————————————————
# shellcheck disable=SC2086 — `$dump_mode` is one word or nothing.
folder=$(sh scripts/release-dump.sh "$release" $dump_mode | tail -n 1) || stop "the dump failed"
[ -d "$folder" ] || stop "the release folder is missing"
if [ -z "$dump_mode" ]; then
  [ -s "$folder/ledgerly.dump" ] || stop "the dump is missing or empty"
fi

# ——— 4. The numbers "before" ——————————————————————————————————————————————————————————————————
before_log="$folder/numbers-before.log"
npm --prefix "$before_from" run --silent numbers -- "$folder" before > "$before_log" 2>&1 || {
  cat "$before_log" >&2
  stop "the numbers snapshot \"before\" failed"
}
[ -s "$folder/numbers-before.json" ] || stop "numbers-before.json is missing or empty"
[ -s "$folder/numbers-before.json.sha256" ] || stop "numbers-before.json.sha256 is missing"
(cd "$folder" && sha256sum --check --status numbers-before.json.sha256) ||
  stop "numbers-before.json does not match its checksum"
instant=$(sed -n 's/.*as of \([0-9TZ:.-]*\),.*/\1/p' "$before_log" | tail -n 1)
[ -n "$instant" ] || stop "the snapshot \"before\" printed no instant"
chmod 600 "$before_log"
echo "before: numbers-before.json, as of $instant"

# ——— 5. Build and start ———————————————————————————————————————————————————————————————————————
failed() {
  echo "release $release FAILED after the build started: $1" >&2
  echo "Rollback: docker tag ledgerly:pre-$release ledgerly:latest && docker compose up -d --no-build ledgerly" >&2
  exit 1
}
# shellcheck disable=SC2086 — the services are separate words.
docker compose build $services || failed "the build failed (the running containers are still the old ones)"
# shellcheck disable=SC2086
docker compose up -d --wait $services || failed "the containers did not become healthy"

# ——— 6. Health and the numbers "after" ————————————————————————————————————————————————————————
url=${LEDGERLY_HEALTH_URL:-https://dash.longobardo.me/api/health}
health=""
for _ in 1 2 3 4 5 6 7 8 9 10 11 12; do
  health=$(curl -fsS --max-time 10 "$url" 2> /dev/null || true)
  case "$health" in *'"status":"ok"'*) break ;; esac
  sleep "${LEDGERLY_HEALTH_WAIT:-5}"
done
case "$health" in
  *'"status":"ok"'*) echo "health: $health" ;;
  *) failed "the health check did not answer ok" ;;
esac

npm run --silent numbers -- "$folder" after --as-of "$instant" > "$folder/numbers-after.log" 2>&1 ||
  failed "the numbers snapshot \"after\" failed"
chmod 600 "$folder/numbers-after.log"
echo "numbers:"
different=0
npm run --silent numbers -- --diff "$folder/numbers-before.json" "$folder/numbers-after.json" || different=1

echo "release $release deployed: $sha"
echo "$folder"
if [ "$different" = 1 ]; then
  echo "The numbers differ: each name is a difference the release declares, or a rollback." >&2
  exit 2
fi
