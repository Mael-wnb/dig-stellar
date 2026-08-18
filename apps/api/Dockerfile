# apps/api/Dockerfile — reference-implementation API image (Lot Z — T3-D3).
#
# Build from the REPO ROOT (pnpm workspace context):
#   docker build -f apps/api/Dockerfile .
# docker-compose.yml does this for you (service `api`, profile `app`).
#
# The runtime stage deliberately carries apps/indexer (source + deps + pnpm/tsx):
# the wallet on-demand refresh (WalletsService.runIndexerWalletScript) spawns
# `pnpm tsx` inside the indexer package — INDEXER_DIR points there. Packaging
# only; zero product-logic changes in this lot.
#
# Base is bookworm-slim (not alpine): Prisma's query engine targets
# debian-openssl-3.0.x out of the box — one less platform variable.

FROM node:20-bookworm-slim AS build
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g pnpm@10.32.1
WORKDIR /app

# Manifests first — keeps the dependency layer cached across source edits.
# apps/web/package.json is copied only so the workspace matches pnpm-lock.yaml;
# its dependencies are not installed (web is NOT part of the compose stack).
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/indexer/package.json apps/indexer/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/db/package.json packages/db/package.json
RUN pnpm install --frozen-lockfile --filter api --filter indexer --filter db

# @prisma/client is imported by the api; the schema lives in packages/db.
COPY packages/db/prisma packages/db/prisma
RUN pnpm -C packages/db run prisma:generate

COPY apps/indexer apps/indexer
COPY apps/api apps/api
RUN pnpm -C apps/api run build

FROM node:20-bookworm-slim AS runtime
# wget: container healthcheck against GET /health.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates wget \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g pnpm@10.32.1
WORKDIR /app

# GIT_SHA surfaces as `version` in GET /health ('unknown' when unset).
ARG GIT_SHA=""
ENV GIT_SHA=${GIT_SHA} \
    NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    INDEXER_DIR=/app/apps/indexer

COPY --from=build --chown=node:node /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/packages ./packages
COPY --from=build --chown=node:node /app/apps/indexer ./apps/indexer
COPY --from=build --chown=node:node /app/apps/api/package.json ./apps/api/package.json
COPY --from=build --chown=node:node /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build --chown=node:node /app/apps/api/dist ./apps/api/dist

USER node
EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]
