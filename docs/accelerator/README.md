# Dig — Stellar DeFi Intelligence & Execution Gateway

> Accelerator scope. This is an extension of Dig's existing Stellar work (SCF 43),
> built in the same monorepo on top of the already-delivered indexing, analytics, and
> multi-wallet infrastructure.

## What this is

The simplest gateway to Stellar DeFi: an intelligence layer that detects, scores, and ranks
yield and liquidity opportunities across the ecosystem; a frictionless onboarding and
non-custodial execution layer so users can act in one click; and native cross-chain USDC
onboarding to bring external capital into Stellar.

## Relationship to the existing Stellar work (SCF 43)

This scope does not start from scratch. It builds on infrastructure already delivered under
SCF 43, documented in the repository's main `docs/`:

- Hybrid Horizon + Soroban RPC indexing pipeline into a unified Postgres store
- Protocol analytics for integrated protocols (Blend, Aquarius, Soroswap) served via the API
- Grouped multi-wallet portfolio tracking
- A non-custodial transaction builder (multi-op XDR, in-wallet signing via Stellar Wallets Kit)

The work in this scope is the **intelligence, onboarding, execution, cross-chain, notification,
and mobile layers** built on that foundation.

## Documents

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — technical architecture and Stellar integration plan
- [`milestones.md`](./milestones.md) — deliverables by tranche

## Integration map

Two families of integrations structure the work:

**Opportunity sources** (feed the intelligence layer, reuse the existing indexing pipeline):

| Building block | Role |
|---|---|
| Blend | Lending markets — yield / risk signals |
| Aquarius | AMM pools — yield / liquidity |
| Soroswap | AMM pools — yield / liquidity |
| DeFindex | Yield vaults — aggregated strategy yield |

**Execution & onboarding rails** (enable users to act):

| Building block | Role |
|---|---|
| Stellar Wallets Kit + Freighter | In-wallet signing for crypto-native users (in place) |
| Privy | Email / social / passkey onboarding → self-custodial embedded wallet |
| Circle CCTP | Native USDC cross-chain onboarding (burn-and-mint) |
| Allbridge Core | Broader stablecoin / source-chain cross-chain onboarding |

## Where the code lives

This scope extends the existing monorepo; it does not introduce a new project.

| Layer | App | What gets added |
|---|---|---|
| Intelligence engine | `apps/indexer` + `apps/api` | Opportunity scoring/ranking over normalized metrics; serving endpoint |
| Discovery UI | `apps/web` | Ranked opportunity feed, filters, detail views |
| Onboarding | `apps/web` + `apps/api` | Privy embedded-wallet integration alongside Wallets Kit |
| Execution | `apps/api` + `apps/web` | One-click action from opportunity → builder → in-wallet sign |
| Cross-chain | `apps/api` + `apps/web` | CCTP + Allbridge onboarding into a Stellar opportunity |
| Notifications | `apps/api` | Rule model + evaluator + multi-channel delivery (in-app, Telegram, Discord) |
| Mobile | new shell over `apps/web` | Capacitor read-only monitoring app + native push |