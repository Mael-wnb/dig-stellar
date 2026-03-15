# Dig Stellar — DeFi Analytics and Multi-Wallet Dashboard

This repository contains the technical architecture and a minimal executable reference implementation for **Dig Stellar**: a Stellar-focused module designed to improve ecosystem visibility through **protocol analytics**, **multi-wallet portfolio monitoring**, **in-app alerting**, and **optional non-custodial action proposals**.

Dig uses a protocol-first approach (e.g., Blend, DeFindex, Aquarius, Soroswap) with a modular adapter layer. Data is sourced from **Stellar Horizon** (classic ledger activity) and **Soroban RPC** (contract state and events), enriched with protocol APIs/SDKs where available, and normalized into time-windowed snapshots.

## Primary document
- **Technical Architecture (single source of truth):** `docs/TECHNICAL_ARCHITECTURE.md`

## Product visuals
Complementary UI/UX mockups for the Dig Stellar module:
- **Overview / Portfolio dashboard**: [Google Drive link](https://drive.google.com/file/d/12oofXWmeZxFOT6-ZyDXC7IUUuTE86pe-/view?usp=sharing)
- **Protocol analytics / detail page**: [Google Drive link](https://drive.google.com/file/d/1aNWgVppsrBu6yjX1cSCPUKFvNpnH2BFN/view?usp=sharing)

## What’s in this repo
- **Postgres + Prisma** schema and migrations (`packages/db`)
- **NestJS API** exposing demo endpoints (`apps/api`)
- **Indexer** job proving end-to-end data flow (`apps/indexer`)
- Architecture documentation and diagrams (`docs/`)

## Quickstart (local)
Prereqs: Docker Desktop, Node 20+, pnpm

### 1) Start services
```bash
docker compose up -d
```
### 2) Apply DB 
```bash
cd packages/db
pnpm prisma:migrate
cd ../..
```

### 3) Configure the indexer

Create apps/indexer/.env:

```bash
STELLAR_RPC_URL="https://soroban-rpc.mainnet.stellar.gateway.fm"
STELLAR_NETWORK_PASSPHRASE="Public Global Stellar Network ; September 2015"
BLEND_POOL_ID="CCCCIQSDILITHMM7PBSLVDT5MISSY7R26MNZXCX4H7J5JQ5FPIYOGYFS"
DATABASE_URL="postgresql://dig:dig@localhost:5432/dig_stellar?schema=public"
HORIZON_URL="https://horizon.stellar.org"
```

### 4) Run the Blend indexing job
```bash
pnpm -C apps/indexer run:blend
```

### 5) Run the Blend indexing job
```bash
pnpm -C apps/indexer run:horizon
```

(Optional smoke test)

```bash
pnpm -C apps/indexer run:once
```

### 6) Start the API
```bash
pnpm -C apps/api start:dev
```

### 7) Test
```bash
curl http://localhost:3000/health

curl "http://localhost:3000/venues?protocol=blend"
curl "http://localhost:3000/venues/blend:pool:CCCCIQSDILITHMM7PBSLVDT5MISSY7R26MNZXCX4H7J5JQ5FPIYOGYFS/snapshots?limit=1"

curl "http://localhost:3000/venues?protocol=stellar"
curl "http://localhost:3000/venues/horizon:network-activity/snapshots?limit=1"
```