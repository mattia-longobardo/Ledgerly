#!/bin/sh
# scripts/on-homelab.sh — runs a Node script of this checkout next to the deployed app.
#
# Usage: sh scripts/on-homelab.sh scripts/<name>.ts [args…]
# The homelab's Postgres and Silo listen on the internal `db_internal` network only, so a script
# that needs them runs in a throwaway Node container on that network, with the application's own
# environment (`.env.homelab`). ADMIN_PASSWORD, when set, is passed through for create-admin.
# `docker run --env-file` keeps the quotes around a quoted value, which Compose drops: the file is
# passed on stdin with one pair of quotes removed, so both read the same values.
set -eu
cd "$(dirname "$0")/.."
sed -E "s/^([A-Za-z_][A-Za-z0-9_]*)='(.*)'\$/\\1=\\2/; s/^([A-Za-z_][A-Za-z0-9_]*)=\"(.*)\"\$/\\1=\\2/" .env.homelab |
  exec docker run --rm --network db_internal \
  --user "$(id -u):$(id -g)" -e HOME=/tmp \
  --env-file /dev/stdin -e ADMIN_PASSWORD \
  -v "$PWD":/app -w /app \
  node:26-bookworm-slim node --conditions=react-server --import tsx "$@"
