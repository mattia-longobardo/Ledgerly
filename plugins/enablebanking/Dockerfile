# syntax=docker/dockerfile:1
# Built from the repository root (docker-compose.yml: `context: .`): the plugin shares the
# contract with the core (the workspace `packages/plugin-contract`) and is bundled into one file, so the
# image that runs has no `node_modules`, no source and no shell script of its own.

FROM node:26-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/plugin-contract/package.json ./packages/plugin-contract/
COPY plugins/enablebanking/package.json ./plugins/enablebanking/
RUN npm ci --ignore-scripts

FROM node:26-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY packages/plugin-contract ./packages/plugin-contract
COPY plugins/enablebanking ./plugins/enablebanking
RUN ./node_modules/.bin/esbuild plugins/enablebanking/src/server.ts --bundle --platform=node --format=esm \
      --target=node26 --outfile=server.mjs

FROM node:26-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production PORT=8787
COPY --from=builder --chown=1000:1000 /app/server.mjs ./server.mjs
USER 1000:1000
EXPOSE 8787
ENTRYPOINT ["node", "/app/server.mjs"]
