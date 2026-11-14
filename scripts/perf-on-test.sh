#!/bin/sh
# scripts/perf-on-test.sh — runs scripts/perf-probe.ts against `ledgerly_test`, never `ledgerly`.
set -eu
cd "$(dirname "$0")/.."
value() { sed -n "s/^$1=//p" .env.homelab | head -n 1 | sed -E "s/^'(.*)'\$/\\1/; s/^\"(.*)\"\$/\\1/"; }
database_url=$(value DATABASE_URL)
DATABASE_URL="${database_url%/*}/ledgerly_test"
case "$DATABASE_URL" in */ledgerly_test) ;; *) echo "refusing: not ledgerly_test" >&2; exit 1 ;; esac
export DATABASE_URL
# `docker run --env-file` keeps the quotes around a quoted value, which Compose drops: the file is
# passed on stdin with one pair of quotes removed (as in `scripts/on-homelab.sh`). `-e DATABASE_URL`
# comes after it and wins: the test database, never the one in the file.
sed -E "s/^([A-Za-z_][A-Za-z0-9_]*)='(.*)'\$/\\1=\\2/; s/^([A-Za-z_][A-Za-z0-9_]*)=\"(.*)\"\$/\\1=\\2/" .env.homelab |
  exec docker run --rm -i --network db_internal \
  --user "$(id -u):$(id -g)" -e HOME=/tmp \
  --env-file /dev/stdin -e DATABASE_URL \
  -v "$PWD":/app -w /app \
  node:26-bookworm-slim node --conditions=react-server --import tsx scripts/perf-probe.ts "$@"
