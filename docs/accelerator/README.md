# Dig — Stellar Real-Yield Intelligence & Execution Gateway

> Accelerator scope. An extension of Dig's existing Stellar work (SCF 43), built in the same
> monorepo on top of the already-delivered indexing, analytics, and multi-wallet infrastructure.

## What this is

The simplest way for a user to discover and act on Stellar's real-yield economy: an intelligence
layer that surfaces and ranks real-yield and RWA opportunities; passkey-based smart-wallet
onboarding (biometric signing, no seed phrase, sponsored fees and reserves); one-click
non-custodial execution on web and mobile; and capital onboarding from both crypto (CCTP) and
fiat (partner on-ramp).

## Relationship to the existing Stellar work (SCF 43)

This scope does not start from scratch. It builds on infrastructure already delivered under
SCF 43, documented in the repository's main `docs/`:

- Hybrid Horizon + Soroban RPC indexing pipeline into a unified Postgres store
- Protocol analytics for integrated protocols served via the API
- Grouped multi-wallet portfolio tracking
- A non-custodial transaction builder (multi-op XDR, in-wallet signing), proven on Testnet

The work in this scope is the **real-yield/RWA intelligence, passkey onboarding, one-click
execution, capital onboarding, notification, and mobile-execution layers** built on that foundation.

## Documents

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — technical architecture and Stellar integration plan (with a reviewer FAQ)
- [`milestones.md`](./milestones.md) — deliverables by tranche

## Integration map

**Opportunity sources** (feed the intelligence layer; real-yield / RWA first-class):

| Building block | Role |
|---|---|
| Tokenized treasuries / MMFs (e.g., Franklin Templeton BENJI, Ondo USDY) | RWA real-yield — primary category |
| Etherfuse Stablebonds (e.g., CETES, USTRY) | RWA real-yield (sovereign-bond) |
| Templar | RWA-collateralized lending |
| Blend | Native lending — yield / risk signals |
| Soroswap / Aquarius / DeFindex | AMM / vaults (secondary) |

**Identity, execution & onboarding rails**:

| Building block | Role |
|---|---|
| Passkey smart wallets (passkey-kit) | Primary Stellar identity — biometric signing, no seed |
| Launchtube + sponsored reserves (CAP-33) | Fee and account-reserve sponsorship for users with no XLM |
| Stellar Wallets Kit + Freighter | In-wallet signing for crypto-native users (in place) |
| Privy | Multi-chain source wallet for the CCTP flow |
| Circle CCTP | Native USDC cross-chain onboarding (burn-and-mint) |
| Fiat on-ramp (SEP-24 anchor / third-party widget) | Fiat → USDC, provider carries KYC/AML/licensing |

> Allbridge Core is tracked as a stretch extension, not a core deliverable.

## Where the code lives

This scope extends the existing monorepo; it does not introduce a new project.

| Layer | App | What gets added |
|---|---|---|
| Real-yield intelligence | `apps/indexer` + `apps/api` | RWA / real-yield adapters; opportunity scoring/ranking; serving endpoint |
| Discovery UI | `apps/web` | Ranked opportunity feed, category filters, detail views |
| Passkey onboarding | `apps/web` + `apps/api` | passkey-kit smart wallets, Launchtube submission, sponsored reserves |
| Execution | `apps/api` + `apps/web` | One-click action from opportunity → builder → in-wallet sign |
| Capital onboarding | `apps/api` + `apps/web` | CCTP (crypto) + partner on-ramp (fiat) into a Stellar opportunity |
| Notifications | `apps/api` | Rule model + evaluator + multi-channel delivery (in-app, Telegram, Discord, push) |
| Mobile | shell over `apps/web` (Capacitor / RN) | Execution surface with on-device passkey signing + native push |