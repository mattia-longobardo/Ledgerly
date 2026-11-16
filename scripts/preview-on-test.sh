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
set -eu
cd "$(dirname "$0")/.."

env_file="${LEDGERLY_ENV_FILE:-.env.homelab}"
database_url=$(sed -n "s/^DATABASE_URL=//p" "$env_file" | head -n 1 | sed -E "s/^'(.*)'\$/\\1/; s/^\"(.*)\"\$/\\1/")
DATABASE_URL="${database_url%/*}/ledgerly_test"
S3_KEY_PREFIX="tests/preview/"
E2E_BASE_URL="http://localhost:3999"
# The preview is its own origin: a password sign-in, OAuth and the address a plugin returns to are
# checked against this URL, and the seed signs its sessions for it (docs/testing.md).
BETTER_AUTH_URL="$E2E_BASE_URL"
export DATABASE_URL S3_KEY_PREFIX E2E_BASE_URL BETTER_AUTH_URL

case "$DATABASE_URL" in
  */ledgerly_test) ;;
  *) echo "refusing to run: the database is not ledgerly_test" >&2; exit 1 ;;
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
    environment | docker run -d --name ledgerly-preview --network db_internal --user 1000:1000 \
      --env-file /dev/stdin -e DATABASE_URL -e S3_KEY_PREFIX -e BETTER_AUTH_URL \
      -p 127.0.0.1:3999:3000 "$2"
    ;;
  seed)
    script scripts/migrate.ts
    script scripts/seed-e2e.ts seed
    ;;
  remove) script scripts/seed-e2e.ts remove ;;
  down) docker rm -f ledgerly-preview ;;
  *) echo "usage: preview-on-test.sh build [<image>] | up <image> | seed | remove | down" >&2; exit 1 ;;
esac
