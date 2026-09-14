#!/bin/sh
# entrypoint.sh — apply migrations, then serve. Arguments run instead (e.g. `node /app/migrate.mjs`).
set -e
if [ "$#" -gt 0 ]; then
  exec "$@"
fi
node /app/migrate.mjs
exec node /app/server.js
