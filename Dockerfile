# syntax=docker/dockerfile:1

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN mkdir -p public && npm run build
RUN ./node_modules/.bin/esbuild scripts/migrate.ts --bundle --platform=node --format=esm --target=node22 \
      --external:pg-native \
      --banner:js="import{createRequire}from'node:module';const require=createRequire(import.meta.url);" \
      --outfile=migrate.mjs

FROM node:22-alpine AS runner
RUN apk add --no-cache wget
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
