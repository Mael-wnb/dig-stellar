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

- Current phase: **T3 execution sprint** (internal target: Aug 15). T1 (MVP) and T2 submissions are
  both **filed and awaiting SCF validation** (neither validated nor paid yet — nothing pending on
  our side).
- T3 headline: **T3-D1 is DONE in prod** (Aug 4 — DeFindex live as the 5th protocol ≈$18.8M,
  first-class freshness + standardized backoff retries; demo capture remaining) and **T3-D2 mainnet
  swaps are LIVE** (ungated Aug 2 behind kill-switch + 100 XLM cap + issuer-verified 5-pair
  whitelist; first real swaps executed both directions). The KPI window (50+ wallets / 200+ txs)
  is open.
- Closest tranche-critical targets: T3-D2 KPIs (adoption — distribution push starts now), Lot A2
  (Blend deposit mainnet; testnet-proven `a842f370…`), T3-D3 (**Lot C design-handoff port DONE** —
  shell + 5 views + modals on real data, `/v1/pools/:slug/flows` + `/series` added; observability +
  reference packaging still open).
- Biggest current risk: **the T3-D2 KPIs** — they cannot be built, only accumulated; every day of
  the open window counts.
- Main execution goal: KPI push + A2 + T3-D3, converging on the Aug 15 internal target.
- T3-D3 note (2026-08-05): the full UI port to the co-founder's Claude Design handoff landed green
  (web build + 49 tests + api build; captures in `docs/evidence/lot-c/`). Remaining T3-D3: RPC
  latency/error metrics endpoints + CI/CD, and the final demo/reference packaging. Liquidity actions
  (Lot D) intentionally deferred — Add/Remove-liquidity tabs ship present-but-disabled.
- Last updated: 2026-08-05

---

# Tranche 1 — MVP (reviewed for the SCF 20% disbursement)

| Deliverable | Status | Completion | Confidence | Current evidence | Remaining (post-claim / out of contract) | Next action |
|---|---|---:|---|---|---|---|
| D1 — Data Indexing Foundation (Horizon & Soroban) | Done | 100% | High | Hybrid Horizon+Soroban ingestion live into one Postgres DB; canonical `job:refresh` pipeline (72→71→steps) writing raw SQL v1; **prod (Jun 18–19)**: 4 protocols aggregated — Blend 3 pools (≈$192M) *(YieldBlox added Jun 26 → 4 active Blend pools ≈$166M; Forex excluded — frozen oracle)*, Aquarius 4 (≈$22.7M), stellar-native 9 (≈$6.2M), Soroswap 1 active (≈$130k); synchronous `as_of` across protocols within one refresh cycle, observed advancing over consecutive cycles; cron every 15 min on the VPS (within the 5–15 min criterion); served via `/v1/*` | Freshness exposure in the API and retry/backoff standardization (belongs to T3-D1); DeFindex (T3) | Capture evidence in the demo video (live `/v1/protocols`, `/v1/pools`) |
| D2 — Analytics Dashboard MVP | Done | 100% | High | Public beta live at `stellar.getdig.ai` (Vercel); protocol/pool views show TVL/volume/APY from indexed data; Stellar Wallets Kit integrated; runs on real Mainnet data (over-delivery vs the "Testnet data" wording); **`GET /v1/network/stats` DB-backed** (`network_stats_latest` via indexer step `73`); `protocolCount` now dynamic = 4; "native" rendered as "XLM"; Blend panel trimmed to real metrics | Responsive pass + stale/loading/error consistency (polish, not a criterion); two network-stats fields (`activeWallets`, `dexVolume24hUsd`) null from a stale stellar.expert endpoint (pre-existing, minor) | Show the live dashboard in the demo video |
| D3 — Smart Transaction Builder (Testnet) | Done | 100% | High | **Fully successful SDEX swap on Testnet from the UI (Jun 19)**: `POST /v1/actions/sdex/swap` builds a multi-op XDR (`ChangeTrust` + `PathPaymentStrictSend`) on the native SDEX, signed in-wallet via Freighter/Wallets Kit, executed on-chain — tx `fb10c5b8d86b87bc3408bf0d4e9698f93370a3e788244008ef31f6200a12b8b2`, **Successful** (10 XLM → 5.91 USDC, min-receive respected). Live quote endpoint (`/v1/actions/sdex/quote`, Horizon strict-send) drives auto-slippage so swaps fill reliably. Backend never touches keys. All three SCF criteria met. | Blend deposit (Soroban, sequential — beyond the single-XDR criterion; relates to T3-D2) now exercised from the UI and **proven on testnet** (deposit tx `a842f370…`); minor `getAssetBalance` re-bundles `ChangeTrust` when trustline exists | Capture the live swap in the demo video |

**Note on the single-XDR criterion.** Stellar Protocol 20 forbids mixing `InvokeHostFunction`
(Soroban) with classic operations in one envelope, so the grant's literal `ChangeTrust + Deposit`
single-XDR is demonstrated via the **classic SDEX path** (`ChangeTrust` + `PathPaymentStrictSend`).
The Blend deposit is a secondary Soroban pattern (two sequential txs) and is not required by the
T1-D3 criteria.

---

# Tranche 2 — Expansion (internal; reviewed later for the 30% disbursement)

| Deliverable | Status | Completion | Confidence | Current evidence | Main remaining gap | Next action |
|---|---|---:|---|---|---|---|
| D1 — Multi-Wallet Portfolio & "Active Signer" Model | Done | 100% | High | **Gap A done (criteria 1 + 3):** active-signer vs watch-only formalized — `user_wallets.is_active_signer` (DB-enforced singleton), `PATCH /v1/wallets/:id/signer`, Kit-connect auto-promotes, watch-only add-path, UI badges + signing guardrail. **Gap B done (criterion 2 — full stack):** Part 1 resolver (`lib/protocols/blend/{fetch-user-positions,resolve-user-health}` + `81-…`) writes per-asset supply/borrow → `wallet_protocol_positions` + per-pool `health_factor` → `wallet_pool_health` (SDK `PositionsEstimate`, NULL = no debt), non-fatal in `refreshWallet`. Part 2 surfaces it: `GET /v1/wallets/:id/positions` + a `defi` block on `/overview` (Σ supplied/borrowed/net + per-(wallet,pool) health, riskiest first, **latest-snapshot filter** so closed positions don't linger), plus the UI portfolio slice (consolidated "DeFi positions (Blend)" header + per-wallet supplied/borrowed/HF with colour states). Validated on mainnet (borrower HF 1.11/1.32 = collateral/debt; phantom-snapshot + empty cases confirmed; `apps/web build` green). Plus prior: grouped multi-wallet, per-wallet balances, raw SQL v2. **Jun 26:** YieldBlox indexed as a 4th active Blend pool, closing the position-coverage gap — the resolver is entity-driven, so positions resolve across all active pools (test wallets re-resolved clean: `GAZXV3PH…` shows both legs — fixed-pool supply ≈$50.9k / borrow EURC ≈$28.9k, HF ≈1.33 + yieldblox supply native ≈$26.8k / borrow USDC ≈$15.0k, HF ≈1.27). **Jul 22:** the final visual HF cross-check vs the mainnet.blend.capital UI on `GAZXV3PH…` was performed and **matched**. | — | Complete — all three criteria met; HF now feeds D2's live alerting. Non-Blend LP positions (Soroswap/Aquarius) and cryptographic proof-of-ownership are post-beta / out of contract. |
| D2 — In-App Alerting Engine | Done — live in prod | 100% | High | **Both SCF criteria met and verified end-to-end live in prod on the VPS.** Rule storage + periodic evaluation over the snapshot DB + in-app notifications: as-built is a periodic **OS-cron sweep** (scripts `82`→`81`→`83`, `job:wallet-alert`) — no broker, no in-process scheduler — writing a `notifications` row on each fire/resolve edge; tables `alert_rules` / `alert_rule_state` / `notifications` (`stellar_v3_alerting.sql`, depends on v1 entities + v2 `user_wallets`); endpoints `GET/POST /v1/alert-rules` + `GET /v1/notifications`; web notification **bell** + full **Alerts page** (`AlertsView` + 4-step `AlertRuleModal`) + compact dashboard **`WalletAlertsPanel`** — all on the shared `useAlerts` state (HTTP polling), creation gated to wallet·health-factor; first rule family = health-factor risk (consumes T2-D1's `wallet_pool_health`). **Live in prod:** `stellar_v3_alerting.sql` applied on the VPS and the `job:wallet-alert` cron scheduled (82→81→83 sweep); contract validated against the live API; create round-trip confirmed; and the fire path is proven by **real `alert_fired` notifications in the prod DB** from the evaluator on live Blend HF (YieldBlox 1.274<1.5, Fixed 1.353<1.85). Matches the verbatim criterion (rules evaluated against the snapshot DB → in-app notifications). | — | Complete — live in prod, captured in the ~5-min submission demo video. Optional polish: derive notification severity from `payload` rather than `kind`. |
| D3 — Bridge Flow Monitoring | Done — live in prod | 100% | High | **Both SCF criteria met and live in prod on the VPS.** (1) Allbridge Core adapter live (`apps/indexer/.../allbridge/`): inflow + outflow events via Soroban `getEvents`, per-source-chain attribution (inflow via `receive_tokens` arg parse), `bridge_flows` table + `amount_usd`, wired non-fatal into `job:refresh`, idempotent on rescan; verified against mainnet (inflow BAS, outflows SOL/POL/CEL/BAS). (2) API `GET /v1/bridge/summary` (24h/7d/30d window — inflow/outflow by source chain + net) + `GET /v1/bridge/flows` (recent feed) via `apps/api/src/modules/bridge/`, on-read aggregation (no metrics table). (3) Dashboard bridge section: one full-width Paul-DA card (`components/bridge/` — `BridgeSection` + `BridgeChart` + `BridgeRoutesTable` + `BridgeFlowsFeed`) fed by the extended `useBridge`: stat strip + inflow/outflow-and-cumulative-net chart (`24h/7d/30d`, default 7d) + tabs (per-chain **Routes** table with click-to-scope + sortable columns, **Recent flows** feed `chain → Stellar`). All on real `/v1/bridge/*` data — chart uses the gap-filled `/bridge/series` for unscoped 7d/30d and client-buckets `/bridge/flows` for 24h/chain-scoped; stat strip authoritative from `/bridge/summary`; real chains only (BAS/SOL/POL/CEL/…), no mock figures. Wired into `DigDashboard.vue`. **Deployed:** `stellar_v1_bridge.sql` applied on the VPS and the `allbridge-upsert-core.ts` bootstrap run, so prod `bridge_flows` is populated and the live section renders real flows. | — | Complete — live in prod, captured in the ~5-min submission demo video. Honest constraint kept in UI copy: Soroban `getEvents` retains ~7 days → rolling recent-flows view, not deep history. |

---

# Tranche 3 — Mainnet / Operational maturity (internal; reviewed for the 40% disbursement)

| Deliverable | Status | Completion | Confidence | Current evidence | Main remaining gap | Next action |
|---|---|---:|---|---|---|---|
| D1 — Mainnet Deployment & Freshness Tracking | Done in prod | 95% | High | **Both criteria met, deployed to prod Aug 4 (Lot B).** (1) All 5 named protocols live on real Mainnet data — **DeFindex integrated into the v1 pipeline** (venue + 3 vaults enumerated from `GET /vault/discover`: Meru ≈$18.1M, Beans USDC ≈$507k, Beans EURC ≈$200k; ≈$18.8M aggregate, avg APY ≈7.1%; `protocolCount = 5`; yield-vault detail variant in the UI). (2) Freshness first-class: `isStale` + `staleAfterSeconds` on every `/v1/*` payload (read-time, threshold 45 min = 3× cron), FreshnessChip + stale badges in the UI, standardized exponential-backoff retries on every refresh step. Evidence in `docs/evidence/lot-b/`. Full prod `job:refresh` clean in ~3 min | **Demo capture** for the claim (only non-build item) | Capture the T3-D1 demo (5 protocols + stale drill) |
| D2 — Non-Custodial Mainnet Actions | Substantially done — swaps live | 60% | Medium | **Mainnet swaps LIVE from the dashboard** (ungated Aug 2): first real executions in both directions (1 XLM→USDC; USDC→XLM `eeeae199…`). Security regime verified in prod: kill-switch (403 by default), server-enforced 100 XLM cap, issuer-verified 5-pair whitelist (XLM↔USDC/EURC/AQUA/yXLM/PYUSD — look-alike "XRP" rejected), client-side pre-sign XDR validation (fail closed), in-wallet signing only. Execution feedback UI with network-aware explorer links. Contract: `docs/security-invariants.md`; evidence: `docs/evidence/mainnet-ungating-2026-08-02.md` + `pair-vetting-2026-08-01.md`. Blend deposit already E2E-proven on **testnet** (`a842f370…`) | **KPIs** (50+ wallets / 200+ txs — window open, needs distribution) + **Lot A2** (Blend deposit mainnet) | KPI push now; A2 brief → implement |
| D3 — Observability, UI/UX Polish & Reference Handoff | Early | 25% | Low | `docker-compose.yml` (Postgres+Redis) as local-dev stack; `/health` liveness; modular architecture; docs corpus grown (security-invariants + `docs/evidence/` with vetting/ungating/lot-b captures) | Real RPC latency/error metrics; **sidebar UX redesign** (user-directed polish scope); packaged SDF reference implementation; final report w/ adoption metrics (depends on T3-D2 KPIs) | Sidebar redesign + metrics endpoints |

---

## Strongest areas right now
1. Indexing foundation at 5 protocols (Horizon + Soroban + DeFindex API), verified prod coverage, ~3-min refresh on a 15-min cron, standardized backoff retries
2. **Live mainnet non-custodial actions**: SDEX swap in prod, both directions executed, defense in depth (kill-switch / cap / whitelist / client XDR gate)
3. First-class freshness: read-time staleness on every `/v1/*` payload + explicit UI indicators
4. Backend/API as the single façade (network stats, protocol metrics, freshness all DB-backed)
5. Public beta dashboard on real Mainnet data (5 protocols incl. DeFindex yield vaults)
6. Grouped multi-wallet portfolio + live alerting + bridge monitoring (T2 group, in prod)
7. Evidence discipline: `docs/security-invariants.md` + `docs/evidence/` corpus, claim-ready

## Weakest areas right now
1. **T3-D2 KPIs** — adoption can't be built, only accumulated; distribution push not yet started
2. Observability beyond freshness (RPC latency/error metrics) + CI/CD (still manual VPS deploy) — T3-D3
3. Blend deposit mainnet (Lot A2) not yet extended from its proven testnet path
4. UI polish debt: sidebar redesign pending; responsive + loading/error consistency partial

## Best near-term tranche wins
1. T3-D1 demo capture → claim-ready (everything else already live in prod)
2. KPI distribution push — the swap is live; every announcement day counts toward 50/200
3. Lot A2 (Blend deposit mainnet) → completes T3-D2 criterion 1
4. Sidebar redesign + metrics endpoints → T3-D3 momentum before the final report

---

## Update rule

Update when: a deliverable moves in maturity, a blocker is removed, a gap becomes clearer, the next
tranche-critical target changes, or a partial area becomes substantially done. When in doubt, prefer
realism over optimism. Mirror any status change into `docs/grant-roadmap.md` (interpretation layer)
and `docs/current-state.md`.