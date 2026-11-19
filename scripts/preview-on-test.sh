#!/bin/sh
# scripts/preview-on-test.sh — the app driven locally against `ledgerly_test` and never the production
# database (docs/design/funds-ux.md §10).
#
# Usage: sh scripts/preview-on-test.sh build [<image>] | up <image> | seed | remove | down
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
  sed -E "s/^([A-Za-z_][A-Za-z0-9_]*)='(.*)'\$/\\1=\\2/; s/^([A-Za-z_][A-Za-z0-9_]*)=\"(.*)\"\$/\\1=\\2/" "$env_file"
}

script() {
  environment | docker run --rm -i --network db_internal --user "$(id -u):$(id -g)" -e HOME=/tmp \
    --env-file /dev/stdin -e DATABASE_URL -e S3_KEY_PREFIX -e E2E_BASE_URL -e BETTER_AUTH_URL \
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
    environment | docker run -d --name "$name" --network db_internal --user 1000:1000 \
      --env-file /dev/stdin -e DATABASE_URL -e S3_KEY_PREFIX -e BETTER_AUTH_URL \
      -p "127.0.0.1:$port:3000" "$2"
    # The worker of the preview (rewrite plan R1): the tasks the screens put in the queue, on the same
    # database. No scheduler: as before R1, no tier runs by itself in a preview. It restarts until
    # the app has applied the migrations of the queue.
    environment | docker run -d --name "$name-worker" --restart unless-stopped --network db_internal --user 1000:1000 \
      --env-file /dev/stdin -e DATABASE_URL -e S3_KEY_PREFIX -e BETTER_AUTH_URL \
      "$2" node /app/worker.mjs --no-schedule
    ;;
  seed)
    script scripts/migrate.ts
    script scripts/seed-e2e.ts seed
    ;;
  remove) script scripts/seed-e2e.ts remove ;;
  down) docker rm -f "$name" "$name-worker" ;;
  *) echo "usage: preview-on-test.sh build [<image>] | up <image> | seed | remove | down" >&2; exit 1 ;;
esac
