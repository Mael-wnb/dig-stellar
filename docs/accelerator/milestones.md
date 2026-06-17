# Dig — Stellar DeFi Intelligence & Execution Gateway

## Positioning

The simplest gateway to Stellar DeFi: an intelligence layer that detects, scores, and ranks
yield and liquidity opportunities across the ecosystem; a frictionless onboarding and
non-custodial execution layer so users can act in one click; and native cross-chain USDC
onboarding to bring external capital into Stellar — turning passive analytics into action.

This builds directly on Dig's existing Stellar indexing and analytics infrastructure: a hybrid
Horizon + Soroban RPC pipeline that already ingests and normalizes real-time data from
integrated protocols (e.g., Blend, Aquarius, Soroswap) into a unified Postgres store, served
through internal API endpoints, with grouped multi-wallet portfolio tracking already in place.
That infrastructure is the foundation this project extends — the work below is the intelligence,
onboarding, execution, cross-chain, notification, and mobile layers built on top of it.

**Two integration families** structure the work:
- **Opportunity sources** feeding the intelligence layer: Blend, Aquarius, Soroswap, and DeFindex
  (yield vaults), reusing the existing indexing pipeline.
- **Execution & onboarding rails** enabling action: Stellar Wallets Kit + Freighter (in place),
  Privy (email/social embedded wallets), and cross-chain onboarding via Circle CCTP and Allbridge.

> Note: payment is distributed across SCF Build tranches (Tranche #0: 10% on approval, #1: 20%,
> #2: 30%, #3: 40% + mainnet). Budgets are intentionally left as TBD here and will follow that
> structure (mainnet tranche the largest), rounded to the nearest hundred.

---

## Tranche 1 — Intelligence & Discovery

### [Deliverable 1] Opportunity Detection & Ranking Engine

- **Description:**
  Build the intelligence engine that consumes the normalized protocol metrics already produced by
  the indexing pipeline (latest per-pool and per-protocol metrics, reserve snapshots, asset prices)
  and computes, per opportunity, a yield estimate, on-chain risk signals, and a composite ranking
  score. Sources cover the integrated DeFi protocols, including yield vaults; the model is built to
  also accommodate tokenized RWA yield sources (e.g., Etherfuse Stablebonds) where feasible. Results
  are exposed through a dedicated internal API endpoint for the frontend and notification layers.
- **How to measure completion:**
  - A backend service computes ranked opportunities from real Stellar Mainnet data across the
    integrated protocols (e.g., Blend, Aquarius, Soroswap, DeFindex).
  - Each opportunity carries a yield estimate, at least one risk signal, and a ranking score.
  - Output is served through an internal API endpoint (e.g., `/v1/opportunities`) consumed by the UI.
- **Estimated Date of Completion:** ~2 months after grant start
- **Budget:** TBD

### [Deliverable 2] Opportunity Discovery Interface

- **Description:**
  Build the user-facing discovery layer in the existing web application: a ranked opportunity feed
  consuming the engine endpoint, with filtering and categorization (by protocol, asset, yield, risk)
  and a per-opportunity detail view that explains, in plain language, what the opportunity is.
- **How to measure completion:**
  - The web interface renders a ranked opportunity feed from the engine endpoint on real Mainnet data.
  - Users can filter and sort opportunities by protocol, yield, and risk.
  - Each opportunity opens a detail view with its key metrics and a plain-language explanation.
- **Estimated Date of Completion:** ~2.5 months after grant start
- **Budget:** TBD

### [Deliverable 3] Frictionless Onboarding & Wallet Layer

- **Description:**
  Lower the entry barrier to the platform by integrating Privy embedded wallets alongside the
  existing Stellar Wallets Kit / Freighter flow. New users onboard with email, social login, or
  passkeys and receive a self-custodial Stellar wallet (key secured via TEE and key-splitting, never
  fully held by any single party, exportable by the user) — no extension or seed phrase required.
  This extends the existing grouped multi-wallet portfolio so onboarded and externally-connected
  wallets are tracked together.
- **How to measure completion:**
  - A new user can create and access a self-custodial Stellar wallet via email/social/passkey (Privy),
    with no browser extension or seed phrase.
  - Crypto-native users can still connect external wallets via Stellar Wallets Kit (e.g., Freighter).
  - Both wallet types appear together in the user's consolidated portfolio view.
- **Estimated Date of Completion:** ~2.5 months after grant start
- **Budget:** TBD

---

## Tranche 2 — From Information to Action

### [Deliverable 1] One-Click Execution Layer (v1)

- **Description:**
  Extend the non-custodial transaction builder so a DeFi action can be triggered directly from an
  opportunity. The builder generates a transaction proposal server-side, bundling required
  prerequisites (e.g., a missing `ChangeTrust`) into a single signable envelope, returns it to the
  frontend for client-side validation, and the user signs in-wallet (via Stellar Wallets Kit or the
  Privy embedded wallet). The backend never handles private keys.
- **How to measure completion:**
  - From an opportunity, the API returns a transaction proposal (e.g., a multi-operation XDR such as
    `ChangeTrust` + a swap/deposit operation).
  - The transaction is simulated, signed in-wallet, and submitted on-chain.
  - The backend stores only public addresses and never processes private keys.
- **Estimated Date of Completion:** ~3 months after grant start
- **Budget:** TBD

### [Deliverable 2] Cross-Chain Onboarding (CCTP + Allbridge)

- **Description:**
  Enable users to bring external capital into Stellar through two complementary rails:
  Circle's CCTP for native USDC (burn-and-mint, no wrapped assets, no slippage), and Allbridge Core
  for broader stablecoin and source-chain coverage (liquidity-pool based, with automatic trustline
  setup). Arriving funds are routed toward a Stellar DeFi opportunity through the execution layer.
- **How to measure completion:**
  - Native USDC can be moved from a supported source chain into Stellar via CCTP.
  - Additional stablecoins / source chains are supported via Allbridge Core.
  - Arriving funds can be routed into a surfaced Stellar DeFi opportunity; demonstrated on testnet
    and/or mainnet depending on rail availability at delivery time.
- **Estimated Date of Completion:** ~3.5 months after grant start
- **Budget:** TBD

### [Deliverable 3] Multi-Channel Notification System

- **Description:**
  Build a user-defined alert model and a periodic evaluator that runs over the indexed metric deltas
  (latest per-pool / per-protocol metrics), delivering opportunities and alerts through a single
  notification abstraction with multiple channels: in-app, plus external delivery to Telegram and
  Discord. New channels can be added behind the same interface without rework.
- **How to measure completion:**
  - Users can configure alert thresholds / preferences, stored server-side.
  - The backend evaluates rules against the snapshot database and generates notifications.
  - Notifications are delivered in-app and across at least two external channels (e.g., Telegram, Discord).
- **Estimated Date of Completion:** ~3.5 months after grant start
- **Budget:** TBD

---

## Tranche 3 — Mobile, Mainnet & Hardening

### [Deliverable 1] Mobile Monitoring App

- **Description:**
  Deliver a store-distributed mobile app focused on monitoring, by packaging the existing web
  application as a native shell (Capacitor) and consuming the existing read APIs. Users follow
  tracked wallets, positions, and surfaced opportunities, and receive native push notifications
  (APNs / FCM). Read-only by design — signing and execution remain in the web flow for this scope,
  which keeps the app free of in-app key handling.
- **How to measure completion:**
  - A mobile app is available via App Store / Play Store.
  - It provides wallet and position monitoring and opportunity browsing from the production APIs.
  - It receives native push notifications for alerts.
- **Estimated Date of Completion:** ~4 months after grant start
- **Budget:** TBD

### [Deliverable 2] Full Integration & Mainnet Launch

- **Description:**
  Unify the intelligence, onboarding, execution, cross-chain, and notification layers into a
  production release on Stellar Mainnet, interacting with the official contracts deployed by the
  integrated protocols, with the full discovery → decision → execution flow available end-to-end.
- **How to measure completion:**
  - The complete system runs on Stellar Mainnet.
  - A user can discover a ranked opportunity and execute the corresponding on-chain action from the
    interface, with execution feedback surfaced in the UI.
  - The backend stores only public addresses and never processes private keys.
- **Estimated Date of Completion:** ~4.5 months after grant start
- **Budget:** TBD

### [Deliverable 3] Production Hardening, Freshness & Observability

- **Description:**
  Harden the production system: surface per-source data-freshness state in the UI, standardize source
  retries with exponential backoff, add backend observability (health and metrics endpoints), and
  optimize execution feedback and core-flow UX based on real usage.
- **How to measure completion:**
  - The system exposes data-freshness state per source; stale sources are explicitly indicated in the UI.
  - Failing sources are retried with exponential backoff.
  - Backend observability is in place (e.g., `/health`, RPC latency metrics, error rates).
- **Estimated Date of Completion:** At mainnet launch
- **Budget:** TBD