#!/bin/sh
# scripts/fund-documents-on-homelab.sh — step A4 of release N6, next to the deployed app.
#
# Usage: sh scripts/fund-documents-on-homelab.sh count
#        sh scripts/fund-documents-on-homelab.sh copy|verify <release folder>
#        sh scripts/fund-documents-on-homelab.sh delete <release folder> --yes <number of rows>
#
# `<release folder>` is the one `scripts/release-dump.sh` printed, in `../Ledgerly-dumps/`: the copy
# of the files goes beside the dump (`files/`, `files.sha256`). The script (`scripts/fund-documents.ts`)
# runs in a throwaway Node container on the database's network, with the application's own
# environment; the checkout is mounted read-only and the release folder is the only place it writes.
set -eu
cd "$(dirname "$0")/.."
umask 077

command=${1:?usage: fund-documents-on-homelab.sh count | copy|verify|delete <release folder> [--yes <n>]}
shift
# `count` only reads: it gets no folder to write in.
if [ "$command" = "count" ]; then
  set --
  mount=""
else
  folder=$(cd "${1:?the release folder}" && pwd)
  shift
  mount="-v $folder:/out"
  set -- --out /out "$@"
fi
# shellcheck disable=SC2086 — `$mount` is two words or nothing.
sed -E "s/^([A-Za-z_][A-Za-z0-9_]*)='(.*)'\$/\\1=\\2/; s/^([A-Za-z_][A-Za-z0-9_]*)=\"(.*)\"\$/\\1=\\2/" .env.homelab |
  docker run --rm --network db_internal \
  --user "$(id -u):$(id -g)" -e HOME=/tmp \
  --env-file /dev/stdin \
  -v "$PWD":/app:ro $mount -w /app \
  node:26-bookworm-slim node --conditions=react-server --import tsx scripts/fund-documents.ts \
  "$command" "$@"
