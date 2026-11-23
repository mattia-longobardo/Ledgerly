#!/bin/sh
# scripts/preview-on-test.sh — the app driven locally against `ledgerly_test` and never the production
# database (docs/design/funds-ux.md §10).
#
# Usage: sh scripts/preview-on-test.sh build [<image>] | up <image> | ready | seed | remove | down
# `build` makes the image of the checkout (default `ledgerly:preview`) and, when the tree is clean,
# writes its commit on it: `scripts/release.sh` starts that image for the same commit and does not
# build the application a second time.
# LEDGERLY_ENV_FILE names the environment file, for a checkout that has no `.env.homelab` of its own.
# The preview listens on 127.0.0.1:3999 only. Its database URL is worked out from the application's
# own and handed over through the environment, never on a command line.
# The full suite (scripts/full-suite.sh) starts a second preview beside the one of a release, with
# LEDGERLY_TEST_DATABASE (one of `ledgerly_<1-4>_test`), LEDGERLY_PREVIEW_PORT, LEDGERLY_PREVIEW_NAME
# and LEDGERLY_PREVIEW_S3_PREFIX. Without them: `ledgerly_test`, 3999, `ledgerly-preview`, `tests/preview/`.
# The client stream uses LEDGERLY_TEST_DATABASE=ledgerly_test_2 (docs/design/rewrite-plan/08-agents.md §8.6).
set -eu
cd "$(dirname "$0")/.."

env_file="${LEDGERLY_ENV_FILE:-.env.homelab}"
database_url=$(sed -n "s/^DATABASE_URL=//p" "$env_file" | head -n 1 | sed -E "s/^'(.*)'\$/\\1/; s/^\"(.*)\"\$/\\1/")
database="${LEDGERLY_TEST_DATABASE:-ledgerly_test}"
port="${LEDGERLY_PREVIEW_PORT:-3999}"
name="${LEDGERLY_PREVIEW_NAME:-ledgerly-preview}"
DATABASE_URL="${database_url%/*}/$database"
S3_KEY_PREFIX="${LEDGERLY_PREVIEW_S3_PREFIX:-tests/preview/}"
E2E_BASE_URL="http://localhost:$port"
# The preview is its own origin: a password sign-in, OAuth and the address a plugin returns to are
# checked against this URL, and the seed signs its sessions for it (docs/testing.md).
BETTER_AUTH_URL="$E2E_BASE_URL"
export DATABASE_URL S3_KEY_PREFIX E2E_BASE_URL BETTER_AUTH_URL

# Every plugin of the catalog is a plugin of the preview, as after the deploy of the checkout: one the
# instance does not run yet gets the address of its container and a secret of this run only. Nothing
# answers there; the seed registers the manifest its source serves (scripts/seed-e2e/common.ts).
value() { sed -n "s/^$1=//p" "$env_file" | head -n 1 | sed -E "s/^'(.*)'\$/\\1/; s/^\"(.*)\"\$/\\1/"; }
PLUGIN_URLS=$(value PLUGIN_URLS | tr -d " ")
# The plugins the instance runs: the preview waits for these to answer (`ready`).
running_plugins=$PLUGIN_URLS
PLUGIN_SECRETS=$(value PLUGIN_SECRETS | tr -d " ")
catalog=packages/domain/src/platform/plugins/catalog.json
for id in $(sed -n 's/^ *"id": "\([a-z0-9-]*\)".*/\1/p' "$catalog"); do
  case ",$PLUGIN_URLS," in *",$id="*) continue ;; esac
  PLUGIN_URLS="${PLUGIN_URLS:+$PLUGIN_URLS,}$id=http://ledgerly-plugin-$id:8787"
  PLUGIN_SECRETS="${PLUGIN_SECRETS:+$PLUGIN_SECRETS,}$id=$(od -An -tx1 -N32 /dev/urandom | tr -d ' \n')"
done
export PLUGIN_URLS PLUGIN_SECRETS

case "$DATABASE_URL" in
  */ledgerly_test | */ledgerly_test_2 | */ledgerly_[1-4]_test) ;;
  *) echo "refusing to run: the database is not ledgerly_test, ledgerly_test_2 or ledgerly_<1-4>_test" >&2; exit 1 ;;
esac
case "$port" in
  *[!0-9]* | "") echo "LEDGERLY_PREVIEW_PORT must be a number" >&2; exit 1 ;;
esac
case "$S3_KEY_PREFIX" in
  tests/*/) ;;
  *) echo "LEDGERLY_PREVIEW_S3_PREFIX must be tests/<name>/" >&2; exit 1 ;;
esac

# `docker run --env-file` keeps the quotes around a quoted value, which Compose drops: the file is
# passed on stdin with one pair of quotes removed (as in `scripts/on-homelab.sh`).
environment() {
  sed -E "/^PLUGIN_(URLS|SECRETS)=/d; s/^([A-Za-z_][A-Za-z0-9_]*)='(.*)'\$/\\1=\\2/; s/^([A-Za-z_][A-Za-z0-9_]*)=\"(.*)\"\$/\\1=\\2/" "$env_file"
}

# ready: waits until the preview can serve the E2E — its health check answers, its worker is up, and
# every plugin the instance runs answers from inside the preview. The first run after a start failed
# on connections and account-switch when it did not wait (the bank's plugin was not ready yet).
ready() {
  i=0
  until curl -fsS "$E2E_BASE_URL/api/health" >/dev/null 2>&1 &&
    docker exec "$name-worker" node /app/worker.mjs --health >/dev/null 2>&1 &&
    plugins_answer; do
    i=$((i + 1))
    if [ "$i" -gt "${LEDGERLY_PREVIEW_WAIT:-120}" ]; then
      echo "the preview is not ready after ${LEDGERLY_PREVIEW_WAIT:-120} s" >&2
      docker logs --tail 50 "$name" >&2
      return 1
    fi
    sleep 1
  done
}
plugins_answer() {
  for entry in $(echo "$running_plugins" | tr "," " "); do
    docker exec "$name" wget -qO /dev/null "${entry#*=}/health" 2>/dev/null || return 1
  done
}

script() {
  environment | docker run --rm -i --network db_internal --user "$(id -u):$(id -g)" -e HOME=/tmp \
    --env-file /dev/stdin -e DATABASE_URL -e S3_KEY_PREFIX -e E2E_BASE_URL -e BETTER_AUTH_URL -e PLUGIN_URLS -e PLUGIN_SECRETS \
    -v "$PWD":/app -w /app node:26-bookworm-slim node --conditions=react-server --import tsx "$@"
}

case "${1:-}" in
  build)
    # The commit goes on the image only when the image is that commit and nothing else.
    if [ -z "$(git status --porcelain)" ]; then
      docker build --label "org.opencontainers.image.revision=$(git rev-parse HEAD)" -t "${2:-ledgerly:preview}" .
    else
      echo "the working tree has changes: the image carries no commit, and a release will not reuse it" >&2
      docker build -t "${2:-ledgerly:preview}" .
    fi
    ;;
  up)
    environment | docker create --name "$name" --network db_internal --user 1000:1000 \
      --env-file /dev/stdin -e DATABASE_URL -e S3_KEY_PREFIX -e BETTER_AUTH_URL -e PLUGIN_URLS -e PLUGIN_SECRETS \
      -p "127.0.0.1:$port:3000" "$2" >/dev/null
    # The plugin's manifest is on `ledgerly_plugins` (PLUGIN_URLS): without it the bank plugin is
    # missing and its pages answer 404, whatever the database. Connected before the start, so the
    # first health check, which reads the manifests, already reaches them. A host with no plugin has
    # no network.
    if docker network inspect ledgerly_plugins >/dev/null 2>&1; then
      docker network connect ledgerly_plugins "$name"
    fi
    docker start "$name"
    # The worker of the preview (rewrite plan R1): the tasks the screens put in the queue, on the same
    # database. No scheduler: as before R1, no tier runs by itself in a preview. It restarts until
    # the app has applied the migrations of the queue.
    environment | docker run -d --name "$name-worker" --restart unless-stopped --network db_internal --user 1000:1000 \
      --env-file /dev/stdin -e DATABASE_URL -e S3_KEY_PREFIX -e BETTER_AUTH_URL -e PLUGIN_URLS -e PLUGIN_SECRETS \
      "$2" node /app/worker.mjs --no-schedule
    ready
    ;;
  ready) ready ;;
  seed)
    ready
    script scripts/migrate.ts
    script scripts/seed-e2e.ts seed
    ;;
  remove) script scripts/seed-e2e.ts remove ;;
  down) docker rm -f "$name" "$name-worker" ;;
  *) echo "usage: preview-on-test.sh build [<image>] | up <image> | ready | seed | remove | down" >&2; exit 1 ;;
esac
