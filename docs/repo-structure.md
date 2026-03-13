# Repository Structure

This repository is organized as a small monorepo that combines documentation and a minimal executable reference implementation.

## apps/
- **apps/api**: NestJS REST API serving protocols, venues, and snapshots from Postgres
- **apps/indexer**: indexing jobs (run-once + scheduled) writing normalized data into Postgres
- **apps/web**: lightweight demo UI for wallet connection and dashboard calls

## packages/
- **packages/db**: Prisma schema and migrations for Postgres
- **packages/core**: shared types and schemas for the unified model
- **packages/adapters**: protocol adapters (Blend, DeFindex, Soroswap, Aquarius) and bridge adapters

## Where to look
- **Data model**: `packages/db/prisma/schema.prisma`
- **Indexer entrypoint**: `apps/indexer/src/run-once.ts`
- **API endpoints**: `apps/api/src/app.controller.ts`
- **Primary architecture doc**: `docs/TECHNICAL_ARCHITECTURE.md`

## Common commands
- Apply DB schema: `cd packages/db && pnpm prisma:migrate`
- Run indexer: `pnpm -C apps/indexer run:once`
- Start API: `pnpm -C apps/api start:dev`

## Extending the system
To add a new protocol integration:
1) create an adapter (API/SDK/RPC)
2) map outputs into the unified entities (Protocol, Venue, Snapshot)
3) schedule a job to refresh snapshots (e.g., every 5–15 minutes)
4) expose data via API endpoints