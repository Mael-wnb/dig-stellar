# Dig Stellar — Grant Roadmap

## Purpose

This document maps the approved Stellar Community Fund grant (SCF 43, $75k, 3 tranches) to internal
execution. Each deliverable is recorded in two clearly separated layers:

1. **Grant criteria (validated by SCF — verbatim, do not edit).** This is the contract: the exact
   description, completion criteria, date, budget, and KPIs that SCF approved. It is the source of
   truth for *what we are obligated to deliver*. Do not paraphrase, soften, or "improve" it — drift
   here creates ambiguity at claim time. If it must change, that is a grant amendment, not an edit.
2. **Internal interpretation & status (living).** Our reading of what the criteria mean in the
   codebase, what already exists, what the gap is, and what is out of scope. This layer changes as
   work progresses and must stay aligned with `docs/status-board.md` and `docs/current-state.md`.

When the two layers seem to disagree, the criteria win for *obligation*; the interpretation wins for
*current reality*. Surface the disagreement rather than hiding it.

---

## Deliverable index

| Tranche | # | Deliverable | Date | Budget | Status* |
|---|---|---|---|---:|---|
| T1 | 1 | Data Indexing Foundation (Horizon & Soroban) | May 25, 2026 | $12,300 | ~90% |
| T1 | 2 | Analytics Dashboard MVP | Jun 8, 2026 | $6,140 | ~80% |
| T1 | 3 | Smart Transaction Builder (Testnet) | Jun 22, 2026 | $11,070 | ~15% |
| T2 | 1 | Multi-Wallet Portfolio & "Active Signer" Model | Jul 6, 2026 | $7,380 | ~60% |
| T2 | 2 | In-App Alerting Engine | Jul 20, 2026 | $8,610 | ~10% |
| T2 | 3 | Bridge Flow Monitoring | Aug 3, 2026 | $6,140 | ~5% |
| T3 | 1 | Mainnet Deployment & Freshness Tracking | Aug 10, 2026 | $8,610 | ~40% |
| T3 | 2 | Non-Custodial Mainnet Actions | Aug 24, 2026 | $8,610 | ~5% |
| T3 | 3 | Observability, UI/UX Polish & Reference Handoff | Aug 31, 2026 | $6,140 | ~20% |

Tranche totals: T1 $29,510 · T2 $22,130 · T3 $23,360 · **Total $75,000**.
\*Status is a snapshot — `docs/status-board.md` is the live source; treat its values as authoritative.

---

## Codebase ownership (summary)

- **`apps/web`** — product UI, composables/state, wallet UX, consumption of internal API. No
  business-critical logic, no direct external-provider fetches for core product data.
- **`apps/api`** — frontend façade: aggregation, stable contracts, wallet/user grouping, orchestration
  between DB and indexer output, freshness metadata.
- **`apps/indexer`** — Horizon/Soroban ingestion, protocol adapters, snapshots, refresh cadence,
  cron-compatible jobs.

As-built data note (see `docs/repo-structure.md` / `docs/data-model.md`): the product runs on the
**raw SQL v1/v2** pipeline (`job:refresh` → `pool_metrics_latest`, `protocol_metrics_latest`,
wallet tables) read by `/v1/*` routes. The Prisma `Protocol/Venue/Snapshot` models and the
prefix-less `/protocols` / `/venues` routes are a parallel legacy path.

---

# Tranche 1 — MVP

## Tranche 1 — Deliverable 1 — Data Indexing Foundation (Horizon & Soroban)

### Grant criteria (validated by SCF — verbatim, do not edit)
Build the backend infrastructure to collect Stellar DeFi data. The indexer will handle Stellar's
duality: fetching "Classic" activity via Horizon (native SDEX orderbook, trustlines, balances) and
smart contract data via the Soroban RPC.

How to measure completion:
- Hybrid indexing service (Horizon + Soroban RPC) storing data in a unified database.
- Adapters developed for Blend V2 (already initiated in our repository via `pnpm -C apps/indexer run:blend` — Soroban) and for the native Stellar DEX liquidity pools (SDEX — Classic/Horizon).
- Internal API endpoints (`/protocols`, `/venues/:key/snapshots`) serving data with a 5 to 15-minute refresh cadence.

Estimated date: May 25, 2026 — Budget: $12,300

### Internal interpretation & status (living)
Owner: `apps/indexer` + `apps/api`. Status: ~90%.

**Met and exceeded.** Hybrid Horizon + Soroban ingestion is live and stores into a unified Postgres
database. Coverage is broader than the two adapters the criteria require: Blend, Soroswap, and
Aquarius (Soroban) plus the native Stellar DEX liquidity pools (Horizon).

**Verified evidence** (DB inspection, June 5, 2026):
- Coverage: Blend 3 pools, Aquarius 4, Soroswap 2 — all with non-null, non-zero TVL
  (Blend ≈ $156.7M, Aquarius ≈ $21.0M, Soroswap ≈ $0.57M).
- Freshness: synchronous `as_of` across the three Soroban protocols within the same `job:refresh`
  cycle, refreshed minutes before inspection — concrete proof of an operating cadence.
- Canonical pipeline: `job:refresh` → `72-run-refresh-job.ts` → `71-refresh-all-metrics.ts` →
  per-protocol refresh steps, writing the raw SQL v1 tables (`pool_metrics_latest`,
  `protocol_metrics_latest`, `reserve_snapshots`, `normalized_events`, `asset_prices`, …).

**Endpoint note (resolve at claim time, not a blocker).** The criteria name `/protocols` and
`/venues/:key/snapshots`. In the current code those are the Prisma `AppController` routes (legacy
path), while the fresh product pipeline is served under `/v1/*`. This is a deliberate result of
keeping the original endpoint and adding the newer one under `/v1`. Resolution options for the
tranche-verification doc: (a) state the actual endpoints serving the cadence, or (b) consolidate the
routes. Either is fine; just make the claimed endpoint match what serves fresh data.

**Remaining gap before claim-readiness:** freshness exposure through the API, retry/backoff
standardization, ingestion runbook, and the evidence package itself. **DeFindex is out of scope here**
— it belongs to Tranche 3 Deliverable 1 (which lists DeFindex among the mainnet protocols).

---

## Tranche 1 — Deliverable 2 — Analytics Dashboard MVP

### Grant criteria (validated by SCF — verbatim, do not edit)
Deliver the first version of the user interface displaying global market data and protocol-specific
dashboards using Testnet data.

How to measure completion:
- Live and publicly accessible web interface.
- Display of key metrics (TVL, volume, APY) for the protocols indexed in Deliverable 1.
- Integration of Stellar Wallets Kit for seamless wallet connection.

Estimated date: June 8, 2026 — Budget: $6,140

### Internal interpretation & status (living)
Owner: `apps/web` + `apps/api`. Status: ~80%.

**Largely met.** A public beta exists; protocol and pool views are real and display TVL / volume / APY
from the indexed data; Stellar Wallets Kit is integrated (`@creit.tech/stellar-wallets-kit`,
`@stellar/freighter-api`).

**Testnet vs Mainnet note.** The criteria say "using Testnet data," but the dashboard already runs on
real **Mainnet** data — over-delivery relative to the contract. Worth flagging in the verification doc
so a reviewer reading the literal text is not surprised.

**Remaining gap:** some global/network stats are still served by `GET /v1/network/stats`, which calls
external APIs live (CoinGecko, DefiLlama, stellar.expert, Horizon) with no DB persistence or freshness
— the "centralize behind the API / no direct external fetches for core data" item. Plus a responsive
pass and stale/loading/error consistency. None of these block the three criteria, but they are the
polish needed for a credible external beta.

---

## Tranche 1 — Deliverable 3 — Smart Transaction Builder (Testnet)

### Grant criteria (validated by SCF — verbatim, do not edit)
Develop the engine that generates non-custodial transaction proposals. The builder will automatically
bundle required prerequisites (e.g., missing trustlines) into a single XDR envelope for the user to
sign in their wallet.

How to measure completion:
- Users can generate a multi-operation XDR transaction (e.g., `ChangeTrust` + Deposit) directly from the UI.
- Transactions are successfully simulated and executed on the Stellar Testnet.
- Strict adherence to the non-custodial model: signatures are exclusively performed in-wallet via Stellar Wallets Kit.

Estimated date: June 22, 2026 — Budget: $11,070

### Internal interpretation & status (living)
Owner: `apps/web` + `apps/api`. Status: ~15%. **This is the real T1 gap.**

Wallet connection and wallet-aware UX exist; the builder layer itself does not. To claim this, one
narrow reference action must work end-to-end: build a multi-operation XDR (e.g. `ChangeTrust` +
deposit), simulate it on Testnet via `simulateTransaction`, and sign in-wallet through Stellar Wallets
Kit — backend never touching keys. Recommended approach: pick ONE protocol/action (a Blend deposit is
the natural candidate given existing Blend coverage), prove the full path, then generalize. Out of
scope for the claim: multi-action menus, mainnet execution (that is T3-D2), fee sponsorship.

---

# Tranche 2 — Expansion

## Tranche 2 — Deliverable 1 — Multi-Wallet Portfolio & "Active Signer" Model

### Grant criteria (validated by SCF — verbatim, do not edit)
Implement multi-wallet tracking, allowing users to monitor a consolidated portfolio of positions
across Stellar DeFi.

How to measure completion:
- UI supports adding one "Active Signer" wallet and multiple "watch-only" addresses.
- Aggregation of balances and DeFi positions across all tracked addresses.
- Clear UI distinction between watch-only addresses and the active signing context.

Estimated date: July 6, 2026 — Budget: $7,380

### Internal interpretation & status (living)
Owner: `apps/web` + `apps/api` (+ `apps/indexer` as position depth grows). Status: ~60%.

**Foundations in place.** Grouped multi-wallet behavior is real: add/remove/refresh/select flows,
backend grouping by a persistent `userId`, wallet overview and per-wallet balances. Backed by the raw
SQL v2 tables (`user_wallets`, `wallet_balance_snapshots`, `wallet_protocol_positions`), refreshed via
the indexer script spawned by `refreshWallet`.

**Remaining gap, mapped to the exact criteria:** the explicit **"Active Signer" vs "watch-only"**
distinction is not yet formalized (model + UI), and position aggregation beyond wallet balances is
still thin. Decide whether watch-only is a backend state or a frontend designation, then surface the
signing context clearly. The first two criteria are close; the third (clear UI distinction) is the
real work.

---

## Tranche 2 — Deliverable 2 — In-App Alerting Engine

### Grant criteria (validated by SCF — verbatim, do not edit)
Build the backend logic and frontend interface for user-defined alerts based on on-chain activity and
metric deltas (e.g., APY drops, health factor risks).

How to measure completion:
- Users can configure specific thresholds and alerting preferences stored in their profile.
- The backend evaluates rules against the snapshot database and generates in-app notifications.

Estimated date: July 20, 2026 — Budget: $8,610

### Internal interpretation & status (living)
Owner: `apps/api` + `apps/web` (+ scheduled evaluation). Status: ~10%.

**Scope discipline.** The criteria require only rule storage, **evaluation against the snapshot
database**, and in-app notifications. The architecture doc envisions a sub-minute event-stream
evaluator — that is a fine long-term direction but **must not** become a precondition for this claim.
Build the smallest version that meets the two criteria: a persisted rule/preference model, a periodic
evaluator over `pool_metrics_latest` / `protocol_metrics_latest` deltas, and an in-app notification
slice. Start with one rule family (e.g. APY delta or health-factor threshold).

---

## Tranche 2 — Deliverable 3 — Bridge Flow Monitoring

### Grant criteria (validated by SCF — verbatim, do not edit)
Integrate bridge monitoring to track cross-chain capital inflows to the Stellar ecosystem.

How to measure completion:
- Adapter built for Allbridge to track attribution data.
- Dashboard section dedicated to incoming bridged assets.

Estimated date: August 3, 2026 — Budget: $6,140

### Internal interpretation & status (living)
Owner: `apps/indexer` + `apps/api` + `apps/web`. Status: ~5%. Not meaningfully started.

The criteria are narrow and explicit: an **Allbridge** attribution adapter and a dashboard section for
incoming bridged assets. Axelar / Near Intents are not part of this contract — do not expand scope.
Define the normalized inflow storage model, build the Allbridge adapter, expose a minimal dashboard
slice.

---

# Tranche 3 — Mainnet / Operational maturity

## Tranche 3 — Deliverable 1 — Mainnet Deployment & Freshness Tracking

### Grant criteria (validated by SCF — verbatim, do not edit)
Switch the entire infrastructure (Indexer, API, Frontend) to the Stellar Mainnet for all integrated
protocols. Implement data reliability monitoring (freshness tracking).

How to measure completion:
- Production deployment with real Mainnet data for Blend V2, SDEX, Soroswap, Aquarius, and DeFindex.
- The system monitors source latency: if a protocol becomes "stale", the UI explicitly indicates it and the indexer performs retries with exponential backoff.

Estimated date: August 10, 2026 — Budget: $8,610

### Internal interpretation & status (living)
Owner: `apps/web` + `apps/api` + `apps/indexer`. Status: ~40%.

**Partly real already.** The product runs on real Mainnet data for Blend, Soroswap, Aquarius, and the
native DEX. **DeFindex lives here**: this criterion is the one that explicitly requires DeFindex
coverage, so the scaffolded `run:defindex` / `@defindex/sdk` work must be completed and validated for
this deliverable (not for T1-D1).

**Remaining gap:** the freshness *system* the criterion describes — staleness surfaced in the UI,
retries with exponential backoff — is not yet first-class (timestamps exist; stale detection and
backoff are not standardized). Plus a formalized production topology and health visibility. This is the
operationalization deliverable; freshness/stale/retry is the spine of it.

---

## Tranche 3 — Deliverable 2 — Non-Custodial Mainnet Actions

### Grant criteria (validated by SCF — verbatim, do not edit)
Enable real transaction execution on the Mainnet. The Smart Transaction Builder interacts with the
official smart contracts deployed by partner protocols on the main network.

How to measure completion:
- Successful execution of swaps and vault/lending interactions on the Mainnet from the dashboard.
- Validation of strict security: backend stores only public addresses and never processes private keys.
- The UI cleanly manages and displays execution feedback.

KPI:
- 50+ unique mainnet wallets
- 200+ mainnet transactions

Estimated date: August 24, 2026 — Budget: $8,610

### Internal interpretation & status (living)
Owner: `apps/web` + `apps/api`. Status: ~5%. Depends entirely on T1-D3.

This is the mainnet extension of the transaction builder. It cannot advance before T1-D3 proves the
build → simulate → in-wallet-sign path on Testnet. Note the **hard KPIs** (50+ unique mainnet wallets,
200+ mainnet transactions) — these are adoption metrics, not just functional checks, so the claim
needs both a working action surface *and* real usage. Sequence: finish T1-D3, validate the action
surface per protocol, harden security/UX, ship to mainnet with narrow scope first, then drive usage.

---

## Tranche 3 — Deliverable 3 — Observability, UI/UX Polish & Reference Implementation Handoff

### Grant criteria (validated by SCF — verbatim, do not edit)
Final UI polish based on Mainnet feedback. Implementation of system observability and delivery of the
technical architecture package to the Stellar Development Foundation.

How to measure completion:
- Backend observability implemented (endpoints `/health`, RPC latency metrics, error rates).
- The application is packaged as a Reference Implementation for the SDF (functional Docker compose) with internal documentation.
- Final report submitted to the SDF demonstrating the modular architecture and initial adoption metrics.

Estimated date: August 31, 2026 — Budget: $6,140

### Internal interpretation & status (living)
Owner: all apps. Status: ~20%.

**Partial groundwork.** A `docker-compose.yml` exists (Postgres + Redis) — partial evidence toward the
"functional Docker compose" criterion, though it is currently the local-dev stack, not a packaged
reference implementation. Documentation effort has started and the architecture is modular.

**Remaining gap:** real `/health` and metrics endpoints (RPC latency p50/p95/p99, error rates),
packaging as an SDF reference implementation with docs, and the final report with adoption metrics
(which depends on the T3-D2 KPIs). Note: testing/CI dependencies are installed but no suites/pipelines
exist yet — if any testing evidence is wanted for handoff, it is built here, and must not be cited as
already existing before then.

---

# Cross-deliverable reality check

## Strongest current candidates (closest to claim-readiness)
1. T1-D1 — Data Indexing Foundation (~90%)
2. T1-D2 — Analytics Dashboard MVP (~80%)
3. T2-D1 — Multi-Wallet Portfolio (~60%)

## Most underdeveloped areas
1. T1-D3 — Smart Transaction Builder (~15%) — gates T3-D2
2. T2-D2 — Alerting Engine (~10%)
3. T2-D3 — Bridge Monitoring (~5%)
4. T3 operational/action layers

## Timeline reality (be honest, not optimistic)
As of June 5, 2026: the T1-D1 estimated date (May 25) has passed with the deliverable not yet claimed,
and T1-D2 (June 8) is imminent. The later dates assume T1-D3 — the least mature T1 item — lands by
June 22, which is aggressive given it still needs net-new builder work. Treat the SCF dates as the
contractual targets, but plan internally against actual maturity: prioritize closing T1-D1 (evidence
package) and T1-D2 (polish) now, and de-risk T1-D3 by scoping ONE action immediately rather than
keeping it abstract.

---

# Immediate execution priorities
1. Turn T1-D1 into a clearly evidenced, well-documented deliverable (evidence package; resolve the
   endpoint note).
2. Close T1-D2 polish: centralize remaining external calls behind the API, responsive pass,
   stale/loading/error consistency.
3. Scope T1-D3 to ONE narrow Testnet action and prove it end-to-end.
4. Keep `current-state.md` and `status-board.md` aligned with reality.

---

# How to use this file
Before a major task, answer: which tranche/deliverable does it serve? what is the smallest version
that moves it toward claim-readiness? what evidence will prove it? Keep the **Grant criteria** blocks
verbatim; update only the **Internal interpretation & status** layer, and mirror status changes into
`docs/status-board.md`.