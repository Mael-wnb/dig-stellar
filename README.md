# Dig Stellar — DeFi Analytics and Multi-Wallet Dashboard

This repository contains the technical architecture and a minimal executable reference implementation for **Dig Stellar**: a Stellar-focused module designed to improve ecosystem visibility through **protocol analytics**, **multi-wallet portfolio monitoring**, **in-app alerting**, and **optional non-custodial action proposals**.

Dig uses a protocol-first approach (e.g., Blend, DeFindex, Aquarius, Soroswap) with a modular adapter layer. Data is sourced from **Stellar Horizon** (classic ledger activity) and **Soroban RPC** (contract state and events), enriched with protocol APIs/SDKs where available, and normalized into time-windowed snapshots.

## Primary document
- **Technical Architecture (single source of truth):** `docs/TECHNICAL_ARCHITECTURE.md`

## What’s in this repo
- **Postgres + Prisma** schema and migrations (`packages/db`)
- **NestJS API** exposing demo endpoints (`apps/api`)
- **Indexer** job proving end-to-end data flow (`apps/indexer`)
- Architecture documentation and diagrams (`docs/`)

## Quickstart (local)
Prereqs: Docker Desktop, Node 20+, pnpm

```bash
# Start Postgres/Redis
docker compose up -d

# Apply DB schema
cd packages/db
pnpm prisma:migrate
cd ../..

# Seed demo data (protocol, venue, snapshot)
pnpm -C apps/indexer run:once

# Start API
pnpm -C apps/api start:dev