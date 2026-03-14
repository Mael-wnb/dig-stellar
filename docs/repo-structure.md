# Repository Structure

This repository is organized as a small monorepo that combines documentation and a minimal executable reference implementation.

## apps/
- **apps/api**: NestJS REST API serving protocols, venues, and snapshots from Postgres
- **apps/indexer**: indexing jobs (run-once + scheduled) writing normalized data into Postgres
- **apps/web** (optional): lightweight demo UI for wallet connection and dashboard calls

## packages/
- **packages/db**: Prisma schema and migrations for Postgres
- **packages/core** (optional): shared types and schemas for the unified model
- **packages/adapters** (optional): protocol adapters and bridge adapters

## Where to look
- **Primary architecture doc**: `docs/TECHNICAL_ARCHITECTURE.md`
- **Data model**: `packages/db/prisma/schema.prisma`
- **Blend job**: `apps/indexer/src/run-blend.ts`
- **Horizon job**: `apps/indexer/src/run-horizon.ts`
- **API endpoints**: `apps/api/src/app.controller.ts`

## Common commands
- Apply DB schema: `cd packages/db && pnpm prisma:migrate`
- Run Blend job: `pnpm -C apps/indexer run:blend`
- Run Horizon job: `pnpm -C apps/indexer run:horizon`
- Optional seed job: `pnpm -C apps/indexer run:once`
- Start API: `pnpm -C apps/api start:dev`

## Extending the system
To add a new protocol integration:
1) create an adapter (API/SDK/RPC)
2) map outputs into the unified entities (Protocol, Venue, Snapshot)
3) schedule a job to refresh snapshots (e.g., every 5–15 minutes)
4) expose data via API endpoints