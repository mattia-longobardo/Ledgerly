#!/bin/sh
# scripts/release.sh — one release of Ledgerly, from the way back to the numbers "after".
#
# Usage: sh scripts/release.sh <release-id> [--no-dump] [--cron] [--plugin <id>] [--before-from <checkout>]
#        e.g. `n5-1 --no-dump`, `r1 --cron`, `n6 --before-from ../ledgerly-v0.14.0`,
#        `n1 --plugin enablebanking --before-from ../ledgerly-v0.17.0`
#
# The steps of docs/RELEASE.md §2-§4, in the one order that keeps a way back:
#   1. the lock, a clean tree, HEAD = origin/main;
#   2. the image `pre-<id>` (and `ledgerly-cron:pre-<id>` with `--cron`: the cron sidecar is gone
#      since R1, its image is kept for a rollback to before it; the image of a plugin with
#      `--plugin <id>`; a service deployed for the first time has no image to keep);
#   3. the release's folder and its dump (`scripts/release-dump.sh`; `--no-dump`: the folder only);
#   4. the numbers snapshot "before" (`npm run numbers`), with its checksum verified;
#   5. the build and the start, waiting for the health check, then the worker on the same image
#      (and the containers compose no longer names, such as the cron sidecar, removed). The
#      application is not built again when the image of the preview was built from the same commit
#      (`preview-on-test.sh build`);
#   6. the health of the site, the numbers "after" at the same instant, and their comparison;
#   7. the `@smoke` tests on the site (docs/testing.md);
#   8. the running plugins against the catalog of the official plugins (`scripts/plugins-check.sh`).
#
# The official plugins of the catalog and the egress proxy are services of every release: a
# plugin's bundle carries the release's version, so its digest in the catalog changes with each
# release and the container that runs the one before fails step 8.
#
# The tests of the release run before this script, once, on the final SHA: `npm run test:select`
# prints them from the release diff, with the E2E on the local preview. The site gets `@smoke` here
# and, from the caller, the `@site` tests that the selection names: nothing else runs twice.
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
# A failure after the build has started — a red `@smoke` test included — does not roll back by
# itself: the script prints the rollback command and exits 1. The tag `vX.Y.Z` and the `@site`
# tests stay with the caller.
#
# `LEDGERLY_DEPLOY_LOCK`, `LEDGERLY_DUMPS_DIR` and `LEDGERLY_HEALTH_URL` exist for the test
# (`src/release-script.test.ts`), which runs this file against commands that only take notes.
set -eu
cd "$(dirname "$0")/.."

release=${1:?usage: release.sh <release-id> [--no-dump] [--cron] [--plugin <id>] [--before-from <checkout>]}
shift
dump_mode=""
# The server and the interface, two images of one Dockerfile (rewrite plan R4).
services="ledgerly ledgerly-web"
kept=""
before_from="$PWD"
while [ $# -gt 0 ]; do
  case "$1" in
    --no-dump) dump_mode="--no-dump" ;;
    --cron) kept="ledgerly-cron" ;;
    --plugin)
      shift
      case "${1:-}" in
        "" | *[!a-z0-9-]*) echo "--plugin needs the id of a plugin" >&2; exit 1 ;;
      esac
      services="$services ledgerly-plugin-$1"
      ;;
    --before-from)
      shift
      before_from=$(cd "${1:?--before-from needs a checkout}" && pwd)
      ;;
    *) echo "unknown option: $1" >&2; exit 1 ;;
  esac
  shift
done

# The services of the catalog (packages/domain/src/platform/plugins/catalog.json): each plugin's
# container, then the egress proxy they go out through. `--plugin <id>` adds a plugin outside it;
# naming one of the catalog changes nothing (each service is taken once).
catalog_services=$(node -e '
  const { plugins } = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
  console.log([...plugins.map((entry) => entry.image), "ledgerly-egress"].join(" "));
' packages/domain/src/platform/plugins/catalog.json 2> /dev/null || true)
for service in $catalog_services; do
  case " $services " in *" $service "*) ;; *) services="$services $service" ;; esac
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
# The browser of the smoke tests, now: found missing after the build, it would leave a release
# deployed and not verified (AGENTS.md, "Deploy": `PLAYWRIGHT_BROWSERS_PATH`).
node --input-type=module -e 'import { chromium } from "@playwright/test"; await (await chromium.launch()).close()' \
  > /dev/null 2>&1 || stop "the browser of the E2E tests does not start: prepare it, then start again"

# ——— 2. The image to go back to ———————————————————————————————————————————————————————————————
for service in $services $kept; do
  # A service deployed for the first time has no image yet: its way back is to stop it.
  if docker image inspect "$service:latest" > /dev/null 2>&1; then
    docker tag "$service:latest" "$service:pre-$release" || stop "docker tag $service:pre-$release failed"
  else
    echo "no image $service:latest yet: nothing to keep for this service"
  fi
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
  echo "Rollback: docker tag ledgerly:pre-$release ledgerly:latest && docker tag ledgerly-web:pre-$release ledgerly-web:latest && docker compose up -d --no-build ledgerly ledgerly-web ledgerly-worker" >&2
  others=${services#ledgerly ledgerly-web}
  if [ -n "${others# }" ]; then
    echo "and for each of$others: docker tag <service>:pre-$release <service>:latest && docker compose up -d --no-build <service>" >&2
  fi
  exit 1
}
# The image of the preview, when it was built from this commit and from a clean tree
# (`scripts/preview-on-test.sh build` writes the commit on it): the tests of the release ran on that
# image, and the release starts the same one instead of building it a second time. Any other image
# — no preview, another commit, a tree with changes — is not used, and the application is built here.
preview=${LEDGERLY_PREVIEW_IMAGE:-ledgerly:preview}
revision=$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' \
  "$preview" 2> /dev/null || true)
to_build=$services
if [ "$revision" = "$sha" ]; then
  docker tag "$preview" ledgerly:latest || failed "the image of the preview could not be tagged"
  echo "image: ledgerly is the image of the preview, built from $sha: not built again (the interface is)"
  to_build=${services#ledgerly}
else
  echo "image: no preview image of $sha: ledgerly is built here"
fi
if [ -n "${to_build# }" ]; then
  # shellcheck disable=SC2086 — the services are separate words.
  docker compose build $to_build || failed "the build failed (the running containers are still the old ones)"
fi
# shellcheck disable=SC2086
docker compose up -d --wait $services || failed "the containers did not become healthy"
# `:latest` names the image each container runs. With the containerd image store, a build of an
# unchanged plugin gets a new image ID (its attestation changes) over the same platform manifest:
# compose keeps the running container, and `:latest` would name an image no container uses — the
# Docker cleanup removes it, and the next release has no `pre-<id>` image for that plugin.
for service in $services; do
  running=$(docker inspect --format '{{.Image}}' "$service") && [ -n "$running" ] ||
    failed "the container $service is missing after the start"
  docker tag "$running" "$service:latest" || failed "docker tag $service:latest failed"
done
# The worker runs the image `ledgerly` just started (rewrite plan R1); it starts after the
# migrations, which `ledgerly` applies as it starts.
docker compose up -d --wait --no-build --remove-orphans ledgerly-worker ||
  failed "the worker did not become healthy"

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

# ——— 7. The smoke tests on the site ———————————————————————————————————————————————————————————
# At the site's origin, Traefik's `web` entrypoint, not through Cloudflare: one run of them (~950
# requests in under a minute) passes the rate limit of Cloudflare's rule, and the release failed
# three times on a 429 with a healthy app. The browser still speaks to https://dash.longobardo.me,
# with its cookies (tests/e2e/_shared/origin.ts). The `@site` tests of the caller go there too.
echo "smoke:"
E2E_ORIGIN=127.0.0.1 npx playwright test --grep @smoke || failed "the @smoke tests are red on the site"

# ——— 8. The plugins against the catalog ————————————————————————————————————————————————————————
sh scripts/plugins-check.sh || failed "a plugin does not run the bundle of the catalog"

echo "release $release deployed: $sha"
echo "$folder"
if [ "$different" = 1 ]; then
  echo "The numbers differ: each name is a difference the release declares, or a rollback." >&2
  exit 2
fi
