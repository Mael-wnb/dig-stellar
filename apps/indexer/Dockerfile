# apps/indexer/Dockerfile — reference-implementation ingestion image (Lot Z — T3-D3).
#
# Build from the REPO ROOT (pnpm workspace context):
#   docker build -f apps/indexer/Dockerfile .
# docker-compose.yml does this for you (service `indexer`, profile `app`).
#
# The container replaces the VPS 15-min cron+flock with a sequential in-container
# loop (self-excluding by construction — a run can never overlap itself):
# bootstrap the vetted perimeter, run one refresh immediately, then refresh every
# REFRESH_INTERVAL_SECONDS. See docker-entrypoint.sh. The runner is tsx (no build
# step), so this is a single-stage image.
#
# Base is bookworm-slim (not alpine): Prisma's query engine targets
# debian-openssl-3.0.x out of the box — one less platform variable.

FROM node:20-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g pnpm@10.32.1
WORKDIR /app

# Manifests first — keeps the dependency layer cached across source edits.
# api/web package.json files are copied only so the workspace matches
# pnpm-lock.yaml; their dependencies are not installed.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/indexer/package.json apps/indexer/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/db/package.json packages/db/package.json
RUN pnpm install --frozen-lockfile --filter indexer --filter db

# Legacy runners (run:blend / run:horizon / run:once) import @prisma/client;
# generate it so every documented script works, not just job:refresh.
COPY packages/db/prisma packages/db/prisma
RUN pnpm -C packages/db run prisma:generate

COPY apps/indexer apps/indexer

ENV REFRESH_INTERVAL_SECONDS=900
USER node
CMD ["sh", "apps/indexer/docker-entrypoint.sh"]
