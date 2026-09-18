#!/bin/sh
# scripts/on-homelab.sh — runs a Node script of this checkout next to the deployed app.
#
# Usage: sh scripts/on-homelab.sh scripts/<name>.ts [args…]
# The homelab's Postgres and Silo listen on the internal `db_internal` network only, so a script
# that needs them runs in a throwaway Node container on that network, with the application's own
# environment (`.env.homelab`). ADMIN_PASSWORD, when set, is passed through for create-admin.
set -eu
cd "$(dirname "$0")/.."
exec docker run --rm --network db_internal \
  --user "$(id -u):$(id -g)" -e HOME=/tmp \
  --env-file .env.homelab -e ADMIN_PASSWORD \
  -v "$PWD":/app -w /app \
  node:22-bookworm-slim node --conditions=react-server --import tsx "$@"
