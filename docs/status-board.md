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
  actions are LIVE and evidenced end-to-end** (swaps ungated Aug 2 behind kill-switch + 100 XLM cap
  + issuer-verified 5-pair whitelist; Aug 14: multi-pool Blend supplies + the withdraw closing the
  supply↔withdraw loop on Pubnet, all Horizon-verified — `docs/evidence/t3-d2-mainnet-actions.md`).
  The KPI window (50+ wallets / 200+ txs) is open.
- T3-D1 addendum — **AMM perimeter widened (Aug 16, Lot P):** Aquarius 4→21 pools (≈$41M), Soroswap
  1→4 pairs (≈$1.18M), +5 priced assets (USDY/yXLM/yUSDC/BTC/ETH). Locally validated (2 refresh runs
  green, TVL cross-check 24/25 within ±3.1%, total 381s vs 251s baseline — inside cadence).
  **VPS seed pending founder SSH confirmation.** The cross-check exposed a dead CoinGecko `cetes`
  feed (≈½ market price; predated Lot P) — ruled + fixed same day (manual rule $0.069, vetted vs
  pool-implied + Aqua oracle, confidence: low; robust Aquarius-derived fix on the fast-follow
  list). Evidence: `docs/evidence/lot-p/`.
- Closest tranche-critical targets: T3-D2 KPIs (adoption — the 5 XLM witness-gated reward
  campaign is LIVE since Aug 17 and `action_witnesses` counts executions automatically; the
  execution evidence itself is complete), T3-D3 (**Lot C design-handoff port DONE** —
  shell + 5 views + modals on real data, `/v1/pools/:slug/flows` + `/series` added; observability
  DONE Lot E Aug 13; **reference packaging DONE Lot Z Aug 18** — remaining: final report + demo).
- Biggest current risk: **the T3-D2 KPIs** — they cannot be built, only accumulated; every day of
  the open window counts.
- Main execution goal: KPI push + A2 + T3-D3, converging on the Aug 15 internal target.
- Lot A3 note (2026-08-13): **in-app Blend WITHDRAW is built and testnet-proven E2E** — the
  supply↔withdraw loop is now complete in the action modal (supply tx `b199a1d7…` + withdraw tx
  `322d760e…`, both confirmed on-chain; `docs/evidence/lot-a3-blend-withdraw.md`). Not required by
  any SCF criterion (T3-D2's "vault/lending interactions" is satisfied by the deposit) — product
  completeness before the advisor re-review. It rides the SAME kill-switch as the deposit (no new
  flag), so it is testnet-only until `ACTIONS_MAINNET_BLEND_ENABLED` is set. **The awaited mainnet
  supply+withdraw pair EXECUTED 2026-08-14** (supply `38390736…` 15:29 + withdraw `537a2303…` 16:07,
  same Fixed-pool position — `docs/evidence/t3-d2-mainnet-actions.md`). Carried a
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
- T3-D3 note (2026-08-13, later): **Lot H — H6 landed (display honesty: per-asset position
  breakdown) — local-proven, VPS deploy pending.** Display-only; the data already existed.
  `wallet_protocol_positions` has stored per-asset supply/borrow legs since T2-D1, but the product
  collapsed them into one USD figure per (wallet, pool). **API** (`wallets.service.ts`, additive):
  `/v1/wallets/:id/positions` legs gain `side`/`assetContractId`/`logoUrl` (joined from `assets`),
  and `/v1/wallets/overview` `defi.poolHealth[]` gains `entityId` + a `positions[]` leg array —
  both under the SAME latest-snapshot-per-wallet rule as the USD rollups, so a leg cannot outlive
  its snapshot. **Web**: new shared `PositionAssetChips.vue` (BrandLogo + exact amount + symbol,
  grouped supplied/borrowed) under each position row in `PortfolioView` (both by-position and
  by-wallet modes) and the dashboard `YourPositionsPanel`; new `formatTokenAmount` (deliberately
  NOT `formatCount`, which rounds to whole units and would render 0.42 XLM as "0"). Honest rules
  held: exact stored amounts, nothing synthesized, EVERY leg listed (no top-asset truncation —
  the Fixed pool shows 2 supplied assets + 1 borrowed), absent legs render as absence. USD totals
  unchanged (`defi` totals + `summary` byte-identical before/after). No action path touched.
  All green (api build + 42 tests + web build). Before/after captured headless against the real
  local API: `docs/evidence/lot-h/h6-position-breakdown-2026-08-13.md`.
- T3-D3 note (2026-08-14): **Lot H — H7 landed (display polish on H6) — local-proven, VPS deploy
  pending.** Web-only; no API/schema/indexer/action change. **Chips** now show a compact amount
  (`200k XLM`, `15,041 USDC`) with the EXACT stored amount on the hover title
  (`Supplied 150,007.9838593 XLM`) — precision relocated, not dropped; new
  `formatTokenAmountCompact` + `formatTokenAmountExact` (still deliberately NOT `formatCount`,
  which would render 0.42 XLM as "0"). SUPPLIED/BORROWED labels now render only when both sides
  exist; a supply-only position shows chips alone (a borrow-only one keeps its label — bare chips
  would read as "supplied"). **HF gauge**: new `HealthFactorGauge.vue` replaces the bare "HF 1.23"
  text in PortfolioView (both modes) + the dashboard panel (dense) — continuous red→amber→green
  gradient anchored to the UNCHANGED `utils/health.ts` thresholds (1.2 → 20%, 1.5 → 50% on a
  1.0–2.0 scale, clamped, liquidation at 1.0 stated in the title), marker + numeric value.
  `No borrow` renders NO gauge (text as before) — a full green bar there would invent a safety
  margin. All green (web build + api build + 42 tests). Before/after (H7 before == H6 after,
  md5-verified) in `docs/evidence/lot-h/h7-chips-hf-gauge-2026-08-14.md`.
- T3-D2 note (2026-08-14): **Lot A5 landed (multi-pool Blend actions) — local-proven, VPS deploy
  pending. MONEY PATH.** Supply + withdraw now work on **every indexed Blend pool**, not just Fixed
  (the modal titled the clicked pool while the card was hardcoded to Fixed). §1 inventory verified
  all 4 pools BEFORE any code: Blend's official V2 pool factory answers `is_pool()=true`, all are in
  the backstop reward zone, all share the A2-vetted Fixed pool's wasm hash, `PoolV2.load` succeeds
  (V2), and each label is the pool's own on-chain `metadata.name`. blend.capital is a SPA (empty
  shell to a fetch), so that on-chain verification stands in for the page check — stronger and
  reproducible. **Orbit is XLM-only** (no USDC reserve on-chain); the registry is built from live
  SDK reads because `reserve_snapshots` still holds a stale 2026-04-01 Orbit USDC row that would
  have offered a deposit failing at simulation. API: `resolveBlendPool` (unknown slug → 400, never
  a fallback) + `assertPoolSupportsAsset` (→ 400 naming the pool); pool-contract cache re-keyed from
  network to pool id. Web: per-pool client registry (the gate's anchor), `poolSlug` prop threaded
  from the modal, unknown slug → no form + blend.capital link. Acceptance gate: cross-pool red tests
  over every ORDERED PAIR of real pools, deposit + withdraw, plus cross-TYPE per pool —
  **mutation-tested** (pool-pinning removed → 28 fail; restored → 111/111). Curls: unknown slug 400,
  Orbit+USDC 400, position echoes the pool, no-pool = Fixed, flag off = 403 on all 4 pools × 3
  endpoints. Also fixed the `toLocaleString(undefined)` locale bug. Evidence:
  `docs/evidence/lot-a5-blend-multipool.md`. **The pending real-money item is RESOLVED (2026-08-14,
  see A5b): supplies executed on YieldBlox (`7f5a2c41…` XLM + `d22a0f93…` USDC — still open
  positions) and the supply↔withdraw loop closed on Fixed (`38390736…` + `537a2303…`). Testnet
  re-verify still worth a pass at the next deploy.**
- T3-D2 note (2026-08-14, Lot A5b): **Mainnet execution evidence LANDED + pool-status awareness +
  friendly contract errors. VPS deploy pending.** Five successful Pubnet txs (15:29–15:34 UTC,
  Horizon-verified + XDR-decoded, never from app logs): supplies of 5 XLM → Fixed, 5 XLM →
  YieldBlox, 5 USDC → YieldBlox (the real multi-pool proof — the A5 "supply on a non-Fixed pool"
  pending item is DONE), plus swaps 50 XLM → 7.97 USDC and 10 XLM → 1.38 EURC, **and (16:07 UTC)
  the mainnet WITHDRAW closing the loop: `537a2303…` WithdrawCollateral 4.9999999 XLM from Fixed —
  the exact 15:29 position minus the SDK's round-down. The supply↔withdraw cycle is COMPLETE and
  publicly verifiable on Pubnet.** Post-0c296ef fee check against reality: all four Soroban
  txs bid exactly 10,000 stroops inclusion (max_fee = resourceFee + 10,000) and were charged
  ~46–59% of the ceiling; classic swaps charged the 100/op base (200 total) under a 10,000/op bid.
  Honest counter-example: Orbit supply fails at SIMULATION with `Error(Contract, #1206)`
  (`InvalidPoolStatus` — Orbit status=4, admin-frozen) → `xdr:""`, nothing signed, no sixth hash.
  Product follow-up shipped: position endpoint returns live `poolStatus` (from the same
  `PoolV2.load`, never the registry — status is governance-dynamic; semantics verified in
  blend-contracts-v2 source: supply blocked at status>3, withdraw NEVER status-blocked); UI
  disables Supply with honest copy + status badge + auto-switch to Withdraw on frozen pools;
  known Blend error codes map to one-liners (#1206 → governance copy), unmapped → "code #NNNN"
  with raw diagnostics behind a collapsible details (raw stays verbatim in the API payload).
  All green (api build + 42 tests, web build). Evidence: `docs/evidence/t3-d2-mainnet-actions.md`.
- T3-D3 note (2026-08-14): **Dead-reserves defect FIXED** (found during A5; own small lot, same
  discipline as the frozen-reserves hotfix). The Blend/Soroswap/Aquarius pool-metric writers read
  `reserve_snapshots` with `distinct on (asset_id)` — the latest row PER ASSET — so they kept
  counting reserves a pool no longer has. **Atomicity checked first** (it decides the filter): all
  three already wrote one `snapshot_at` per pool per refresh, but with NO transaction anywhere in
  the indexer, so batch completeness was observed and not guaranteed. Rather than fall back to a
  fuzzy recency window — unusable here, since Blend's refresh gap is 26.7 min median but 7.7 days
  p90 — the writes were **made atomic** (BEGIN/COMMIT/ROLLBACK) and the three readers switched to
  the latest snapshot BATCH. Atomicity is proven by an injected mid-batch crash (rolled back, no
  partial batch) and mutation-tested (without the transaction a 1-row partial batch becomes the
  latest). **Isolated fix effect, same-data: Blend −$270,174** (Fixed −$174,967, Orbit −$95,207 =
  −33.3% of the old number, i.e. the +49.9% overcount removed); Aquarius/Soroswap byte-identical
  (no dead reserves — fixed anyway so the venues stay in sync). Cross-checked against the venues
  themselves: **Orbit now matches Blend's own SDK read to $2 on $190k**; Aquarius within ±1.8% of
  amm-api.aqua.network. Pool page self-contradiction gone (Fixed: 3 reserves, Σ = TVL, +0.00%).
  **The −$270k step on 2026-08-14 is the number becoming true**, like the +$8.57M step on
  2026-08-13. Separate PRE-EXISTING discrepancy flagged, not fixed: YieldBlox is +63.8% vs the
  Blend SDK (exotic-asset pricing in `asset_prices`, not dead reserves) — its own lot. Evidence:
  `docs/evidence/dead-reserves-2026-08-14.md`.
- T2-D2 addendum (2026-08-16, Lot N): **alerting expanded to 5 evaluated families** — wallet
  health-factor (the submitted T2-D2 family), asset price, pool TVL-drop, pool supply/borrow APY,
  plus an automatic pool-status protection — all inside the UNCHANGED OS-cron sweep (82→81→83,
  no broker, in-app only). Honesty rules held: the modal only offers families whose evaluator
  actually runs, notification copy carries the observed value + its `as_of`, stale snapshots are
  skipped with a warning instead of evaluated. Beyond the already-submitted T2-D2 criteria —
  product deepening, not claim scope. Evidence: `docs/evidence/lot-n/`.
- T3-D3 note (2026-08-16, Lot Q): visual-polish pass — Q1 circular asset logos vs square app
  tiles (`BrandLogo` `variant` prop, swept call sites), Q2 residual "native"→XLM naming purge,
  Q3 single-frame venue tiles, Q4 protocol cards Type + assets line, Q5 the pools-table
  "24h swaps" column fixed (pre-existing gap — the API never returned `swaps24h`; now a grouped
  `normalized_events` scan + the stellar-native Horizon-derived count). Evidence:
  `docs/evidence/lot-q/`.
- Ops note (2026-08-17, Lot S): **API edge hardened — DEPLOYED live on the VPS.** S0 recon found
  the critical gap: Nest listened on `*:3000` with ufw inactive (nginx bypassable). Now: API binds
  **`127.0.0.1:3000`**, ufw default-deny (allow 22/80/443), IP-direct probes get `return 444`.
  **Measured** nginx `limit_req` zones (from observed traffic, not guesses): general 10 r/s
  burst 60, `POST /v1/actions/*` 30 r/min burst 10, mutations 2 r/s burst 20 — JSON 429 +
  `Retry-After`, proven by curl bursts while normal app navigation stays clean. Security headers
  (HSTS, nosniff, DENY, no-referrer), `server_tokens off`, 100k body cap. Follow-up same day:
  **pm2 boot persistence** — the "unsupervised nohup" diagnosis was WRONG (pm2 supervised the API
  since Jun 19); the real gaps were no `pm2-root` systemd unit + a stale Jun-19 dump, both closed
  (reboot simulated via `pm2 kill && pm2 resurrect`, API back healthy). The beta userId-as-bearer
  model is documented honestly in `security-invariants.md` §7 (rate-limited, not solved — post-beta).
  Config is reproducible from `docs/deployment.md`; evidence: `docs/evidence/lot-s/`.
- T3-D2 note (2026-08-17, Lot R): **on-chain execution witness + 5 XLM reward faucet — LIVE on
  mainnet.** R1: `POST /v1/actions/witness` verifies executed txs against Horizon (known wallet,
  qualifying op, mandatory link to a recorded Dig build within [-60,+5] min, ≥1 XLM notional at
  verification-time prices) into `action_witnesses` — **the automatic T3-D2 executed-tx KPI
  ledger, replacing the manual hash list** (blend-withdraws witnessed too, never
  faucet-qualifying). R2: claims backend (`faucet_claims`, money path per
  `security-invariants.md` §9 — the ONLY server-side key, isolated in `faucet-payout.service.ts`,
  one tx shape; one claim per wallet AND per user ever, DB-enforced; 40-claim budget, 10/h
  velocity, auto-halt below reward; dark by default). R3/R3b: campaign card with Swap/Supply CTAs,
  live `remaining/max` progress + server-enforced countdown (`FAUCET_ENDS_AT`). R4: full loop
  proven on live testnet (real payout `8cb9a86b…`, memo `dig-reward`, red tests on-chain).
  **Campaign started 2026-08-17 ~16:45 UTC, 48h (ends 2026-08-19 16:45 UTC): 15 claims paid in
  the first ~12h.** Evidence: `docs/evidence/lot-r/`.
- Data note (2026-08-17): **canonical network-TVL definition (founder ruling,
  `docs/decisions/2026-08-17-network-tvl-definition.md`).** Network TVL = our data only — Σ over
  `pool_metrics_latest` for active tracked venues, lending counted GROSS (total supplied),
  **DeFindex excluded** (its vault funds sit inside Blend pools — double-count); the DefiLlama
  chain-TVL source is dropped entirely (`/v1/network/stats` now copies the same snapshot). Hero
  reads the latest `network_tvl_snapshots` point = the chart's last point (can never disagree),
  labeled **"Total value tracked"** with an honest **"Net TVL (supplied − borrowed)"** secondary
  line. At implementation: gross **$230.06M** / net **$186.49M**. History NOT rewritten — the
  definitional step-down (~$249M → ~$230M) is marked by `meta.methodologyChangeAt`
  (2026-08-17T18:02Z) + a dashed guide/footnote on the chart.
- Incident (2026-08-17, prod — diagnosed and fixed same day): after the Lot R deploy, (1) the
  `action_events.metadata` column was missing (an aborted pull skipped that SQL file) → every
  build insert failed silently → witnesses honestly returned `no-matching-build`; founder
  re-applied `stellar_v1_ops_metrics.sql`. One founder swap is permanently unwitnessable (its
  build event was lost) — redone fresh, no backfill invention. (2) A Vue `v-else` chain break:
  the R3 promo note inserted between the Blend card's `v-if`/`v-else-if` made the whole supply
  form unreachable whenever a campaign was live — fixed (R3c: promo moved inside the form's
  branch; claim-panel instances moved inside their state blocks), plus claim-panel honesty
  (witness reasons surfaced, `no-store` on the polled eligibility, 429 backoff). Ops side:
  `GET /v1/faucet/eligibility` moved to the general nginx zone (claim POST stays strict).
  Incident note: `docs/evidence/lot-r/incident-2026-08-17-prod.md`.
- **KPI position (2026-08-18 ~09:15 UTC — real prod numbers, from `action_witnesses` +
  `faucet_claims` + `/v1/ops/adoption`).** Executed-tx ledger: **17 witnessed mainnet txs** (all
  sdex-swap, all ≥ 1 XLM notional; 16 distinct wallets, 15 distinct users; first witness
  2026-08-17 16:40 UTC), plus the 6 manually evidenced Aug-14 txs — **vs the 200-tx target this
  is ~a tenth, honestly far**. Faucet: 15/40 claims paid (75 XLM out), 0 failed, treasury
  ~125.5 XLM spendable. Adoption: **65 tracked wallets** (43 signers / 22 watch-only), 48
  distinct users, 35 distinct acting addresses; 276 builds total (last 24h: 103 mainnet
  swap-builds + 108 quotes) — builds ≠ executions. The 50-wallet KPI is arguably met on tracked
  wallets (65) but only 16 wallets have a witnessed execution. **Context stated explicitly:
  these numbers accumulated during the 5 XLM incentive campaign** (one claim per wallet/user,
  1 XLM min notional, 40-claim budget, 10/h velocity cap) — the grant narrative must say so
  (see the KPI-integrity note in `docs/evidence/lot-r/r4-testnet-e2e.md`).
- T3-D2 note (2026-08-18, Lot R2): **reward campaign 2 built + testnet-proven — per-FAMILY
  first-action rewards.** One change vs campaign 1: first verified swap AND first verified Blend
  supply each earn 5 XLM (max 2 claims/wallet), 60-claim budget (302 XLM founder top-up).
  Everything else preserved (witness-gating, 10/h velocity, auto-halt, §9 isolation, dark
  deploy). Schema `stellar_v5_faucet_campaign2.sql`: `campaign` + `action_family` on
  `faucet_claims` (campaign-1 rows preserved as evidence), uniqueness now per
  (wallet|user, family, campaign). New fail-closed `FAUCET_STARTS_AT`: only witnesses whose tx
  EXECUTED inside the campaign window qualify — a campaign-1 wallet claims again only via a new
  on-chain execution (both directions live-proven on testnet, incl. brakes + fail-closed
  misconfig). Eligibility/claim are per-family end-to-end (API + promo card "up to 10 XLM" +
  claim panel with cross-family hint); `/v1/ops/metrics` faucet block campaign-scoped with
  `allTime` carry. Hitchhikers in the same change: `/v1/ops/adoption` boundary now cites the
  `action_witnesses` ledger (manual-hash-list sentence was stale), and the dead stellar.expert
  `network-activity/summary` call (upstream 404 — THE systematic 1-per-run `price-sources`
  error) removed from step 73. api 125/125 tests, web build green. Evidence:
  `docs/evidence/lot-r2/testnet-e2e.md`. **VPS deploy + activation founder-side (v5 SQL before
  restart; set FAUCET_MAX_CLAIMS=60 + FAUCET_STARTS_AT + FAUCET_ENDS_AT at go-live).**
- T3-D3 note (2026-08-18, Lot Z): **SDF Reference Implementation packaging DONE — the
  "functional Docker compose" criterion is met and proven from a clean clone.**
  `docker compose --profile app up -d --build` now runs the full stack: postgres (the ten
  `stellar_v*.sql` files auto-applied via numbered init mounts in dependency order — the
  exact failure mode of the 2026-08-17 incident, made structural), redis, containerized
  API (carries the indexer package because the wallet on-demand refresh spawns `pnpm tsx`
  there) and containerized indexer (bootstrap:core + immediate refresh + 15-min sequential
  loop replacing cron+flock). Default `docker compose up` unchanged (infra only — dev
  workflow intact); `apps/web` deliberately outside the stack (Vercel); faucet stays dark
  (no server-side key plumbed). Clean-clone proof: 10/10 refresh steps green on public RPC,
  `/health` version = GIT_SHA, `/v1/protocols` live TVL, `down && up` idempotent; one
  deviation found and fixed (root-owned `apps/indexer/tmp` broke non-root writes).
  Evidence: `docs/evidence/lot-z/z1-compose-fresh-clone.md`. Zero product-logic changes.
  **Remaining T3-D3: the final SDF report (+ demo)** — observability (Lot E) and packaging
  (Lot Z) are both done.
- Last updated: 2026-08-18

---

# Tranche 1 — MVP (reviewed for the SCF 20% disbursement)

| Deliverable | Status | Completion | Confidence | Current evidence | Remaining (post-claim / out of contract) | Next action |
|---|---|---:|---|---|---|---|
| D1 — Data Indexing Foundation (Horizon & Soroban) | Done | 100% | High | Hybrid Horizon+Soroban ingestion live into one Postgres DB; canonical `job:refresh` pipeline (72→71→steps) writing raw SQL v1; **prod (Jun 18–19)**: 4 protocols aggregated — Blend 3 pools (≈$192M) *(YieldBlox added Jun 26 → 4 active Blend pools ≈$166M; Forex excluded — frozen oracle)*, Aquarius 4 (≈$22.7M), stellar-native 9 (≈$6.2M), Soroswap 1 active (≈$130k); synchronous `as_of` across protocols within one refresh cycle, observed advancing over consecutive cycles; cron every 15 min on the VPS (within the 5–15 min criterion); served via `/v1/*` | Freshness exposure in the API and retry/backoff standardization (belongs to T3-D1); DeFindex (T3) | Capture evidence in the demo video (live `/v1/protocols`, `/v1/pools`) |
| D2 — Analytics Dashboard MVP | Done | 100% | High | Public beta live at `stellar.getdig.ai` (Vercel); protocol/pool views show TVL/volume/APY from indexed data; Stellar Wallets Kit integrated; runs on real Mainnet data (over-delivery vs the "Testnet data" wording); **`GET /v1/network/stats` DB-backed** (`network_stats_latest` via indexer step `73`); `protocolCount` now dynamic = 4; "native" rendered as "XLM"; Blend panel trimmed to real metrics | ~~Responsive pass~~ (done 2026-08-20, Lot AA) + stale/loading/error consistency (polish, not a criterion); two network-stats fields (`activeWallets`, `dexVolume24hUsd`) null from a stale stellar.expert endpoint (pre-existing, minor) | Show the live dashboard in the demo video |
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
| D1 — Multi-Wallet Portfolio & "Active Signer" Model | Done | 100% | High | **Gap A done (criteria 1 + 3):** active-signer vs watch-only formalized — `user_wallets.is_active_signer` (DB-enforced singleton), `PATCH /v1/wallets/:id/signer`, Kit-connect auto-promotes, watch-only add-path, UI badges + signing guardrail. **Gap B done (criterion 2 — full stack):** Part 1 resolver (`lib/protocols/blend/{fetch-user-positions,resolve-user-health}` + `81-…`) writes per-asset supply/borrow → `wallet_protocol_positions` + per-pool `health_factor` → `wallet_pool_health` (SDK `PositionsEstimate`, NULL = no debt), non-fatal in `refreshWallet`. Part 2 surfaces it: `GET /v1/wallets/:id/positions` + a `defi` block on `/overview` (Σ supplied/borrowed/net + per-(wallet,pool) health, riskiest first, **latest-snapshot filter** so closed positions don't linger), plus the UI portfolio slice (consolidated "DeFi positions (Blend)" header + per-wallet supplied/borrowed/HF with colour states). Validated on mainnet (borrower HF 1.11/1.32 = collateral/debt; phantom-snapshot + empty cases confirmed; `apps/web build` green). Plus prior: grouped multi-wallet, per-wallet balances, raw SQL v2. **Jun 26:** YieldBlox indexed as a 4th active Blend pool, closing the position-coverage gap — the resolver is entity-driven, so positions resolve across all active pools (test wallets re-resolved clean: `GAZXV3PH…` shows both legs — fixed-pool supply ≈$50.9k / borrow EURC ≈$28.9k, HF ≈1.33 + yieldblox supply native ≈$26.8k / borrow USDC ≈$15.0k, HF ≈1.27). **Jul 22:** the final visual HF cross-check vs the mainnet.blend.capital UI on `GAZXV3PH…` was performed and **matched**. **Aug 14 (Lot W — UX debt repair, not a criterion change):** connect-signer now attaches to the session account instead of forking a user (session `userId` on `/connect`, signer-preferring deterministic recovery when no session); labels settable at connect + `PATCH /v1/wallets/:id` rename + short-address fallback; portfolio Assets card (honest USD, per-wallet detail); pool-detail per-wallet position breakdown. Evidence `docs/evidence/lot-w/`. | — | Complete — all three criteria met; HF now feeds D2's live alerting. Non-Blend LP positions (Soroswap/Aquarius) and cryptographic proof-of-ownership are post-beta / out of contract. |
| D2 — In-App Alerting Engine | Done — live in prod | 100% | High | **Both SCF criteria met and verified end-to-end live in prod on the VPS.** Rule storage + periodic evaluation over the snapshot DB + in-app notifications: as-built is a periodic **OS-cron sweep** (scripts `82`→`81`→`83`, `job:wallet-alert`) — no broker, no in-process scheduler — writing a `notifications` row on each fire/resolve edge; tables `alert_rules` / `alert_rule_state` / `notifications` (`stellar_v3_alerting.sql`, depends on v1 entities + v2 `user_wallets`); endpoints `GET/POST /v1/alert-rules` + `GET /v1/notifications`; web notification **bell** + full **Alerts page** (`AlertsView` + 4-step `AlertRuleModal`) + compact dashboard **`WalletAlertsPanel`** — all on the shared `useAlerts` state (HTTP polling), creation gated to wallet·health-factor; first rule family = health-factor risk (consumes T2-D1's `wallet_pool_health`). **Live in prod:** `stellar_v3_alerting.sql` applied on the VPS and the `job:wallet-alert` cron scheduled (82→81→83 sweep); contract validated against the live API; create round-trip confirmed; and the fire path is proven by **real `alert_fired` notifications in the prod DB** from the evaluator on live Blend HF (YieldBlox 1.274<1.5, Fixed 1.353<1.85). Matches the verbatim criterion (rules evaluated against the snapshot DB → in-app notifications). | — | Complete — live in prod, captured in the ~5-min submission demo video. Optional polish: derive notification severity from `payload` rather than `kind`. |
| D3 — Bridge Flow Monitoring | Done — live in prod | 100% | High | **Both SCF criteria met and live in prod on the VPS.** (1) Allbridge Core adapter live (`apps/indexer/.../allbridge/`): inflow + outflow events via Soroban `getEvents`, per-source-chain attribution (inflow via `receive_tokens` arg parse), `bridge_flows` table + `amount_usd`, wired non-fatal into `job:refresh`, idempotent on rescan; verified against mainnet (inflow BAS, outflows SOL/POL/CEL/BAS). (2) API `GET /v1/bridge/summary` (24h/7d/30d window — inflow/outflow by source chain + net) + `GET /v1/bridge/flows` (recent feed) via `apps/api/src/modules/bridge/`, on-read aggregation (no metrics table). (3) Dashboard bridge section: one full-width Paul-DA card (`components/bridge/` — `BridgeSection` + `BridgeChart` + `BridgeRoutesTable` + `BridgeFlowsFeed`) fed by the extended `useBridge`: stat strip + inflow/outflow-and-cumulative-net chart (`24h/7d/30d`, default 7d) + tabs (per-chain **Routes** table with click-to-scope + sortable columns, **Recent flows** feed `chain → Stellar`). All on real `/v1/bridge/*` data — chart uses the gap-filled `/bridge/series` for unscoped 7d/30d and client-buckets `/bridge/flows` for 24h/chain-scoped; stat strip authoritative from `/bridge/summary`; real chains only (BAS/SOL/POL/CEL/…), no mock figures. Wired into `DigDashboard.vue`. **Deployed:** `stellar_v1_bridge.sql` applied on the VPS and the `allbridge-upsert-core.ts` bootstrap run, so prod `bridge_flows` is populated and the live section renders real flows. | — | Complete — live in prod, captured in the ~5-min submission demo video. Honest constraint kept in UI copy: Soroban `getEvents` retains ~7 days → rolling recent-flows view, not deep history. |

---

# Tranche 3 — Mainnet / Operational maturity (internal; reviewed for the 40% disbursement)

| Deliverable | Status | Completion | Confidence | Current evidence | Main remaining gap | Next action |
|---|---|---:|---|---|---|---|
| D1 — Mainnet Deployment & Freshness Tracking | Done in prod | 95% | High | **Both criteria met, deployed to prod Aug 4 (Lot B).** (1) All 5 named protocols live on real Mainnet data — **DeFindex integrated into the v1 pipeline** (venue + 3 vaults enumerated from `GET /vault/discover`: Meru ≈$18.1M, Beans USDC ≈$507k, Beans EURC ≈$200k; ≈$18.8M aggregate, avg APY ≈7.1%; `protocolCount = 5`; yield-vault detail variant in the UI). (2) Freshness first-class: `isStale` + `staleAfterSeconds` on every `/v1/*` payload (read-time, threshold 45 min = 3× cron), FreshnessChip + stale badges in the UI, standardized exponential-backoff retries on every refresh step. Evidence in `docs/evidence/lot-b/`. Full prod `job:refresh` clean in ~3 min | **Demo capture** for the claim (only non-build item) | Capture the T3-D1 demo (5 protocols + stale drill) |
| D2 — Non-Custodial Mainnet Actions | Substantially done — swaps + lending evidenced on mainnet | 80% | Medium | **Both action families executed and Horizon-verified on Pubnet.** Swaps LIVE from the dashboard (ungated Aug 2; both directions incl. `eeeae199…`; Aug 14: 50 XLM→7.97 USDC + 10 XLM→1.38 EURC). **Blend lending: multi-pool supplies (5 XLM→Fixed, 5 XLM + 5 USDC→YieldBlox) AND the withdraw closing the supply↔withdraw loop (`537a2303…`, the exact supplied position back)** — six txs, all XDR-decoded, congestion-fee bid confirmed against reality (10,000-stroop inclusion bid, ~46–59% of ceiling charged). Honest refusal path proven: frozen Orbit supply dies at SIMULATION (#1206, nothing signed). Security regime verified in prod: kill-switch (403 default), 100 XLM cap, issuer-verified 5-pair whitelist, client-side pre-sign XDR validation (fail closed), in-wallet signing only. Evidence: `docs/evidence/t3-d2-mainnet-actions.md` + `mainnet-ungating-2026-08-02.md` + `pair-vetting-2026-08-01.md` + `lot-a5-blend-multipool.md`. **Since Aug 17 (Lot R): the full action stack is deployed to prod, `action_witnesses` is the automatic executed-tx KPI ledger, and the 5 XLM reward campaign is live** (48h, ends Aug 19 16:45 UTC) | **KPIs** (50+ wallets / 200+ txs) — the only open criterion. Real position 2026-08-18: 17 witnessed txs / 16 wallets with executions (65 tracked wallets, 48 users) — accumulated under the incentive campaign; the 200-tx bar is honestly far | Ride the campaign window; keep distribution going after it ends; state the incentive context in the claim |
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
1. **T3-D2 KPIs** — 17 witnessed txs vs the 200 target (2026-08-18); the incentive campaign
   drives real executions but the gap stays large, and post-campaign organic adoption is unproven
2. CI/CD: VPS deploy is still manual — the 2026-08-17 incident (aborted pull skipping a SQL file)
   is exactly the failure mode this invites
3. Observability boundary: `/v1/ops/adoption`'s boundary copy still cites the manual hash list as
   the executed-tx evidence — superseded by `action_witnesses` (minor string fix at next deploy)
4. UI polish debt: loading/error consistency still partial. (Responsive debt CLEARED
   2026-08-20 — Lot AA: drawer shell below `lg`, per-view mobile pass per founder
   arbitration, modals as bottom sheets, honest mobile connect state; watch-only-first
   entry via Lot AB. Final sweep: 81 capture records at 390/768/1024, zero horizontal
   overflow, zero console errors — `docs/evidence/lot-aa/`.)

## Best near-term tranche wins
1. T3-D1 demo capture → claim-ready (everything else already live in prod)
2. KPI accumulation — the witness ledger now counts executions automatically; every campaign
   claim and post-campaign organic action lands in `action_witnesses`
3. Final report assembly: adoption metrics (with the incentive-campaign context stated) +
   reference packaging are the remaining T3-D3 items

---

## Update rule

Update when: a deliverable moves in maturity, a blocker is removed, a gap becomes clearer, the next
tranche-critical target changes, or a partial area becomes substantially done. When in doubt, prefer
realism over optimism. Mirror any status change into `docs/grant-roadmap.md` (interpretation layer)
and `docs/current-state.md`.