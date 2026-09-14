#!/bin/sh
# tests/e2e/serve.sh — migrate the e2e database and run the standalone build (run `npm run build` first).
set -e
node --conditions=react-server --import tsx scripts/migrate.ts
mkdir -p public .next/standalone/.next
cp -r public .next/standalone/
cp -r .next/static .next/standalone/.next/
exec node .next/standalone/server.js
