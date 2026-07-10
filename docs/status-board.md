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

- Current phase: T1 (MVP) submitted & **awaiting SCF validation** (not yet validated, approved,
  or paid). The **T2 deliverable group is now essentially complete and live in prod**, and is
  being packaged for the **Tranche 3 (30%)** submission.
- Current focus: package the T2 (Tranche 3) claim — T2-D1 portfolio/active-signer (substantially
  done; final visual HF cross-check vs blend.capital the last open item), T2-D2 in-app alerting
  (**live in prod on the VPS** — `stellar_v3_alerting.sql` + `job:wallet-alert` cron running, real
  `alert_fired` notifications in prod; demo capture remaining), T2-D3 bridge monitoring (**live in
  prod** — `stellar_v1_bridge.sql` applied + Allbridge bootstrap run, `bridge_flows` populated;
  demo capture remaining)
- Closest tranche-critical targets: the T2 group — all three deliverables meet their SCF criteria
  and now run in prod; remaining is demo capture (+ D1's one visual HF cross-check), not build
- Biggest current risk: none blocking — the remaining T2 items are demo capture + one visual
  cross-check, not new implementation or deployment
- Main execution goal: assemble the T2 (Tranche 3) submission (demo video + evidence links) and
  close D1's blend.capital HF cross-check
- Last updated: 2026-07-10

---

# Tranche 1 — MVP (reviewed for the SCF 20% disbursement)

| Deliverable | Status | Completion | Confidence | Current evidence | Remaining (post-claim / out of contract) | Next action |
|---|---|---:|---|---|---|---|
| D1 — Data Indexing Foundation (Horizon & Soroban) | Done | 100% | High | Hybrid Horizon+Soroban ingestion live into one Postgres DB; canonical `job:refresh` pipeline (72→71→steps) writing raw SQL v1; **prod (Jun 18–19)**: 4 protocols aggregated — Blend 3 pools (≈$192M) *(YieldBlox added Jun 26 → 4 active Blend pools ≈$166M; Forex excluded — frozen oracle)*, Aquarius 4 (≈$22.7M), stellar-native 9 (≈$6.2M), Soroswap 1 active (≈$130k); synchronous `as_of` across protocols within one refresh cycle, observed advancing over consecutive cycles; cron every 15 min on the VPS (within the 5–15 min criterion); served via `/v1/*` | Freshness exposure in the API and retry/backoff standardization (belongs to T3-D1); DeFindex (T3) | Capture evidence in the demo video (live `/v1/protocols`, `/v1/pools`) |
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
| D1 — Multi-Wallet Portfolio & "Active Signer" Model | Substantially done | 95% | High | **Gap A done (criteria 1 + 3):** active-signer vs watch-only formalized — `user_wallets.is_active_signer` (DB-enforced singleton), `PATCH /v1/wallets/:id/signer`, Kit-connect auto-promotes, watch-only add-path, UI badges + signing guardrail. **Gap B done (criterion 2 — full stack):** Part 1 resolver (`lib/protocols/blend/{fetch-user-positions,resolve-user-health}` + `81-…`) writes per-asset supply/borrow → `wallet_protocol_positions` + per-pool `health_factor` → `wallet_pool_health` (SDK `PositionsEstimate`, NULL = no debt), non-fatal in `refreshWallet`. Part 2 surfaces it: `GET /v1/wallets/:id/positions` + a `defi` block on `/overview` (Σ supplied/borrowed/net + per-(wallet,pool) health, riskiest first, **latest-snapshot filter** so closed positions don't linger), plus the UI portfolio slice (consolidated "DeFi positions (Blend)" header + per-wallet supplied/borrowed/HF with colour states). Validated on mainnet (borrower HF 1.11/1.32 = collateral/debt; phantom-snapshot + empty cases confirmed; `apps/web build` green). Plus prior: grouped multi-wallet, per-wallet balances, raw SQL v2 | Blend-only (Soroswap/Aquarius LP positions post-beta); **the one open item is the final visual HF cross-check vs the blend.capital UI**; v2 schema is now live in prod (D2 alerting consumes `wallet_pool_health` there). | D1 essentially complete — HF now feeds D2's first alert family, which runs live in prod. **Jun 26:** YieldBlox indexed as a 4th active Blend pool, closing the position-coverage gap — the resolver is entity-driven, so positions now resolve across all active pools. Test wallets re-resolved clean: `GCSQXZ…` YieldBlox supply ≈$1014 (HF null, no debt); `GAZXV3PH…` shows both legs — fixed-pool (supply ≈$50.9k / borrow EURC ≈$28.9k, HF ≈1.33) + yieldblox (supply native ≈$26.8k / borrow USDC ≈$15.0k, HF ≈1.27). Visual blend.capital UI cross-check on `GAZXV3PH…` still recommended before D2 builds liquidation alerts. Optional polish: cryptographic proof-of-ownership (deferred), non-Blend positions |
| D2 — In-App Alerting Engine | Substantially done — live in prod | 95% | High | **Both SCF criteria met and verified end-to-end live in prod on the VPS.** Rule storage + periodic evaluation over the snapshot DB + in-app notifications: as-built is a periodic **OS-cron sweep** (scripts `82`→`81`→`83`, `job:wallet-alert`) — no broker, no in-process scheduler — writing a `notifications` row on each fire/resolve edge; tables `alert_rules` / `alert_rule_state` / `notifications` (`stellar_v3_alerting.sql`, depends on v1 entities + v2 `user_wallets`); endpoints `GET/POST /v1/alert-rules` + `GET /v1/notifications`; web notification **bell** + full **Alerts page** (`AlertsView` + 4-step `AlertRuleModal`) + compact dashboard **`WalletAlertsPanel`** — all on the shared `useAlerts` state (HTTP polling), creation gated to wallet·health-factor; first rule family = health-factor risk (consumes T2-D1's `wallet_pool_health`). **Live in prod:** `stellar_v3_alerting.sql` applied on the VPS and the `job:wallet-alert` cron scheduled (82→81→83 sweep); contract validated against the live API; create round-trip confirmed; and the fire path is proven by **real `alert_fired` notifications in the prod DB** from the evaluator on live Blend HF (YieldBlox 1.274<1.5, Fixed 1.353<1.85). Matches the verbatim criterion (rules evaluated against the snapshot DB → in-app notifications). | Deploy done — the only remaining item is **demo capture** for the submission | Capture the live alert (create rule → `alert_fired` → bell/Alerts page) in the demo video; optional polish: derive notification severity from `payload` rather than `kind` |
| D3 — Bridge Flow Monitoring | Substantially done — live in prod | 95% | High | **Both SCF criteria met and live in prod on the VPS.** (1) Allbridge Core adapter live (`apps/indexer/.../allbridge/`): inflow + outflow events via Soroban `getEvents`, per-source-chain attribution (inflow via `receive_tokens` arg parse), `bridge_flows` table + `amount_usd`, wired non-fatal into `job:refresh`, idempotent on rescan; verified against mainnet (inflow BAS, outflows SOL/POL/CEL/BAS). (2) API `GET /v1/bridge/summary` (24h/7d/30d window — inflow/outflow by source chain + net) + `GET /v1/bridge/flows` (recent feed) via `apps/api/src/modules/bridge/`, on-read aggregation (no metrics table). (3) Dashboard bridge section: one full-width Paul-DA card (`components/bridge/` — `BridgeSection` + `BridgeChart` + `BridgeRoutesTable` + `BridgeFlowsFeed`) fed by the extended `useBridge`: stat strip + inflow/outflow-and-cumulative-net chart (`24h/7d/30d`, default 7d) + tabs (per-chain **Routes** table with click-to-scope + sortable columns, **Recent flows** feed `chain → Stellar`). All on real `/v1/bridge/*` data — chart uses the gap-filled `/bridge/series` for unscoped 7d/30d and client-buckets `/bridge/flows` for 24h/chain-scoped; stat strip authoritative from `/bridge/summary`; real chains only (BAS/SOL/POL/CEL/…), no mock figures. Wired into `DigDashboard.vue`. **Deployed:** `stellar_v1_bridge.sql` applied on the VPS and the `allbridge-upsert-core.ts` bootstrap run, so prod `bridge_flows` is populated and the live section renders real flows. | Deploy done — the only remaining item is **demo capture**. Honest constraint kept in UI copy: Soroban `getEvents` retains ~7 days → rolling recent-flows view, not deep history | Capture the live bridge section (real prod `bridge_flows`) in the demo video |

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
1. Freshness/stale/retry operationalization + observability (T3)
2. Deployment maturity / CI-CD (still manual VPS deploy)
3. Transaction builder breadth: SDEX swap proven; Blend deposit not yet exercised from UI
4. T2-D1 — the one outstanding visual HF cross-check vs the blend.capital UI (last open T2 item)
5. T2 submission packaging — the three T2 deliverables are live in prod; demo capture is the last non-build gap

## Best near-term tranche wins
1. SCF Tranche 3 (30%) submission — the T2 deliverable group is live in prod and claim-ready (D1 portfolio/active-signer, D2 live alerting, D3 live bridge)
2. Demo video covering the three T2 deliverables (plus the T1 MVP walkthrough while the Tranche 2 review is still open)
3. Close T2-D1's visual HF cross-check vs the blend.capital UI (last open T2 item)

---

## Update rule

Update when: a deliverable moves in maturity, a blocker is removed, a gap becomes clearer, the next
tranche-critical target changes, or a partial area becomes substantially done. When in doubt, prefer
realism over optimism. Mirror any status change into `docs/grant-roadmap.md` (interpretation layer)
and `docs/current-state.md`.