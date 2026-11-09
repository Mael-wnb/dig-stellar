# Dig: Stellar DeFi Intelligence & Position Management Layer

> Integration-track application. An extension of Dig's existing Stellar work, built in the same
> monorepo on top of the indexing, analytics, transaction-builder and multi-wallet infrastructure
> in production on Stellar Mainnet.

## What this is

The unified management layer for Stellar DeFi: rank and compare every yield source across
lending, AMM liquidity, yield vaults, and tokenized real-world assets; manage positions deeply
on each protocol (lending on Blend and XOXNO Lending, LP, reward claims, vault allocation,
health factor); act in one click with non-custodial, in-wallet signing; and get alerted on
Telegram/Discord when a position needs attention.

## Relationship to the existing Stellar work

This scope does not start from scratch. It builds on infrastructure in production on Stellar
Mainnet since August 2026 and documented in the repository's main `docs/`:

- Hybrid Stellar RPC + Horizon indexing pipeline into a unified Postgres store, refreshed every 15 minutes
- Protocol read adapters for six protocols: Blend, Aquarius, Soroswap, DeFindex, SDEX, XOXNO Lending
- Grouped multi-wallet portfolio tracking, with one designated active signer and watch-only addresses that can never sign
- A non-custodial transaction builder (multi-op XDR, simulate, client-side validation against the declared intent, in-wallet signing), live on Stellar Mainnet for SDEX swaps and Blend supply/withdraw behind launch controls (kill-switch, per-transaction cap, issuer-verified asset whitelist)
- In-app alerting: five rule families (wallet health factor, asset price, pool TVL drop, pool supply and borrow APY, automatic pool-status protection) evaluated on a periodic 15-minute sweep against the indexed snapshots and delivered as in-app notifications; external delivery via Telegram and Discord is deliverable 1.3
- A public read API with an OpenAPI 3.1 contract served at `/v1/docs`, with the TypeScript SDK `@getdig/stellar-api` and the MCP server `@getdig/stellar-mcp` published on npm
- A public status page with per-run outcomes, missed cycles and upstream health
- An execution ledger of Horizon-verified on-chain actions (`action_witnesses`); the adoption commitment of deliverable 3.3 is counted on it, through `GET /v1/ops/adoption`

The work in this scope is **deep protocol execution, cross-category intelligence, Etherfuse RWA
integration, CCTP capital import, and external notification delivery** built on that foundation.

## Documents

- [`ARCHITECTURE.md`](./ARCHITECTURE.md): technical architecture and Stellar integration plan; the STRIDE threat model and the monitoring plan are in its §11
- [`milestones.md`](./milestones.md): 9 deliverables across 3 tranches (3 + 3 + 3), December 19, 2026 → March 20, 2027, $74,600 total (T1 $24,100 / T2 $27,600 / T3 $22,900)

## Core principle

Dig deploys **no custom contracts**. Every on-chain action is a direct call to an existing
protocol contract, so using Dig carries the same smart-contract risk as using each protocol's
own frontend; Dig adds aggregation, comparison, and pre-built transactions across protocols.

## Integration map

**Opportunity sources** (feed the intelligence layer):

| Building block | Role |
|---|---|
| Blend V2 | Lending: yield / health factor / BLND emissions |
| XOXNO Lending | Lending: supply, withdraw, repay / health factor |
| Aquarius | AMM liquidity: fees + AQUA emissions + bribes − impermanent loss |
| Soroswap | AMM liquidity |
| DeFindex | Yield vaults: auto-compound |
| Etherfuse Stablebonds (e.g., CETES, USTRY) | RWA real-yield (tokenized sovereign bonds) |
| SDEX | Native order book: limit orders |

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
| Deep protocol execution | `apps/api` + `apps/web` | Per-protocol actions (Blend claim/health-factor/rebalance, XOXNO Lending supply/withdraw/repay, Aquarius/Soroswap LP, DeFindex vaults, SDEX orders, Etherfuse buy/sell) |
| Etherfuse RWA | `apps/indexer` + `apps/api` | Stablebond indexing (balances, prices, accrued yield) + buy/sell |
| Cross-category intelligence | `apps/indexer` + `apps/api` | Scoring/ranking across all categories (incl. net-of-IL, bribe APR); serving endpoint |
| IL tracking | `apps/indexer` + `apps/api` | LP entry data (continuous + Hubble backfill), impermanent-loss computation |
| Capital import | `apps/api` + `apps/web` | CCTP burn → attestation → mint orchestration |
| Notifications | `apps/api` | External delivery via Telegram/Discord bots + rule model |
| Enriched portfolio | `apps/web` + `apps/api` | Lending/LP/stablebond position types, cross-protocol summary |
| Public API, SDK, MCP server | `apps/api` + `packages/sdk` + `packages/mcp` | In place today; the public read API, the SDK and the MCP server (built on the SDK) evolve on Dig's own initiative, outside this application's budget (`docs/post-grant-summary.md` §3) |

## Out of scope

Custom Soroban contracts deployed by Dig; mobile app; fiat on-ramp; social login / embedded
wallets (Privy, passkey); cross-chain rails beyond CCTP (Allbridge, Axelar, Near Intents);
automated execution without user signature; Aquarius governance voting.
