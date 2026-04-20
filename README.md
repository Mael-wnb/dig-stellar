# Dig Stellar — Unified DeFi Analytics and Multi-Wallet Monitoring on Stellar

**Dig Stellar** is a Stellar-focused analytics and portfolio monitoring module designed to make DeFi activity across the ecosystem easier to understand, follow, and eventually act on.

The project combines:
- **protocol analytics**
- **pool-level monitoring**
- **multi-wallet portfolio tracking**
- **normalized on-chain data pipelines**
- the foundation for future **alerts** and **non-custodial action flows**

The current repository contains the technical implementation of the Dig Stellar beta, including the data layer, API layer, and frontend application already connected to live Stellar data.

---

## Live beta

- **Frontend:** https://stellar.getdig.ai/
- **API:** https://stellar-api.getdig.ai/

---

## Why Dig Stellar

As the Stellar ecosystem grows with Soroban-based DeFi protocols, users increasingly need a clearer way to:

- understand protocol activity
- compare pools across venues
- monitor wallet balances across multiple wallets
- track exposure over time
- eventually receive relevant alerts and execute guided actions safely

Today, this information is fragmented across protocols, explorers, wallets, and raw on-chain data sources.

**Dig Stellar** aims to provide a unified monitoring and analytics layer for Stellar DeFi.

---

## Current beta scope

The current beta focuses on shipping a credible and usable first version of that vision.

### Already implemented
- **Protocol analytics**
  - live protocol list
  - normalized protocol metrics
  - pool-level detail pages
  - support for multiple Stellar DeFi venues

- **Integrated protocols**
  - **Blend**
  - **Aquarius**
  - **Soroswap**

- **Multi-wallet monitoring**
  - wallet connection flow
  - backend-resolved user grouping
  - multi-wallet account structure
  - wallet overview
  - on-demand wallet balance refresh

- **Live data pipeline**
  - scheduled refresh jobs
  - protocol metrics refresh
  - pool snapshots
  - asset price references
  - derived pricing for selected assets

- **Production-ready beta deployment**
  - public frontend deployment
  - live API
  - background refresh jobs
  - persistent Postgres database

### Intentionally not fully in scope yet
These are part of the product direction, but not required for the current beta release:
- advanced alerting workflows
- persistent user-defined monitoring rules
- fully production-grade ownership verification / signed wallet auth
- direct in-app execution of non-custodial actions
- advanced protocol position decomposition for all strategies

---

## Product direction

Dig Stellar is not intended to be only a protocol integration showcase.

The broader goal is to build a **unified DeFi intelligence and monitoring layer** for Stellar composed of four pillars:

### 1. Unified analytics
A common view over protocol- and pool-level metrics, regardless of venue-specific data structures.

### 2. Multi-wallet portfolio monitoring
A user can monitor multiple wallets under one backend identity and inspect balances across them without relying on a hardcoded frontend profile model.

### 3. Monitoring and alerts
The normalized data model is designed to support future alerting use cases such as:
- unusual liquidity movements
- volume spikes
- wallet balance changes
- protocol-level risk signals
- meaningful changes in pool state

### 4. Non-custodial action layer
The long-term product direction includes guided, non-custodial actions such as:
- rebalance suggestions
- deposit / withdraw proposals
- swap proposals
- action previews driven by protocol-aware logic

The current beta does not yet expose the full action layer, but the architecture is intentionally moving in that direction.

---

## Architecture overview

The repository is structured as a monorepo with three main applications:

### `apps/web`
Vue / Vite frontend for:
- protocol browsing
- pool detail views
- dashboard surfaces
- wallet connection and multi-wallet monitoring

### `apps/api`
NestJS backend acting as the single application-facing API for the frontend.

Responsibilities include:
- protocol and pool endpoints
- wallet endpoints
- network stats endpoint
- wallet refresh orchestration
- normalized data serving from Postgres

### `apps/indexer`
Batch jobs and ingestion scripts responsible for:
- protocol refresh
- pool snapshots
- reserve snapshots
- price ingestion / derived pricing
- protocol metrics refresh
- wallet balance snapshots

### Database
Postgres is used as the main storage layer for:
- venues
- entities / pools
- assets
- normalized events
- reserve snapshots
- asset prices
- latest protocol / pool metrics
- wallet balances
- wallet protocol positions

---

## Data model philosophy

Different Stellar DeFi protocols expose very different raw structures.

Dig Stellar uses a **normalized internal model** so the frontend and monitoring layer can work with a unified shape.

Main concepts:
- **venues** → protocols / execution venues
- **entities** → pools / markets / tracked protocol objects
- **assets** → underlying tokens
- **entity_assets** → relationships between pools and assets
- **normalized_events** → protocol events mapped to a common format
- **reserve_snapshots** → point-in-time reserve state
- **pool_metrics_latest** → latest computed pool metrics
- **protocol_metrics_latest** → latest computed venue/protocol metrics
- **wallet_balance_snapshots** → tracked wallet balances over time
- **wallet_protocol_positions** → future foundation for wallet-level protocol exposure

This normalization is a key part of the project value: it enables monitoring, analytics, and later alerts/actions without rewriting each product surface protocol by protocol.

---

## Current protocol coverage

### Blend
Used for lending pool state, reserves, and lending metrics.

### Aquarius
Used for AMM pool state, reserve tracking, event-derived activity, and metrics.

### Soroswap
Used for AMM pair state, event normalization, and pool-level metrics.

---

## Repository structure

```text
apps/
  api/        NestJS API
  indexer/    Stellar data ingestion / refresh jobs
  web/        Vue / Vite frontend

packages/
  db/         Prisma schema and database-related package remnants

docs/
  TECHNICAL_ARCHITECTURE.md