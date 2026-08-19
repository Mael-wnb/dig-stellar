# DIG Stellar: Final Report to the Stellar Development Foundation

**SCF Build Award #43, Tranche 4 (Mainnet launch)**
**Project:** DIG, a non-custodial DeFi analytics and execution platform for the Stellar network
**Live application:** https://stellar.getdig.ai
**Public repository:** https://github.com/Mael-wnb/dig-stellar
**Date:** August 2026

---

## 1. Executive summary

DIG is live in production on Stellar Mainnet. The platform indexes five DeFi protocols (Blend V2, SDEX, Soroswap, Aquarius, DeFindex) with first-class data freshness, executes real non-custodial transactions (SDEX swaps and Blend lending) directly from the dashboard, and exposes its own operational state through public observability endpoints. The application is packaged as a reference implementation: a functional Docker compose brings up a complete working instance from a fresh clone of the public repository.

All three Tranche 4 deliverables are complete. This report presents the modular architecture (the reference implementation the SDF can reuse), the evidence behind each deliverable, and the adoption instrumentation, as required by the Deliverable 3 completion criteria.

A defining constraint shaped everything below: DIG deploys no custom Soroban contracts. Every transaction the platform builds invokes the official contracts deployed by the partner protocols themselves. There is no proprietary intermediary on-chain, nothing custodial by construction, and the backend never processes a private key.

## 2. Modular architecture

### 2.1 Three applications, strict ownership

The monorepo contains three applications with enforced layer ownership:

**apps/indexer** owns all blockchain ingestion: Horizon and Soroban RPC adapters per protocol, snapshot writing, and the refresh pipeline (ten steps covering the five protocols, prices, and network statistics). It runs on a fixed cadence and is entity-driven: the database registry of pools and vaults, not environment variables, defines the indexed perimeter, so extending coverage means adding rows, not code.

**apps/api** (NestJS) is the single facade the frontend consumes: aggregation, stable response contracts, wallet and user grouping, alert evaluation, the transaction builder, and freshness metadata on every payload. Batch logic stays out of the API; runtime logic stays out of the indexer.

**apps/web** (Vue 3) owns UI and wallet UX only. It holds no business-critical logic and makes no direct external-provider calls for core product data. Wallet signing happens exclusively client-side through the Stellar Wallets Kit.

PostgreSQL is the source of truth for indexed data (snapshot tables with latest-per-entity read discipline), Redis handles caching, and the schema is applied as ordered, idempotent SQL files.

### 2.2 The transaction path, non-custodial by construction

The Smart Transaction Builder follows one path for every action. The API builds the transaction envelope targeting the official partner contract (for example, Blend pool contracts invoked through InvokeHostFunction with exact contract IDs), simulates it, and returns the XDR. The client then independently validates the XDR against the user's request before anything reaches the wallet: operation types, contract addresses, amounts, and destinations are re-derived and compared, and validation fails closed. Only then does the wallet prompt for a signature, and submission happens client-side.

Server-side, defense in depth wraps the builder: a kill-switch, a per-transaction notional cap, and an issuer-verified asset whitelist. The backend stores public addresses only.

The refusal path is part of the design. When a target pool's governance state forbids an action (the live case: the Blend Orbit pool, admin-frozen), simulation fails, the API returns an empty XDR with the raw diagnostic, the wallet is never invoked, and nothing is signed or charged. Users were alerted to the pool status change automatically by the alerting engine.

### 2.3 Reference implementation packaging

The Deliverable 3 criterion asks for the application packaged as a reference implementation with a functional Docker compose. This is delivered and proven:

```
git clone https://github.com/Mael-wnb/dig-stellar.git
cd dig-stellar
cp .env.example .env
docker compose --profile app up
```

This brings up PostgreSQL (with the full schema applied automatically in dependency order at first boot), Redis, the API (multi-stage image, non-root, deployed commit SHA surfaced in /health), and the indexer (a sequential refresh loop, self-excluding by construction, replacing the production cron). The run was validated end-to-end from a clean clone against public RPC endpoints: all ten refresh steps green, /health responding with the build SHA, /v1/protocols serving live mainnet TVL, and a down/up cycle proving idempotent initialization. The capture is committed at docs/evidence/lot-z/z1-compose-fresh-clone.md.

Two choices are documented rather than hidden: the frontend stays a static Vercel deployment (it is a Vite build consuming the API, so containerizing it adds nothing for a reference reader), and the reward faucet is deliberately not wired into the compose, so the reference deployment involves no server-side key of any kind.

For the ecosystem, this means any Stellar builder who wants a working DeFi indexing pipeline across Blend, Soroswap, Aquarius, DeFindex and the native DEX can run one, study it, and fork it within minutes. The internal documentation corpus ships in the same repository: technical architecture, data model, security invariants, runbooks, deployment guide, and per-deliverable evidence under docs/evidence/.

## 3. Deliverables and evidence

### 3.1 Deliverable 1: Mainnet deployment and freshness tracking

The full stack runs in production on Stellar Mainnet: the indexer and API on a dedicated server, the frontend at stellar.getdig.ai. All five committed protocols are live on real mainnet data, 25 pools indexed across AMM and lending types, including DeFindex yield vaults.

Freshness is first-class rather than cosmetic. Every API payload carries read-time staleness metadata computed against per-source expectations. The UI displays explicit freshness indicators and stale badges instead of silently serving old data. Every step of the refresh pipeline retries with standardized exponential backoff, and per-step outcomes are recorded and publicly visible through the observability endpoint.

Evidence: the walkthrough video, the live application, and docs/evidence/lot-b-freshness-defindex.md.

### 3.2 Deliverable 2: Non-custodial mainnet actions

Real execution is delivered and publicly verifiable. Selected transaction evidence, all built by the platform, signed in the user's wallet, and independently re-verified against public Horizon (full analysis in docs/evidence/t3-d2-mainnet-actions.md):

| Action | Transaction hash |
|---|---|
| Swap 50 XLM to USDC (SDEX strict-send, with trustline setup) | 5006b7ae687d090bffc476203f8bccc9ecfd6e357814ddca416e47a221681ab3 |
| Swap 10 XLM to EURC (SDEX strict-send) | c4393fe1eb7f0c0bf470a674f5f5efff30283eee8909f92329c4dc7bd33067b4 |
| Supply 5 XLM collateral to Blend Fixed pool | 38390736578cbfc6607b2549e173e5f1d5e79ec08833996e55c46f39c8636f69 |
| Supply 5 USDC collateral to Blend YieldBlox pool | d22a0f936b8d7f4c78491f4dbbe6413ae554592d55c0fd5e670f557fc67e1466 |
| Withdraw closing the Fixed pool position | 537a230327ff071aec27bb4faecfd8a118e5b7f90b8213889ae000d310c10500 |
| First mainnet swap, USDC to XLM (August 2) | eeeae1996f937328e6923953a75a12c9834974eb97d6bb49ff0a86b52bddc241 |

The supply and withdraw pair closes the full non-custodial lending loop on mainnet: the exact position opened at 15:29 UTC was withdrawn back to the wallet at 16:07 UTC the same day, both legs Horizon-verified. The multi-pool claim is real: the same supply flow executed against two distinct vetted Blend pools, in a native and a credit asset.

Security validation, as required by the criterion: the backend stores only public addresses and never processes private keys; client-side XDR validation runs before every signature and fails closed; the kill-switch, the per-transaction cap and the issuer-verified whitelist are enforced server-side. The video demonstrates the honest refusal on the frozen Orbit pool: the attempted supply dies at simulation with contract error #1206, nothing is signed, and the UI explains the governance state in plain language. Execution feedback in the UI covers building, simulation, signing, submission, confirmation with the explorer link, and mapped error messages.

### 3.3 Deliverable 3: Observability, polish, and reference implementation handoff

Backend observability is live and public:

- **GET /health** reports liveness and the deployed commit SHA, so what runs in production traces to an exact commit in the public repository.
- **GET /v1/ops/metrics** reports RPC latency percentiles per provider (Horizon, Soroban RPC, external APIs), error rates, and the duration and outcome of every refresh pipeline step over a rolling window.

The UI received a full overhaul during the mainnet phase: a redesigned application shell, five views (dashboard, protocols and pools, pool detail, portfolio, alerts), honest per-type metrics (a dash where a metric structurally does not exist, never a fabricated zero), and a contrast and accessibility pass. The reference implementation packaging and documentation corpus are described in section 2.3.

## 4. Adoption instrumentation and initial metrics

### 4.1 Counted by the system, not by hand

Adoption evidence in DIG is automatic. Every transaction executed through the platform is verified against public Horizon and recorded in an on-platform witness ledger (the action_witnesses table): transaction hash, wallet, action kind, decoded operation summary, notional value, and ledger close time. Builds and quotes are counted separately and never as executions. The ledger launched on August 17 with deliberately no historical backfill, so it undercounts earlier activity, including the first two weeks of mainnet actions.

Two figures are therefore publicly auditable rather than declared:

- **GET /v1/ops/adoption** exposes live platform counters: wallets tracked (registered on the platform, including watch-only), distinct users, server-side builds by action kind, and distinct acting addresses.
- **GET /v1/ops/metrics** exposes the reward campaign state, including rewards paid.

At the time of writing, the platform tracks roughly 90 wallets for about 70 users, with executed-transaction and acting-address counts growing daily and queryable live at the endpoint above. Reviewers are invited to query both endpoints during evaluation: the figures will have moved since this report was written, and that is the point of live instrumentation.

### 4.2 Distribution and transparency

Initial distribution was seeded by witness-gated reward campaigns: a completed 48-hour campaign that paid its full budget of 40 on-chain rewards (5 XLM each, one per wallet, released only after a Horizon-verified execution, never on declarative claims), and a second campaign currently live with per-action-family rewards under the same witness-gating. All reward payments are public on-chain payments from the campaign treasury and carry the memo dig-reward, so the entire distribution is independently auditable on any Stellar explorer.

In the spirit of full transparency: the founding team tested the product extensively in real mainnet conditions from its own wallets throughout the launch phase, and this activity is present in raw on-chain history and in early ledger counts. Team wallets are excluded from reward eligibility going forward, and the witness ledger keeps counting organic activity continuously.

## 5. Operational posture and next steps

Production runs on a hardened setup: the API is reachable only through the reverse proxy, rate limits are calibrated from measured real traffic, and exactly one server-side key exists in the whole system, the reward campaign treasury, isolated in a module that can express a single transaction shape (a native payment with a fixed memo) and nothing else. The core product involves no server-side keys at all.

Honest remaining debt, stated rather than hidden: deployments are manual by runbook (a CI/CD pipeline is the next operational investment), and parts of the internal linting configuration predate the current codebase. Neither affects the delivered criteria.

DIG continues past this grant: the team is pursuing an SCF integration-track submission to deepen protocol coverage, and the witness ledger, freshness pipeline, and reference implementation delivered here are the foundation that work builds on.

---

**Contact:** Mael (CTO), @zomal_dig on Telegram
**Everything referenced in this report is public: the application, the repository, the evidence corpus, the observability endpoints, and every transaction hash.**