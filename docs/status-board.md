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

## Global status

- Current phase: Beta structuring and tranche-aligned execution
- Current focus: Tranche 1 maturity (D1 evidence package, D2 polish, D3 scoping)
- Closest tranche-critical targets: T1-D1 and T1-D2
- Biggest current risk: operationalization (freshness exposure, health, retry/backoff) and the
  remaining API-centralization gap lag implementation progress
- Main execution goal: convert real implementation progress into clearly evidenced, claim-ready
  deliverables
- Last updated: 2026-06-05

---

# Tranche 1 — MVP

| Deliverable | Status | Completion | Confidence | Current evidence | Main remaining gap | Next action |
|---|---|---:|---|---|---|---|
| D1 — Data Indexing Foundation (Horizon & Soroban) | Substantially done | 90% | High | Hybrid Horizon+Soroban ingestion live into one Postgres DB; canonical `job:refresh` pipeline (72→71→steps) writing raw SQL v1; **verified DB inspection (Jun 5)**: Blend 3 pools / Aquarius 4 / Soroswap 2, all non-zero TVL (≈$156.7M / $21.0M / $0.57M); synchronous `as_of` within one refresh cycle; served via `/v1/*` | Freshness exposure through the API, retry/backoff standardization, ingestion runbook, evidence package; resolve the `/protocols` vs `/v1` endpoint naming at claim time | Build the T1-D1 evidence package |
| D2 — Analytics Dashboard MVP | Substantially done | 80% | Medium-High | Public beta live; protocol/pool views show TVL/volume/APY from indexed data; Stellar Wallets Kit integrated; runs on real Mainnet data | `GET /v1/network/stats` still calls external APIs live (CoinGecko/DefiLlama/stellar.expert/Horizon) with no persistence/freshness; responsive pass; stale/loading/error consistency | Centralize network stats behind the API with DB persistence + freshness |
| D3 — Smart Transaction Builder (Testnet) | Early | 15% | Low | Wallet connection + wallet-aware UX exist; architecture supports tx flows | No builder layer, simulation flow, or XDR orchestration yet | Scope ONE narrow Testnet action (Blend deposit) end-to-end |

---

# Tranche 2 — Expansion

| Deliverable | Status | Completion | Confidence | Current evidence | Main remaining gap | Next action |
|---|---|---:|---|---|---|---|
| D1 — Multi-Wallet Portfolio & "Active Signer" Model | Partial | 60% | Medium | Grouped multi-wallet behavior real (add/remove/refresh/select); backend grouping by persistent `userId`; per-wallet balances; raw SQL v2 tables (`user_wallets`, `wallet_balance_snapshots`, `wallet_protocol_positions`) | "Active Signer" vs "watch-only" not formalized (model + UI); position aggregation beyond balances is thin | Define + document active-signer vs watch-only semantics |
| D2 — In-App Alerting Engine | Early | 10% | Low | Product direction exists; some notification-like UI | No rule/preference model, evaluator, storage, or notification lifecycle | Minimal rule model + periodic evaluator over `*_metrics_latest` deltas (one rule family first) |
| D3 — Bridge Flow Monitoring | Early | 5% | Low | Grant-level intent only | No Allbridge adapter, normalized inflow model, or dashboard slice | Define inflow model + build the Allbridge attribution adapter |

---

# Tranche 3 — Mainnet / Operational maturity

| Deliverable | Status | Completion | Confidence | Current evidence | Main remaining gap | Next action |
|---|---|---:|---|---|---|---|
| D1 — Mainnet Deployment & Freshness Tracking | Partial | 40% | Medium | Real Mainnet data already powers Blend, Soroswap, Aquarius, native DEX; refresh jobs operational; persisted timestamps | Stale detection + exponential backoff + UI staleness not first-class; production topology + health visibility; **DeFindex coverage belongs here** (scaffolded `run:defindex`/`@defindex/sdk`, not validated) | Make the freshness system first-class; complete + validate DeFindex |
| D2 — Non-Custodial Mainnet Actions | Early | 5% | Low | Wallet foundation exists | Depends entirely on T1-D3; hard KPIs (50+ unique mainnet wallets, 200+ mainnet transactions) | Finish T1-D3 first, then extend to mainnet narrowly |
| D3 — Observability, UI/UX Polish & Reference Handoff | Early | 20% | Low | `docker-compose.yml` (Postgres+Redis) exists as local-dev stack; architecture is modular; docs effort started | Real `/health` + RPC latency/error metrics; packaged SDF reference implementation + docs; final report w/ adoption metrics (depends on T3-D2 KPIs) | Add health/metrics endpoints incrementally |

---

## Strongest areas right now
1. Horizon + Soroban indexing foundation (verified coverage + freshness)
2. Protocol analytics architecture (raw SQL v1 pipeline → `/v1/*`)
3. Backend/API foundation
4. Grouped multi-wallet portfolio flows (raw SQL v2)
5. Wallet balance snapshot/refresh flows
6. Protocol/pool exploration experience
7. Clear separation between web, api, and indexer

## Weakest areas right now
1. Transaction builder / action execution
2. Alerting engine
3. Bridge monitoring
4. Freshness/stale/retry operationalization + observability
5. Deployment maturity
6. Remaining frontend/API external-provider dependency (`/v1/network/stats`)

## Best near-term tranche wins
1. T1-D1 evidence package (closest claim)
2. T1-D2 API centralization (network stats) + polish
3. T1-D3 scoped to ONE Testnet action
4. T2-D1 active-signer model formalization

---

## Update rule

Update when: a deliverable moves in maturity, a blocker is removed, a gap becomes clearer, the next
tranche-critical target changes, or a partial area becomes substantially done. When in doubt, prefer
realism over optimism. Mirror any status change into `docs/grant-roadmap.md` (interpretation layer)
and `docs/current-state.md`.