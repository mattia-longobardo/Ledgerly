# syntax=docker/dockerfile:1
# `ledgerly-egress` (docs/operations.md, "Plugins"): the plugins' forward proxy. Built from the
# repository root (docker-compose.yml: `context: .`). No install and no build: the proxy imports
# `node:*` only, and Node runs its TypeScript by stripping the types. The catalog is the one the
# core reads: the same file decides what the core calls and where each plugin may go.

FROM node:26-alpine
WORKDIR /app
ENV NODE_ENV=production EGRESS_PORT=3128 EGRESS_ADMIN_PORT=8081 EGRESS_CATALOG=/app/catalog.json
COPY --chown=1000:1000 apps/egress/src ./src
COPY --chown=1000:1000 packages/domain/src/platform/plugins/catalog.json ./catalog.json
RUN rm -f src/*.test.ts
USER 1000:1000
EXPOSE 3128 8081
ENTRYPOINT ["node", "/app/src/server.ts"]
