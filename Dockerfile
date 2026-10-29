# syntax=docker/dockerfile:1

FROM node:26-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
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
RUN mkdir -p public && npm run build
RUN ./node_modules/.bin/esbuild scripts/migrate.ts --bundle --platform=node --format=esm --target=node26 \
      --external:pg-native \
      --banner:js="import{createRequire}from'node:module';const require=createRequire(import.meta.url);" \
      --outfile=migrate.mjs

FROM node:26-alpine AS runner
# `wget` for the healthcheck; `postgresql18-client` for the daily backup (spec §10.2), which runs
# `pg_dump -Fc` inside this container. The client may not be older than the server, and the
# homelab's server is Postgres 18 (`pgvector/pgvector:pg18`): on Alpine 3.24 this package is
# exactly 18.x, which is why no other base image and no extra container are needed.
RUN apk add --no-cache wget postgresql18-client
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=builder --chown=1000:1000 /app/.next/standalone ./
COPY --from=builder --chown=1000:1000 /app/.next/static ./.next/static
COPY --from=builder --chown=1000:1000 /app/public ./public
COPY --from=builder --chown=1000:1000 /app/migrate.mjs ./migrate.mjs
COPY --chown=1000:1000 drizzle ./drizzle
COPY --chown=1000:1000 entrypoint.sh ./entrypoint.sh
RUN chmod +x entrypoint.sh && mkdir -p .next/cache && chown -R 1000:1000 .next
USER 1000:1000
EXPOSE 3000
ENTRYPOINT ["/app/entrypoint.sh"]
