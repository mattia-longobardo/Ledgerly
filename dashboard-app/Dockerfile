# syntax=docker/dockerfile:1

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 \
    NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN mkdir -p public && npm run build
RUN ./node_modules/.bin/esbuild src/lib/db/migrate.ts \
      --bundle \
      --platform=node \
      --format=esm \
      --target=node22 \
      --external:pg-native \
      --external:cloudflare:sockets \
      --banner:js="import{createRequire as __nodeRequire}from'node:module';const require=__nodeRequire(import.meta.url);" \
      --outfile=migrate.mjs
# The file-credentials importer is a one-off, hand-run migration: it ships
# with the image so the runbook can exec it against the live database, and
# it is never part of the entrypoint.
RUN ./node_modules/.bin/esbuild scripts/import-file-credentials.ts \
      --bundle \
      --platform=node \
      --format=esm \
      --target=node22 \
      --external:pg-native \
      --external:cloudflare:sockets \
      --banner:js="import{createRequire as __nodeRequire}from'node:module';const require=__nodeRequire(import.meta.url);" \
      --outfile=import-file-credentials.mjs

FROM node:22-alpine AS runner
RUN apk add --no-cache wget
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
COPY --from=builder --chown=1000:1000 /app/.next/standalone ./
COPY --from=builder --chown=1000:1000 /app/.next/static ./.next/static
COPY --from=builder --chown=1000:1000 /app/public ./public
COPY --from=builder --chown=1000:1000 /app/migrate.mjs ./migrate.mjs
COPY --from=builder --chown=1000:1000 /app/import-file-credentials.mjs ./import-file-credentials.mjs
COPY --chown=1000:1000 drizzle ./drizzle
COPY --chown=1000:1000 entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh && mkdir -p /app/.next/cache && chown -R 1000:1000 /app/.next
USER 1000:1000
EXPOSE 3000
ENTRYPOINT ["/app/entrypoint.sh"]
