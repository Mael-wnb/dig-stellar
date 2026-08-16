# Dig — Stellar DeFi Intelligence & Position Management Layer

> Accelerator scope. An extension of Dig's existing Stellar work (SCF 43), built in the same
> monorepo on top of the already-delivered indexing, analytics, transaction-builder, and
> multi-wallet infrastructure.

## What this is

The unified management layer for Stellar DeFi: rank and compare every yield source across
lending, AMM liquidity, yield vaults, and tokenized real-world assets; manage positions deeply
on each protocol (backstop, LP, reward claims, vault allocation, health-factor); act in one
click with non-custodial, in-wallet signing; and get alerted on Telegram/Discord when a
position needs attention.

## Relationship to the existing Stellar work (SCF 43)

This scope does not start from scratch. It builds on infrastructure already delivered under
SCF 43, documented in the repository's main `docs/`:

- Hybrid Horizon + Soroban RPC indexing pipeline into a unified Postgres store
- Protocol read adapters for Blend, Aquarius, Soroswap, DeFindex, SDEX
- Grouped multi-wallet portfolio tracking
- A non-custodial transaction builder (multi-op XDR, simulate, in-wallet signing), proven on Testnet
- In-app alerting (rule evaluation + WebSocket delivery)

The work in this scope is **deep protocol execution, cross-category intelligence, Etherfuse RWA
integration, CCTP capital import, and external notification delivery** built on that foundation.

## Documents

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — technical architecture and Stellar integration plan (with a reviewer FAQ)
- [`milestones.md`](./milestones.md) — deliverables by tranche

## Core principle

Dig deploys **no custom contracts**. Every on-chain action is a direct call to an existing
protocol contract, so using Dig carries the same smart-contract risk as using each protocol's
own frontend — Dig adds aggregation, comparison, and pre-built transactions across protocols.

## Integration map

**Opportunity sources** (feed the intelligence layer):

| Building block | Role |
|---|---|
| Blend V2 | Lending + backstop — yield / health-factor / BLND emissions |
| Aquarius | AMM liquidity — fees + AQUA emissions + bribes − impermanent loss |
| Soroswap | AMM liquidity |
| DeFindex | Yield vaults — auto-compound |
| Etherfuse Stablebonds (e.g., CETES, USTRY) | RWA real-yield (tokenized sovereign bonds) |
| SDEX | Native order book — limit orders |

**Execution & onboarding rails**:

| Building block | Role |
|---|---|
| Stellar Wallets Kit + Freighter | In-wallet signing (in place) |
| Circle CCTP | Native USDC cross-chain import (burn-and-mint) |
| Telegram / Discord bots | External alert delivery, deep-linking to pre-built actions on Dig |

## Where the code lives

This scope extends the existing monorepo; it does not introduce a new project.

| Layer | App | What gets added |
|---|---|---|
| Deep protocol execution | `apps/api` + `apps/web` | Per-protocol actions (Blend backstop/claim/rebalance, Aquarius/Soroswap LP, DeFindex vaults, SDEX orders, Etherfuse buy/sell) |
| Etherfuse RWA | `apps/indexer` + `apps/api` | Stablebond indexing (balances, prices, accrued yield) + buy/sell |
| Cross-category intelligence | `apps/indexer` + `apps/api` | Scoring/ranking across all categories (incl. net-of-IL, bribe APR); serving endpoint |
| IL tracking | `apps/indexer` + `apps/api` | LP entry data (continuous + Hubble backfill), impermanent-loss computation |
| Capital import | `apps/api` + `apps/web` | CCTP burn → attestation → mint orchestration |
| Notifications | `apps/api` | External delivery via Telegram/Discord bots + rule model |
| Enriched portfolio | `apps/web` + `apps/api` | Backstop/LP/stablebond position types, cross-protocol summary |

## Out of scope

Custom Soroban contracts deployed by Dig; mobile app; fiat on-ramp; social login / embedded
wallets (Privy, passkey); cross-chain rails beyond CCTP (Allbridge, Axelar); automated execution
without user signature; Aquarius governance voting.