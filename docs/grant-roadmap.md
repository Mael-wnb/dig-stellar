# Dig Stellar — Grant Roadmap

## Purpose

This document maps the approved Stellar Community Fund grant (SCF #43, $75k) to internal execution.
Each deliverable is recorded in two clearly separated layers:

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

## Disbursement structure (SCF #43 — four tranches)

SCF #43 pays in four tranches: **10% / 20% / 30% / 40%**.
- **Tranche 1 (10%)** — upfront, received on approval. No deliverables to prove.
- **Tranche 2 (20%)** — review of the **MVP** deliverables (the "T1" group below: D1 indexing,
  D2 dashboard, D3 builder). **This is the current submission target.**
- **Tranche 3 (30%)** — review of the testnet/expansion deliverables (the "T2" group).
- **Tranche 4 (40%)** — mainnet launch (the "T3" group).

The internal **T1 / T2 / T3** labels below are the *deliverable groups* the project was approved with
(three deliverables each), not the disbursement tranches. The MVP group (T1) is what the 20%
disbursement is reviewed against.

---

## Deliverable index

| Group | # | Deliverable | Date | Budget | Status* |
|---|---|---|---|---:|---|
| T1 | 1 | Data Indexing Foundation (Horizon & Soroban) | May 25, 2026 | $12,300 | Done — 100% |
| T1 | 2 | Analytics Dashboard MVP | Jun 8, 2026 | $6,140 | Done — 100% |
| T1 | 3 | Smart Transaction Builder (Testnet) | Jun 22, 2026 | $11,070 | Done — 100% |
| T2 | 1 | Multi-Wallet Portfolio & "Active Signer" Model | Jul 6, 2026 | $7,380 | ~82% |
| T2 | 2 | In-App Alerting Engine | Jul 20, 2026 | $8,610 | ~10% |
| T2 | 3 | Bridge Flow Monitoring | Aug 3, 2026 | $6,140 | ~45% |
| T3 | 1 | Mainnet Deployment & Freshness Tracking | Aug 10, 2026 | $8,610 | ~45% |
| T3 | 2 | Non-Custodial Mainnet Actions | Aug 24, 2026 | $8,610 | ~5% |
| T3 | 3 | Observability, UI/UX Polish & Reference Handoff | Aug 31, 2026 | $6,140 | ~20% |

Group totals: T1 $29,510 · T2 $22,130 · T3 $23,360 · **Total $75,000**.
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
Owner: `apps/indexer` + `apps/api`. Status: **Done — 100%.**

**Met and exceeded.** Hybrid Horizon + Soroban ingestion is live in prod and stores into a unified
Postgres database. Coverage is broader than the two adapters the criteria require: Blend, Soroswap,
and Aquarius (Soroban) plus the native Stellar DEX liquidity pools (Horizon) — four protocols.

**Verified evidence** (prod API/DB inspection, June 18–19, 2026):
- Coverage: Blend 3 pools (≈$192M), Aquarius 4 (≈$22.7M), stellar-native 9 (≈$6.2M), Soroswap 1
  active pair (≈$130k) — all aggregated at the protocol level (`protocol_metrics_latest`),
  `protocolCount` = 4, all with non-null, non-zero TVL.
- Freshness / cadence: synchronous `as_of` across protocols within one `job:refresh` cycle, observed
  advancing across consecutive cycles in prod. The indexer runs on a **15-minute cron** on the VPS —
  inside the criterion's "5 to 15-minute refresh cadence" (a full refresh takes ~12 min on the
  1-vCPU VPS, so 15 min is the safe conservative interval; `flock` guards against overlap).
- Canonical pipeline: `job:refresh` → `72-run-refresh-job.ts` → `71-refresh-all-metrics.ts` →
  per-protocol refresh steps, writing the raw SQL v1 tables (`pool_metrics_latest`,
  `protocol_metrics_latest`, `reserve_snapshots`, `normalized_events`, `asset_prices`, …).
- Resilience: inactive entities (archived Soroban contracts whose reads 404) are soft-disabled
  (`is_active=false`) and skipped, so a dead pool no longer aborts the whole refresh.

**Endpoint note.** The criteria name `/protocols` and `/venues/:key/snapshots`. Those prefix-less
routes exist (legacy Prisma `AppController`), but the live product pipeline that serves the cadence is
under `/v1/*` (`/v1/protocols`, `/v1/pools`, `/v1/pools/:slug`). For the submission we cite the actual
endpoints serving fresh data (`/v1/*`) and note the legacy routes are retained for continuity. The
cadence requirement is met by the `/v1/*` routes reading `job:refresh` output.

**Beyond the contract (not required here):** freshness exposure in the API and standardized
retry/backoff belong to T3-D1; DeFindex belongs to T3-D1. None of these affect the T1-D1 criteria,
which are fully met.

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
Owner: `apps/web` + `apps/api`. Status: **Done — 100%.**

**Met.** A public beta is live and publicly accessible at `stellar.getdig.ai` (Vercel). Protocol and
pool views are real and display TVL / volume / APY from the indexed data for all four protocols.
Stellar Wallets Kit is integrated (`@creit.tech/stellar-wallets-kit`, `@stellar/freighter-api`) for
wallet connection.

**Testnet vs Mainnet note.** The criteria say "using Testnet data," but the dashboard runs on real
**Mainnet** data — over-delivery relative to the contract. Worth flagging in the submission so a
reviewer reading the literal text is not surprised: the indexed metrics are live Mainnet figures, not
testnet placeholders.

**Network-stats centralization.** `GET /v1/network/stats` is DB-backed: it reads `network_stats_latest`
(scope `'global'`), populated by the indexer step `73-network-stats-refresh` (wired non-fatally into
`job:refresh`). The API does a single SELECT; external providers are hit on the job cadence, not per
request; `updatedAt` reflects the row's real `as_of`; `protocolCount` is a live count (= 4). Display
polish landed: native token shown as "XLM", Blend lending panel trimmed to its real metrics, dead
pools hidden.

**Beyond the contract (not required here):** a responsive pass and full stale/loading/error
consistency are external-beta polish, not criteria. Minor: two `network_stats_latest` fields
(`activeWallets`, `dexVolume24hUsd`) come back `null` from a stale stellar.expert endpoint
(pre-existing, already null in the old code) — does not affect the three completion criteria.

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
Owner: `apps/web` + `apps/api`. Status: **Done — 100%.** All three criteria met with on-chain proof.

**Met on Testnet, with a fully successful transaction.** The `actions/` module in `apps/api` exposes
`POST /v1/actions/sdex/swap` (plus `/v1/actions/sdex/quote` and `/v1/actions/blend/deposit`). The swap
builds a multi-operation XDR bundling `ChangeTrust` + `PathPaymentStrictSend` in one envelope on
Stellar's native SDEX, returned to the frontend, signed in-wallet via Stellar Wallets Kit (Freighter),
and submitted to the Testnet RPC. The backend never touches keys.

**Verified evidence — fully successful swap (Jun 19, 2026):**
- tx `fb10c5b8d86b87bc3408bf0d4e9698f93370a3e788244008ef31f6200a12b8b2` — **Successful** on Testnet
  (ledger 3171933): swapped 10 XLM → 5.9118862 USDC, min-receive (5.616…) respected. Source account
  `GCLSPNUDT5GCKMVOJXNDQ2HALGZQPB2MFY7FTJZ4QGY5QYYYP6SLCF2O`. Verifiable on stellar.expert/testnet.
- Maps to the three criteria: (1) multi-op XDR from the UI ✅; (2) **successfully executed on Testnet**
  ✅ (status Successful, both operations applied); (3) signatures exclusively in-wallet via Wallets
  Kit ✅.

**Live quote / auto-slippage.** The widget quotes the price live via `/v1/actions/sdex/quote` (Horizon
strict-send paths, same issuer as the swap) and derives min-receive with a 5% slippage tolerance
instead of a manual field. This replaced the original manual min-receive (which assumed a ~1:1 rate
and caused `pathPaymentStrictSendUnderDestmin` / `TooFewOffers` failures) and is what makes swaps fill
reliably. The swap also points to Circle's testnet USDC (deep XLM/USDC liquidity) via a swap-only asset
constant, leaving Blend's USDC untouched.

**Protocol-20 constraint (architectural, decided).** Stellar Protocol 20 forbids mixing
`InvokeHostFunction` (Soroban) with classic operations in one envelope. The grant's literal
`ChangeTrust + Deposit` single-XDR example is therefore achievable via the classic SDEX path, not
Blend. Decision: SDEX swap (`ChangeTrust` + `PathPaymentStrictSend`, one XDR) is the primary
single-XDR demonstration of the criterion; the Blend deposit is a secondary Soroban pattern using two
sequential transactions. A `POST /v1/actions/blend/deposit` endpoint exists for that pattern.

**Beyond the contract (not required here):** the Blend deposit has not been exercised end-to-end from
the UI (a secondary Soroban pattern, and mainnet actions are T3-D2); minor known bug `getAssetBalance`
re-bundles `ChangeTrust` even when the trustline already exists (harmless). Out of scope: multi-action
menus, mainnet execution (T3-D2), fee sponsorship. None affect the T1-D3 criteria.

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
Owner: `apps/web` + `apps/api` (+ `apps/indexer` as position depth grows). Status: ~75%.

**Foundations in place.** Grouped multi-wallet behavior is real: add/remove/refresh/select flows,
backend grouping by a persistent `userId`, wallet overview and per-wallet balances. Backed by the raw
SQL v2 tables (`user_wallets`, `wallet_balance_snapshots`, `wallet_protocol_positions`), refreshed via
the indexer script spawned by `refreshWallet`.

**Gap A — done (criteria 1 + 3).** The **"Active Signer" vs "watch-only"** distinction is now
formalized as a backend state + UI. Backend: `user_wallets.is_active_signer` is a DB-enforced
singleton per user (partial unique index `user_wallets_one_signer_per_user`); `PATCH
/v1/wallets/:walletId/signer` transfers it; connecting a wallet via the Wallets Kit promotes it
(demoting the previous), so the connected wallet is always the signer (keeps T1-D3 valid); add-by-
address stays watch-only. Designation is persisted; signing **capability** is the live Kit
connection — the hybrid. UI: two explicit add-paths ("Connect signer wallet" vs "Add watch-only
address"), per-wallet badges (Active Signer · connected / · not connected, vs Watch-only), and a
signing guardrail that blocks build/sign unless the connected address is the active signer. No
cryptographic proof-of-ownership (deferred): Kit connection is the beta proof.

**Gap B part 1 — done (criterion 2, data layer).** The position resolver is built — beta-first
**Blend only**: `lib/protocols/blend/{fetch-user-positions,resolve-user-health}` +
`81-stellar-wallet-blend-positions.ts` resolve every tracked wallet's Blend position (signer +
watch-only), writing per-asset supply/borrow → `wallet_protocol_positions` and a first-class
**health factor** per pool → the new `wallet_pool_health` table (NOT `metadata` jsonb — HF is a
column D2 will query). HF comes from the Blend SDK's `PositionsEstimate` (no hand-rolled
collateral/liability math); NULL = no debt. Wired non-fatal into `refreshWallet`; validated on
mainnet. The health factor is the data D2's first alert family consumes, so this resolver bridges
D1 → D2.

**Gap B part 2 — remaining (criterion 2, surfacing).** Positions now persist but aren't exposed.
Aggregation across tracked addresses becomes *visible* via `GET /v1/wallets/:id/positions` +
a portfolio UI slice (supplied / borrowed / health factor per wallet). That closes D1 end-to-end.

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
Owner: `apps/indexer` + `apps/api` + `apps/web`. Status: ~45%. Indexer layer done; API + UI remain.

The criteria are narrow and explicit: an **Allbridge** attribution adapter and a dashboard section for
incoming bridged assets. Axelar / Near Intents are not part of this contract — do not expand scope.

**Done (indexer + data model):** the Allbridge Core adapter lives in
`apps/indexer/src/lib/protocols/allbridge/` and is wired (non-fatal) into `job:refresh`. It tracks
**inflows** (the SCF claim) with per-source-chain attribution and **outflows** (bonus, near-free) via
Soroban `getEvents` on the bridge contract (`CBQ6GW7Q…`). Inflow attribution reads `source_chain_id`
from the `receive_tokens` invocation args (the `TokensReceived` event has no source chain). Flows land
in `bridge_flows` (raw SQL, `stellar_v1_bridge.sql`) with `amount_usd`, deduped on
`(contract_address, event_id)`. Mono-token (USDC) — the only token Allbridge Core bridges on Stellar.
Verified against mainnet.

**Remaining:** `/v1/bridge/*` API (on-read 7-day aggregation — no pre-computed metrics table) and the
dashboard "recent bridged flows" section (the SCF "dashboard section" criterion). Honest constraint to
carry into the UI copy: Soroban RPC `getEvents` retains ~7 days, so this is a rolling recent-flows view,
not deep history.

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
Owner: `apps/web` + `apps/api` + `apps/indexer`. Status: ~45%.

**Partly real already.** The product runs on real Mainnet data for Blend, Soroswap, Aquarius, and the
native DEX, deployed in production (Vercel + VPS + 15-min cron). Inactive sources are soft-disabled and
excluded. **DeFindex lives here**: this criterion is the one that explicitly requires DeFindex
coverage, so the scaffolded `run:defindex` / `@defindex/sdk` work must be completed and validated for
this deliverable (not for T1-D1).

**Remaining gap:** the freshness *system* the criterion describes — staleness surfaced in the UI,
retries with exponential backoff — is not yet first-class (timestamps exist; stale detection and
backoff are not standardized). Plus a formalized production topology, health/metrics visibility, and
DeFindex. This is the operationalization deliverable; freshness/stale/retry is the spine of it.

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
Owner: `apps/web` + `apps/api`. Status: ~5%. Builds on the proven T1-D3 path.

This is the mainnet extension of the transaction builder. T1-D3 has proven the build → quote →
in-wallet-sign → execute path on Testnet with a successful transaction, so the path is validated; the
same builder code targets mainnet (only contract addresses and the network differ). Note the **hard
KPIs** (50+ unique mainnet wallets, 200+ mainnet transactions) — adoption metrics, not just functional
checks, so the claim needs both a working action surface *and* real usage. Sequence: validate the
action surface per protocol, harden security/UX, ship to mainnet with narrow scope first, then drive
usage. (The swap is currently gated Testnet-only by design until this deliverable.)

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
reference implementation. A `/health` endpoint exists (liveness only). Documentation is well underway
(status-board, current-state, grant-roadmap, runbooks, repo-structure, data-model all maintained) and
the architecture is modular.

**Remaining gap:** real metrics endpoints (RPC latency p50/p95/p99, error rates), packaging as an SDF
reference implementation with docs, and the final report with adoption metrics (which depends on the
T3-D2 KPIs). Note: testing/CI dependencies are installed but no suites/pipelines exist yet — if any
testing evidence is wanted for handoff, it is built here, and must not be cited as already existing
before then.

---

# Cross-deliverable reality check

## MVP deliverables — claim-ready for the Tranche 2 (20%) submission
1. T1-D1 — Data Indexing Foundation — **Done.** 4 protocols live in prod, 15-min cadence, `/v1/*`.
2. T1-D2 — Analytics Dashboard MVP — **Done.** Public beta on real Mainnet data, Wallets Kit, DB-backed stats.
3. T1-D3 — Smart Transaction Builder — **Done.** Fully successful Testnet swap (tx `fb10c5b8…`), non-custodial.

## Most underdeveloped areas (next groups)
1. T2-D2 — Alerting Engine (~10%)
2. T3-D2 — Mainnet Actions (~5%, path validated by T1-D3)
3. T2-D3 — Bridge Monitoring (~45%; indexer adapter done, `/v1/bridge/*` API + dashboard slice remain)

## Timeline reality (be honest, not optimistic)
As of June 19, 2026: all three MVP (T1) deliverables now meet their SCF criteria with concrete,
verifiable evidence — the indexing foundation and dashboard run in prod, and the transaction builder
has a fully successful on-chain Testnet swap. The SCF dates (May 25 / Jun 8 / Jun 22) are the
contractual targets; the deliverables are complete ahead of or around those dates. The bottleneck is
no longer implementation but **packaging the submission** (deliverable text + links + the ~5-minute
demo video) for the Tranche 2 (20%) disbursement.

---

# Immediate execution priorities
1. Assemble the SCF Tranche 2 submission: the "Tranche Deliverables" text (D1/D2/D3 with proof), the
   links (repo, `stellar.getdig.ai`, `/v1/*` endpoints, tx `fb10c5b8…` on stellar.expert/testnet),
   and the ~5-minute demo video.
2. Keep `current-state.md` and `status-board.md` aligned with reality.
3. (Next group) start T2-D1: formalize active-signer vs watch-only.

---

# How to use this file
Before a major task, answer: which tranche/deliverable does it serve? what is the smallest version
that moves it toward claim-readiness? what evidence will prove it? Keep the **Grant criteria** blocks
verbatim; update only the **Internal interpretation & status** layer, and mirror status changes into
`docs/status-board.md`.