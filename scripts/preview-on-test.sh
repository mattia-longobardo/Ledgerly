#!/bin/sh
# scripts/preview-on-test.sh — the app driven locally against `ledgerly_test` and never the production
# database (docs/design/funds-ux.md §10).
#
# Usage: sh scripts/preview-on-test.sh up <image> | seed | remove | down
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
export DATABASE_URL S3_KEY_PREFIX E2E_BASE_URL

case "$DATABASE_URL" in
  */ledgerly_test) ;;
  *) echo "refusing to run: the database is not ledgerly_test" >&2; exit 1 ;;
esac

script() {
  docker run --rm --network db_internal --user "$(id -u):$(id -g)" -e HOME=/tmp \
    --env-file "$env_file" -e DATABASE_URL -e S3_KEY_PREFIX -e E2E_BASE_URL \
    -v "$PWD":/app -w /app node:26-bookworm-slim node --conditions=react-server --import tsx "$@"
}

case "${1:-}" in
  up)
    docker run -d --name ledgerly-preview --network db_internal --user 1000:1000 \
      --env-file "$env_file" -e DATABASE_URL -e S3_KEY_PREFIX \
      -p 127.0.0.1:3999:3000 "$2"
    ;;
  seed)
    script scripts/migrate.ts
    script scripts/seed-e2e.ts seed
    ;;
  remove) script scripts/seed-e2e.ts remove ;;
  down) docker rm -f ledgerly-preview ;;
  *) echo "usage: preview-on-test.sh up <image> | seed | remove | down" >&2; exit 1 ;;
esac
