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
- Lot A3 note (2026-08-13): **in-app Blend WITHDRAW is built and testnet-proven E2E** — the
  supply↔withdraw loop is now complete in the action modal (supply tx `b199a1d7…` + withdraw tx
  `322d760e…`, both confirmed on-chain; `docs/evidence/lot-a3-blend-withdraw.md`). Not required by
  any SCF criterion (T3-D2's "vault/lending interactions" is satisfied by the deposit) — product
  completeness before the advisor re-review. It rides the SAME kill-switch as the deposit (no new
  flag), so it is testnet-only until `ACTIONS_MAINNET_BLEND_ENABLED` is set. **Awaiting: review,
  then the mainnet supply+withdraw pair via Maël's wallet** (T3-D2 bonus evidence). Carried a
  Soroban resource-headroom fix that also hardens the deposit path (INV-3.1b).
- T3-D3 note (2026-08-05): the full UI port to the co-founder's Claude Design handoff landed green
  (web build + 49 tests + api build; captures in `docs/evidence/lot-c/`). Remaining T3-D3: RPC
  latency/error metrics endpoints + CI/CD, and the final demo/reference packaging. Liquidity actions
  (Lot D) intentionally deferred — Add/Remove-liquidity tabs ship present-but-disabled.
- T3-D3 note (2026-08-11): **Lot F (advisor-feedback polish) landed** — F1 AA-contrast `--dig-faint`
  + global scrollbars, F2 API spendable-balance preflight (`400 INSUFFICIENT_SPENDABLE_BALANCE`) on
  swap + Blend deposit, F3 backend-served venue/asset logos with safe fallback, F4 designed no-wallet
  + get-started empty states + honest failed-tx copy. All steps green (web build + 49 tests);
  validators/flags regime untouched. Captures in `docs/evidence/lot-f/`. Remaining T3-D3 unchanged:
  RPC latency/error metrics endpoints + CI/CD + final demo/reference packaging.
- T3-D3 note (2026-08-12): **Lot G (dashboard & protocols polish) landed** — traced to a founder
  product review. G0 network-TVL persistence (new `network_tvl_snapshots`, one point per refresh cycle;
  deployed — prod confirmed 4 points 15:03→15:48 UTC). G1 bridge chain logos (top-7 by volume, safe
  fallback) + clickable network-aware tx hashes + rigid 3-slot protocol cards. G2 hero dedupe + inline
  actions section → compact Swap/Deposit button on the existing `ActionModal` (flags/validators
  byte-identical, swap ≤2 clicks). G3 adaptive per-tab columns on the all-pools table (no half-dash
  rows, N/A-aware sort). G4 hero 7-day network-TVL curve from `GET /v1/network/tvl-series` (snapshots
  path per the recon verdict — honest gaps + "building history since" note). All steps green (web build
  + 49 tests + api build); validators/flags untouched. Captures in `docs/evidence/lot-g/`. Remaining
  T3-D3 unchanged: RPC latency/error metrics endpoints + CI/CD + final demo/reference packaging.
- T3-D3 note (2026-08-12, evening): **Lot H (second polish pass) landed — code-complete, VPS deploy
  pending** (indexer + api touched; founder deploys with build + PM2 restart). Traced to the second
  founder product review. **H0** flows recon: the permanent-$0 "Inflows & outflows" root-caused to
  amount-less Aquarius liquidity rows + a stale one-day legacy Blend backfill wrongly granting
  coverage — the Lot C hide rule itself worked (report: `docs/evidence/lot-h/h0-flows-recon.md`).
  **H1** all modals teleport to `<body>` — the alert modal opened off-viewport (top −130px at
  1280×720) under a transform-carrying ancestor; every modal verified fully visible at 720p.
  **H2** dashboard: protocols box half-width + compact "Your positions" panel reusing the F4 state
  machinery via `compact` props (no forks), the shared wallets/overview store (no new fetch), liquid
  vs DeFi supplied/borrowed kept distinct, top-3 Blend positions with the shared HF colour rule;
  stacks below 1100px. **H3** Uniswap-standard swap reskin, presentation-only — custom `TokenSelect`
  over the SAME asset whitelist; script diff = one import, validators/flags/whitelists 0 lines
  changed, template binding sets proven identical. **H4** measurable flows coverage: covered = ≥1
  flow-family event with computable USD, excluding the superseded `28-blend-events-scaled` backfill
  (Blend hides; no permanent-$0 section anywhere) + Aquarius/Soroswap liquidity-amount extraction
  (Aquarius shape probe-verified live; upsert repaired in-retention rows) + `coverageSince` honest
  window copy. All green (web build + 49 tests + api build). Captures in `docs/evidence/lot-h/`.
  Post-deploy: one-time per-pool Aquarius event backfill (`LEDGER_LOOKBACK=115000
  MAX_EVENT_PAGES=200`) to capture the full ~7d RPC retention. Remaining T3-D3 unchanged: RPC
  latency/error metrics endpoints + CI/CD + final demo/reference packaging.
- T3-D3 note (2026-08-13): **Lot E E1+E2 landed (observability) — local-proven, VPS deploy pending.**
  **E1** enriched `GET /health`: `status` ok|degraded, `version` (GIT_SHA env, runbook updated),
  db latency, per-venue freshness (shared 45-min rule), `lastRefreshAt`; always HTTP 200 with a
  readable status (503 only if DB unreachable); degraded state proven by aging a row. **E2** RPC
  latency percentiles + error rates (the verbatim grant criterion): capture at the two real choke
  points (global `fetch` + the shared axios copy used by stellar-sdk/blend-sdk/defindex-sdk),
  per-run per-target rows in `rpc_metrics_runs` + queryable step outcomes in `refresh_step_runs`
  (new `stellar_v1_ops_metrics.sql`, applied local; **apply on VPS at deploy**), served by
  `GET /v1/ops/metrics` (24h window; error rate aggregated, percentiles strictly per-run). Proven
  with 2 real refresh runs + 1 forced-failure run (bogus RPC: errors counted, FAILED steps queryable).
  Known boundary: indexer calls only (API-side Horizon preflight not captured). Evidence:
  `docs/evidence/lot-e/`.
- T3-D3 note (2026-08-13, later): **Lot E E3+E4 landed — Lot E build COMPLETE, VPS deploy pending.**
  **E3** adoption counters: `action_events` (one row per successful server-side build; fire-and-forget
  insert) + `GET /v1/ops/adoption` (wallets total/signers/watch-only/distinct users, builds by
  kind/network 24h/7d/total, distinct acting addresses; builds-not-executions boundary stated in the
  payload). Proven live on testnet: quote + swap-build + trustline-build each visibly incremented.
  **E4** reference packaging: compose parameterized (ports/prefix/project-name), `.env.example` per
  app (api new; indexer corrected — `STELLAR_SOURCE_ACCOUNT` is required by aquarius), NEW
  `bootstrap:core`/`bootstrap:export` (committed `registries/core-registry.json` — the legacy
  per-protocol bootstraps were un-runnable: their tmp/discovery registries no longer exist),
  `docs/reference-deployment.md` quickstart **proven from a fresh copy, no secrets, side-by-side
  stack**: 9/10 steps green (defindex needs its API key, documented), dashboard served with
  production-matching TVLs. CI bonus: `.github/workflows/ci.yml` (build+test on push; runs on first
  push). **Known issue flagged for follow-up:** Soroswap+Aquarius reserve TVL reads
  `reserve_snapshots` that nothing on the live path writes — production values frozen at 2026-03-19
  reserves (× live prices); live writer = its own change, deliberately not in Lot E. Evidence:
  `docs/evidence/lot-e/`. Remaining T3-D3: evidence assembly + final demo (no build work left).
- Last updated: 2026-08-13

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
| D3 — Observability, UI/UX Polish & Reference Handoff | In progress | 45% | Medium | **UI/UX-polish component substantially landed** across Lots C/F/G/H (design-handoff port → shell + 5 views + modals; advisor-feedback F1–F5; founder-review G0–G4: TVL history + chain logos + clickable tx hashes + adaptive pools table + hero dedupe/compact actions + network-TVL hero chart; founder-review-2 H0–H4: modal teleport fix, dashboard "Your positions" panel, Uniswap-standard swap reskin, measurable flows coverage + Aquarius/Soroswap liquidity-amount extraction — **H deploy pending**) — all green (web build + 49 tests + api build), captures in `docs/evidence/lot-{c,f,g,h}/`. Plus `docker-compose.yml` local-dev stack, `/health` liveness, modular architecture, grown docs corpus | Real RPC latency/error metrics + CI/CD (still manual VPS deploy); packaged SDF reference implementation; final report w/ adoption metrics (depends on T3-D2 KPIs) | Deploy Lot H (build + PM2 restart + Aquarius event backfill), then observability (RPC latency/error metrics) + CI/CD, then reference packaging |

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