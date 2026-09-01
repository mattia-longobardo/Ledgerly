#!/bin/sh
set -e

if [ "$#" -gt 0 ]; then
    exec "$@"
fi

cd /app

echo "[entrypoint] applying Drizzle migrations from /app/drizzle ..."
node /app/migrate.mjs
echo "[entrypoint] schema is up to date."

echo "[entrypoint] starting Next.js standalone server on ${HOSTNAME}:${PORT} ..."
exec node server.js
