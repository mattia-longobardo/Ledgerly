# syntax=docker/dockerfile:1

FROM node:26-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# The workspaces (R0): the install links each one by its `package.json`.
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY apps/worker/package.json ./apps/worker/
COPY packages/api-contract/package.json ./packages/api-contract/
COPY packages/domain/package.json ./packages/domain/
COPY packages/plugin-contract/package.json ./packages/plugin-contract/
COPY packages/plugin-host/package.json ./packages/plugin-host/
COPY plugins/enablebanking/package.json ./plugins/enablebanking/
COPY plugins/prices/package.json ./plugins/prices/
# No install scripts (PERS-87 SEC-04): a dependency's `postinstall` (ccxt's, today a banner) never
# runs at build time. Nothing needs one: esbuild, @swc/core and the other native packages find
# their platform binary in the optional dependency npm already installed, and `npm run build`
# below and the esbuild step after it fail the build if one does not.
RUN npm ci --ignore-scripts

FROM node:26-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN mkdir -p apps/web/public && npm run build
RUN ./node_modules/.bin/esbuild scripts/migrate.ts --bundle --platform=node --format=esm --target=node26 \
      --external:pg-native \
      --banner:js="import{createRequire}from'node:module';const require=createRequire(import.meta.url);" \
      --outfile=migrate.mjs
# The worker (rewrite plan R1): the jobs of `apps/web` and its own loop, in one file. `ccxt` and the
# native `argon2` stay outside: Next has traced them into the standalone `node_modules` it runs on.
RUN ./node_modules/.bin/esbuild apps/worker/src/main.ts --bundle --platform=node --format=esm --target=node26 \
      --external:pg-native --external:ccxt --external:@node-rs/argon2 \
      --alias:server-only=./test/server-only.ts \
      --banner:js="import{createRequire}from'node:module';const require=createRequire(import.meta.url);" \
      --outfile=worker.mjs

# The interface (rewrite plan R4): the same build, without the migrations, the worker, the SQL files
# and the database client. Its environment has no database address and no key of the server
# (`docker-compose.yml`, service `ledgerly-web`); `LEDGERLY_ROLE=web` keeps the checks of the
# server's environment out of its start (`apps/web/src/instrumentation.ts`).
FROM node:26-alpine AS web
RUN apk add --no-cache wget
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 LEDGERLY_ROLE=web
COPY --from=builder --chown=1000:1000 /app/apps/web/.next/standalone ./
COPY --from=builder --chown=1000:1000 /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=1000:1000 /app/apps/web/public ./apps/web/public
RUN mkdir -p apps/web/.next/cache && chown -R 1000:1000 apps/web/.next
USER 1000:1000
EXPOSE 3000
CMD ["node", "/app/apps/web/server.js"]

# The server (`ledgerly` and `ledgerly-worker`): `/api`, `/.well-known`, the migrations and the jobs.
# Last, so a build without a target (the preview, `scripts/preview-on-test.sh`) is this one.
FROM node:26-alpine AS server
# `wget` for the healthcheck; `postgresql18-client` for the daily backup (spec §10.2), which runs
# `pg_dump -Fc` inside this container. The client may not be older than the server, and the
# homelab's server is Postgres 18 (`pgvector/pgvector:pg18`): on Alpine 3.24 this package is
# exactly 18.x, which is why no other base image and no extra container are needed.
RUN apk add --no-cache wget postgresql18-client
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
# The app is the workspace `apps/web` (R0): its standalone output keeps the monorepo's layout.
COPY --from=builder --chown=1000:1000 /app/apps/web/.next/standalone ./
COPY --from=builder --chown=1000:1000 /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=1000:1000 /app/apps/web/public ./apps/web/public
COPY --from=builder --chown=1000:1000 /app/migrate.mjs ./migrate.mjs
COPY --from=builder --chown=1000:1000 /app/worker.mjs ./worker.mjs
COPY --chown=1000:1000 drizzle ./drizzle
COPY --chown=1000:1000 entrypoint.sh ./entrypoint.sh
RUN chmod +x entrypoint.sh && mkdir -p apps/web/.next/cache && chown -R 1000:1000 apps/web/.next
USER 1000:1000
EXPOSE 3000
ENTRYPOINT ["/app/entrypoint.sh"]
