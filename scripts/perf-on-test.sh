#!/bin/sh
# scripts/perf-on-test.sh — runs scripts/perf-probe.ts against `ledgerly_test`, never `ledgerly`.
set -eu
cd "$(dirname "$0")/.."
value() { sed -n "s/^$1=//p" .env.homelab | head -n 1; }
database_url=$(value DATABASE_URL)
DATABASE_URL="${database_url%/*}/ledgerly_test"
case "$DATABASE_URL" in */ledgerly_test) ;; *) echo "refusing: not ledgerly_test" >&2; exit 1 ;; esac
export DATABASE_URL
exec docker run --rm --network db_internal \
  --user "$(id -u):$(id -g)" -e HOME=/tmp \
  --env-file .env.homelab -e DATABASE_URL \
  -v "$PWD":/app -w /app \
  node:22-bookworm-slim node --conditions=react-server --import tsx scripts/perf-probe.ts
