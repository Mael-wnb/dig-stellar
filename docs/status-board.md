# Dig Stellar — Status Board

## Purpose

This file is the operational progress board for Dig Stellar. It answers, quickly and honestly:
- where the project stands right now
- which grant deliverables are closest to completion
- what is still partial or fragile
- what the next execution step should be

Keep it short, practical, and frequently updated. Keep it aligned with `docs/grant-roadmap.md`
(the contract + interpretation) and `docs/current-state.md` (the detailed reality).

---

## Status scale

**Delivery status:** Done · Substantially done · Partial · Early · Blocked
**Confidence** (how close to genuinely usable / claimable): High · Medium · Low

---

## Tranche numbering (SCF #43 — 4 disbursements)

SCF #43 pays in four tranches: 10% / 20% / 30% / 40%.
- **Tranche 1 (10%)** — upfront, received on approval. No deliverables to prove.
- **Tranche 2 (20%)** — **current submission target.** Unlocked by review of the MVP
  deliverables below (internally tracked as "T1 — MVP": D1 indexing, D2 dashboard,
  D3 builder).
- **Tranche 3 (30%)** — testnet review (internal "T2" work).
- **Tranche 4 (40%)** — mainnet launch (internal "T3" work).

The internal "T1/T2/T3" labels below are the *deliverable groups* the project was approved
with; the MVP group (T1) is what the 20% disbursement is reviewed against.

---

## Global status

- Current phase: Tranche 2 (20%) submission prep — MVP deliverables claim-ready
- Current focus: evidence package + demo video for the three MVP (T1) deliverables
- Closest tranche-critical targets: all three T1 deliverables now meet their SCF criteria
- Biggest current risk: none blocking the claim; remaining items are operational polish
  (freshness UI, health endpoints) that belong to later tranches
- Main execution goal: package the proven MVP work into the SCF Tranche 2 submission
- Last updated: 2026-06-19

---

# Tranche 1 — MVP (reviewed for the SCF 20% disbursement)

| Deliverable | Status | Completion | Confidence | Current evidence | Remaining (post-claim / out of contract) | Next action |
|---|---|---:|---|---|---|---|
| D1 — Data Indexing Foundation (Horizon & Soroban) | Done | 100% | High | Hybrid Horizon+Soroban ingestion live into one Postgres DB; canonical `job:refresh` pipeline (72→71→steps) writing raw SQL v1; **prod (Jun 18–19)**: 4 protocols aggregated — Blend 3 pools (≈$192M), Aquarius 4 (≈$22.7M), stellar-native 9 (≈$6.2M), Soroswap 1 active (≈$130k); synchronous `as_of` across protocols within one refresh cycle, observed advancing over consecutive cycles; cron every 15 min on the VPS (within the 5–15 min criterion); served via `/v1/*` | Freshness exposure in the API and retry/backoff standardization (belongs to T3-D1); DeFindex (T3) | Capture evidence in the demo video (live `/v1/protocols`, `/v1/pools`) |
| D2 — Analytics Dashboard MVP | Done | 100% | High | Public beta live at `stellar.getdig.ai` (Vercel); protocol/pool views show TVL/volume/APY from indexed data; Stellar Wallets Kit integrated; runs on real Mainnet data (over-delivery vs the "Testnet data" wording); **`GET /v1/network/stats` DB-backed** (`network_stats_latest` via indexer step `73`); `protocolCount` now dynamic = 4; "native" rendered as "XLM"; Blend panel trimmed to real metrics | Responsive pass + stale/loading/error consistency (polish, not a criterion); two network-stats fields (`activeWallets`, `dexVolume24hUsd`) null from a stale stellar.expert endpoint (pre-existing, minor) | Show the live dashboard in the demo video |
| D3 — Smart Transaction Builder (Testnet) | Done | 100% | High | **Fully successful SDEX swap on Testnet from the UI (Jun 19)**: `POST /v1/actions/sdex/swap` builds a multi-op XDR (`ChangeTrust` + `PathPaymentStrictSend`) on the native SDEX, signed in-wallet via Freighter/Wallets Kit, executed on-chain — tx `fb10c5b8d86b87bc3408bf0d4e9698f93370a3e788244008ef31f6200a12b8b2`, **Successful** (10 XLM → 5.91 USDC, min-receive respected). Live quote endpoint (`/v1/actions/sdex/quote`, Horizon strict-send) drives auto-slippage so swaps fill reliably. Backend never touches keys. All three SCF criteria met. | Blend deposit (Soroban, sequential — beyond the single-XDR criterion; relates to T3-D2 mainnet actions) not yet exercised end-to-end; minor `getAssetBalance` re-bundles `ChangeTrust` when trustline exists | Capture the live swap in the demo video |

**Note on the single-XDR criterion.** Stellar Protocol 20 forbids mixing `InvokeHostFunction`
(Soroban) with classic operations in one envelope, so the grant's literal `ChangeTrust + Deposit`
single-XDR is demonstrated via the **classic SDEX path** (`ChangeTrust` + `PathPaymentStrictSend`).
The Blend deposit is a secondary Soroban pattern (two sequential txs) and is not required by the
T1-D3 criteria.

---

# Tranche 2 — Expansion (internal; reviewed later for the 30% disbursement)

| Deliverable | Status | Completion | Confidence | Current evidence | Main remaining gap | Next action |
|---|---|---:|---|---|---|---|
| D1 — Multi-Wallet Portfolio & "Active Signer" Model | Partial | 60% | Medium | Grouped multi-wallet behavior real (add/remove/refresh/select); backend grouping by persistent `userId`; per-wallet balances; raw SQL v2 tables (`user_wallets`, `wallet_balance_snapshots`, `wallet_protocol_positions`) | "Active Signer" vs "watch-only" not formalized (model + UI); position aggregation beyond balances is thin | Define + document active-signer vs watch-only semantics |
| D2 — In-App Alerting Engine | Early | 10% | Low | Product direction exists; some notification-like UI | No rule/preference model, evaluator, storage, or notification lifecycle | Minimal rule model + periodic evaluator over `*_metrics_latest` deltas (one rule family first) |
| D3 — Bridge Flow Monitoring | Partial | 45% | Medium | Allbridge Core adapter live (`apps/indexer/.../allbridge/`): inflow + outflow events via Soroban `getEvents`, per-source-chain attribution (inflow via `receive_tokens` arg parse), `bridge_flows` table + `amount_usd`, wired non-fatal into `job:refresh`, idempotent on rescan. Verified against mainnet (inflow BAS, outflows SOL/POL/CEL/BAS) | No `/v1/bridge/*` API layer or dashboard slice yet (the SCF "dashboard section" criterion) | Build `/v1/bridge/*` (on-read 7d aggregation) + the dashboard "recent bridged flows" section |

---

# Tranche 3 — Mainnet / Operational maturity (internal; reviewed for the 40% disbursement)

| Deliverable | Status | Completion | Confidence | Current evidence | Main remaining gap | Next action |
|---|---|---:|---|---|---|---|
| D1 — Mainnet Deployment & Freshness Tracking | Partial | 45% | Medium | Real Mainnet data already powers Blend, Soroswap, Aquarius, native DEX; refresh jobs operational on a 15-min cron; persisted timestamps; inactive entities soft-disabled (`is_active`) and excluded from API + aggregation | Stale detection + exponential backoff + UI staleness not first-class; production topology + health visibility; **DeFindex coverage belongs here** (scaffolded `run:defindex`/`@defindex/sdk`, not validated) | Make the freshness system first-class; complete + validate DeFindex |
| D2 — Non-Custodial Mainnet Actions | Early | 5% | Low | Wallet foundation exists; **T1-D3 proves the build → quote → sign-in-wallet → execute path on Testnet with a successful tx** — the same builder code targets mainnet (only contract addresses + network differ) | Hard KPIs (50+ unique mainnet wallets, 200+ mainnet transactions); mainnet gating currently disabled by design | Extend the proven builder to mainnet narrowly, then drive usage |
| D3 — Observability, UI/UX Polish & Reference Handoff | Early | 20% | Low | `docker-compose.yml` (Postgres+Redis) exists as local-dev stack; architecture is modular; docs effort well underway (status-board, current-state, grant-roadmap, runbooks, repo-structure, data-model all maintained) | Real `/health` + RPC latency/error metrics; packaged SDF reference implementation; final report w/ adoption metrics (depends on T3-D2 KPIs) | Add health/metrics endpoints incrementally |

---

## Strongest areas right now
1. Horizon + Soroban indexing foundation (4 protocols, verified coverage + freshness, 15-min cron)
2. Protocol analytics architecture (raw SQL v1 pipeline → `/v1/*`)
3. Non-custodial transaction builder: SDEX swap **fully successful** on Testnet, with live quote + auto-slippage
4. Backend/API foundation as the single façade (network stats, protocol metrics, freshness all DB-backed)
5. Public beta dashboard on real Mainnet data
6. Grouped multi-wallet portfolio flows (raw SQL v2)
7. Clear separation between web, api, and indexer

## Weakest areas right now
1. Alerting engine (T2)
2. Bridge monitoring (T2)
3. Freshness/stale/retry operationalization + observability (T3)
4. Deployment maturity / CI-CD (still manual VPS deploy)
5. Transaction builder breadth: SDEX swap proven; Blend deposit not yet exercised from UI

## Best near-term tranche wins
1. SCF Tranche 2 (20%) submission — all three MVP deliverables claim-ready
2. Demo video covering the three MVP deliverables in one walkthrough
3. T2-D1 active-signer model formalization (start of the next deliverable group)

---

## Update rule

Update when: a deliverable moves in maturity, a blocker is removed, a gap becomes clearer, the next
tranche-critical target changes, or a partial area becomes substantially done. When in doubt, prefer
realism over optimism. Mirror any status change into `docs/grant-roadmap.md` (interpretation layer)
and `docs/current-state.md`.