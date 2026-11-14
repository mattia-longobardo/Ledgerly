#!/bin/sh
# scripts/numbers-on-homelab.sh — `npm run numbers`: the numbers snapshot of the deployed database.
#
# Usage: sh scripts/numbers-on-homelab.sh <release folder> <label> [--as-of <ISO instant>]
#        sh scripts/numbers-on-homelab.sh --diff <a.json> <b.json>
#
# `<release folder>` is the one `scripts/release-dump.sh` printed, in `../Ledgerly-dumps/`. The script
# (`scripts/numbers-snapshot.ts`) reads every real user in one transaction that it rolls back and writes
# `numbers-<label>.json` and its `sha256` there, mode 600. Take "before" just before the deploy and
# "after" just after it, with the `--as-of` the first run printed, so that both read the same day.
# `--diff` needs no database: it prints "uguale", or the names of the numbers that differ.
set -eu
cd "$(dirname "$0")/.."
umask 077

if [ "${1:-}" = "--diff" ]; then
  exec node --conditions=react-server --import tsx scripts/numbers-snapshot.ts "$@"
fi

folder=$(cd "${1:?usage: numbers-on-homelab.sh <release folder> <label> [--as-of <instant>]}" && pwd)
label=${2:?label: before | after}
shift 2
sed -E "s/^([A-Za-z_][A-Za-z0-9_]*)='(.*)'\$/\\1=\\2/; s/^([A-Za-z_][A-Za-z0-9_]*)=\"(.*)\"\$/\\1=\\2/" .env.homelab |
  exec docker run --rm --network db_internal \
  --user "$(id -u):$(id -g)" -e HOME=/tmp \
  --env-file /dev/stdin \
  -v "$PWD":/app:ro -v "$folder":/out -w /app \
  node:26-bookworm-slim node --conditions=react-server --import tsx scripts/numbers-snapshot.ts \
  --out /out --label "$label" "$@"
