# Dig Stellar — DeFi Analytics & Portfolio Dashboard (Architecture + Demo)

This repository contains a **technical architecture** and a minimal **executable reference implementation** for Dig’s Stellar module. The goal is to increase Stellar ecosystem visibility through **protocol analytics**, **multi-wallet portfolio monitoring**, **alerting**, and **optional non-custodial actions** (guided interactions where supported).

Key integrations are **protocol-first** and modular (e.g., Blend, DeFindex, Aquarius, Soroswap; bridge flows via Allbridge with optional extensions). Data is collected from **Stellar Horizon** (classic ledger activity) and **Soroban RPC** (contract state and events), enriched with protocol APIs/SDKs where available, and normalized into time-windowed snapshots.

## What’s included
- Architecture diagrams (high-level + closer looks)
- Unified data model (Protocol / Venue / Snapshot / Position / Alert)
- Working local stack: **Postgres + Prisma + Nest API + Indexer**
- Minimal endpoints to expose analytics data

## Quickstart (local)
Prereqs: Docker Desktop, Node 20+, pnpm

```bash
# 1) Start Postgres/Redis
docker compose up -d

# 2) Database migration
cd packages/db
pnpm prisma:migrate
cd ../..

# 3) Run a demo indexing job (writes protocol/venue/snapshot)
pnpm -C apps/indexer run:once

# 4) Start the API
pnpm -C apps/api start:dev
