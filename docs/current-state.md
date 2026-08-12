# Dig Stellar — Current State

## Purpose

This document captures the real, current state of Dig Stellar. It is an internal execution document,
not a pitch. It answers: what works, what is partial, what is fragile, what is still placeholder, and
what blocks tranche-aligned progress.

Keep it honest and aligned with `docs/grant-roadmap.md` and `docs/status-board.md`. Prefer brutal
clarity over optimism — this file improves decision quality, not morale.

---

## Overall project state

Dig Stellar is past prototype stage. It has a live beta frontend on real Mainnet data, a dedicated
backend API serving as the product façade, an indexer ingesting four protocols across Horizon and
Soroban on a 15-minute cron, real wallet connection, grouped multi-wallet behavior, DB-backed wallet
balance refresh, and a non-custodial transaction builder with a **fully successful** SDEX swap proven
on Testnet.

The three MVP deliverables (internally "T1") meet their SCF criteria and have been **submitted** for
the **Tranche 2 (20%) disbursement** — claim-ready and now **awaiting SCF validation** (not yet
validated, approved, or paid). The **T2 deliverable group is complete and live in prod**, and its
**Tranche 3 (30%) disbursement submission is filed** — **Submitted for disbursement review — awaiting
SCF validation** (submission ≠ acceptance): T2-D1 portfolio/active-signer (**done** — the visual HF
cross-check vs mainnet.blend.capital was performed and matched), T2-D2 in-app alerting (**live in prod
on the VPS** — schema + cron running, real `alert_fired` notifications in prod), T2-D3 bridge
monitoring (**live in prod** — schema applied + Allbridge bootstrap run, `bridge_flows` populated).
The ~5-min prod demo video is recorded; T2 build, deploy, and evidence are complete.

---

## Data architecture reality (read this first)

Three table families coexist in the same Postgres DB. This is the single most important thing to know:

- **raw SQL v1 — the product pipeline.** `entities`, `venues`, `assets`, `entity_assets`,
  `pool_snapshots`, `reserve_snapshots`, `normalized_events`, `pool_metrics_latest`,
  `protocol_metrics_latest`, `asset_prices`, `sync_cursors` (defined in `apps/api/src/db/stellar_v1*.sql`).
  Written by `job:refresh` (`72-run-refresh-job.ts` → `71-refresh-all-metrics.ts` → per-protocol steps).
  Read by the `/v1/*` routes (`StellarController`).
- **raw SQL v2 — wallet layer.** `user_wallets`, `wallet_balance_snapshots`, `wallet_protocol_positions`
  (`stellar_v2_multiwallet.sql`). Read by `/v1/wallets/*` (`WalletsController`).
- **Prisma models — legacy / parallel.** `Protocol`, `Venue`, `Snapshot`. Written by
  `run:blend` / `run:horizon` / `run:once`; read only by the prefix-less `/protocols`, `/venues`,
  `/venues/:key/snapshots` routes (`AppController`). Not part of the product pipeline. Elsewhere the
  Prisma client is used only as a raw-SQL connection (`$queryRawUnsafe`), not as an ORM.

Bottom line: **`/v1/*` + raw SQL = the real product; Prisma `Protocol/Venue/Snapshot` = legacy.**
Ingestion *logic* lives in `apps/indexer/src/lib/protocols/<protocol>/`; `src/scripts/ingest/` holds
both live entry points and superseded legacy scripts. (See `docs/repo-structure.md` and
`docs/data-model.md`.)

---

## 1. Frontend — `apps/web`

**Substantially advanced, not fully stabilized.** Vue 3 + Vite + Tailwind.

**T3-D3 (Lot C — design-handoff port) landed this session.** The co-founder's Claude Design handoff
(`design/2026-08-handoff/`) is ported into the app: a persistent **sidebar + topbar shell** wraps five
real views — Dashboard, Protocols, Pool detail, Portfolio, Alerts — plus connect / create-alert /
action modals. View switching extends the existing module-scoped `useView` to five views + a pool
sub-view (no router — beta-first) with lightweight hash sync. Fonts moved to IBM Plex Sans + Geist
Mono; design tokens live in `src/style.css` (`--dig-*`). New composables: `useConnectFlow`,
`usePoolDetail`, `useSharedWallets` (one shared wallets/overview load across sidebar + portfolio +
pool-detail), `useModals`. Everything renders real data or an explicit honest state (freshness chips,
stale badges, empty states). Two API additions back the pool-detail page: `GET /v1/pools/:slug/flows`
(on-read deposit/withdraw aggregation over `normalized_events`, `covered` flag hides uncovered pools)
and `GET /v1/pools/:slug/series` (Blend-only honest TVL reconstruction from `reserve_snapshots × latest
price`; non-Blend keeps a "building history" note — no synthesized curves). The action modal embeds the
**existing** SDEX-swap / Blend-deposit widgets unmodified, so the client-side validation gates and the
flags regime are preserved byte-for-byte; Add/Remove-liquidity tabs are present-but-disabled ("soon",
Lot D). Legacy `DigDashboard.vue` / `DashboardHeader.vue` removed. Evidence: `docs/evidence/lot-c/`.

**T3-D3 (Lot F — advisor-feedback polish) landed on top of the Lot C port.** Traced to a 2026-08-10
mainnet advisor review + a real failed user swap (`docs/evidence/lot-f/`): **F1** raised `--dig-faint`
to clear WCAG AA (≥4.5:1) on the dark cards and added global `--dig-*` scrollbar styling. **F2** added an
API spendable-balance preflight (Horizon reserves + selling liabilities) on the swap build and Blend
deposit build — an over-spend now returns a clean `400 INSUFFICIENT_SPENDABLE_BALANCE` the widget renders
honestly, so the underfunded failure mode (real tx `a3acf8fa…`) can no longer reach signing. **F3** serves
real venue/asset logos from a nullable `logo_url` (v1 raw-SQL, seeded via `bootstrap:logos`) exposed on
`/v1/protocols` + `/v1/pools`, with a `BrandLogo` fallback chain (backend → bundled → monogram) so a dead
URL never shows a broken image. **F4** replaced the hollow portfolio empty states — a no-wallet
`EmptyPortfolioState` (value prop + Connect CTA) and a connected-but-empty `GetStartedCard` (fund / real
swap / real Blend deposit with the pool's live supply APY + freshness, honest variable-not-projected copy,
Mainnet real-funds + 100 XLM cap, non-custodial line) — plus honest failed-tx copy in both action widgets
("failed atomically — no funds moved", worded per classic vs Soroban fee). Validators + flags regime
untouched throughout. Evidence: `docs/evidence/lot-f/`.

**QA pass (post-port) fixes.** A headless-CDP QA sweep (all 5 views + modals, 1440/1280px, API-down, connected/disconnected) found no console errors, exceptions, or overflow. Fixes applied: (a) sidebar footer always names the data plane ("Live · Stellar mainnet") — the signing selector no longer flips it; (b) the notifications bell dropdown restyled to the design's "Activity feed"; (c) retry buttons on the protocols/pool-detail API-down states and honest empty states on the dashboard protocols summary + bridge (`—`, not `+$0`); (d) the action modal's network selector is kept for both swap and Blend deposits. **Wallet management (T2-D1: refresh / set active signer / set primary / activate-deactivate / delete) was ported from the legacy `WalletSection` into `PortfolioView`** (per-card ⋯ menu) before removing the now-orphaned legacy components (`WalletSection`, `WalletAlertsPanel`, `PoolDetail`, `PoolTabs`, `ProtocolTabs`, `PoolTable`, `StellarMetrics`, `NetworkStats`, `HeroBanner`, `Dashboard`). The SDEX-swap / Blend-deposit widgets and XDR validators were not touched.

**Honest per-type metrics on Protocols (post-QA).** 24h volume/fees are structurally N/A for lending
(Blend) and yield-vault (DeFindex) pools — the API returns `0` there, which previously rendered as a
misleading `$0` (a measured zero). The pool-detail per-type variant principle now extends to the
Protocols page: protocol cards show type-appropriate metrics (Blend → TVL + avg supply/borrow APY;
DeFindex → TVL + avg APY, TVL-weighted; AMM/native → TVL + vol + fees), and the pools table renders
N/A cells as "—" (vol/fees on lending/vault rows, utilization on AMM/vault rows) while a genuinely
measured zero on an applicable metric still shows `0`/`0%`. Sorting treats N/A as absent (sorts to the
bottom), not as `0`. Confined to `ProtocolsView.vue`; dashboard protocol rows show only TVL so needed
no change. Evidence: `docs/evidence/lot-c/qa-protocols-per-type-metrics.png`.

**T3-D3 (Lot G — dashboard & protocols polish) landed on top of Lot F.** Traced to a 2026-08-12
founder product review (`docs/evidence/lot-g/`). **G1** — bridge source chains render bundled brand
marks through `BrandLogo` (the top-7 by flow volume: BAS/POL/ETH/SOL/ARB/BSC/CEL, with a monogram-safe
fallback for the tail); every rendered tx hash links to stellar.expert, network-aware (`lib/explorer.ts`,
bridge feed + swap/deposit success panels); protocol summary cards normalized to a rigid 3-slot grid.
**G2** — the hero was deduped (XLM price / stablecoin mcap / protocol count removed — the four stat tiles
already carry them) and the inline Testnet/Mainnet actions section replaced by a compact hero Swap /
Deposit button pair opening the **existing** `ActionModal` (which self-gates and now hosts the sole
`NetworkToggle`); flags regime + XDR validators byte-identical, a swap reachable in ≤2 clicks. **G3** —
the all-pools table drives its columns off the active protocol tab: "All" is generic (Pool · Protocol ·
TVL · a type-aware Key metric), a selected protocol shows its full type-specific columns (lending:
TVL/supply/borrow/util; AMM: TVL/vol/fees/swaps; vault: TVL/APY), N/A-aware sorting with **no structural
half-dash rows**. **G4** — a 7-day network-TVL curve in the hero (`NetworkTvlChart`, reusing the
BridgeChart SVG + tooltip pattern) served from the new `GET /v1/network/tvl-series`; honest gaps (never
interpolated) and a "building history since &lt;date&gt;" note while the window is partial, backed by G0
(see §2/§3). All steps green (web build + 49 tests + api build); validators/flags untouched. Evidence:
`docs/evidence/lot-g/`.

**T3-D3 (Lot H — second polish pass) landed on top of Lot G — code-complete, VPS deploy pending
(indexer + api touched).** Traced to a 2026-08-12 evening founder product review
(`docs/lot-h-polish-2.md`; evidence `docs/evidence/lot-h/`). **H0** — read-only flows recon
(`docs/evidence/lot-h/h0-flows-recon.md`): the permanent-$0 "Inflows & outflows" was root-caused to
(a) Aquarius liquidity rows persisted with NULL amounts (the normalizer only extracted
trade/update_reserves) and (b) a stale one-day legacy Blend backfill (`28-blend-events-scaled`,
2026-03-19) wrongly granting coverage — the Lot C hide rule itself worked; 66 of 73 pools hid
correctly. **H1** — every modal (`AlertRuleModal`, `ActionModal`, `ConnectModal`) now teleports to
`<body>`: the alerts view wrapper keeps a computed `transform` (digFade, fill-mode both), which made
it the containing block for the fixed overlay — the "New alert" modal centered in the content column
instead of the viewport (measured top −130px at 1280×720). All three modals verified fully visible at
720p; `ConnectModal` gains inner scroll so `max-h-[90vh]` degrades to scrolling, never clipping.
**H2** — dashboard layout: the protocols box drops to half width (rows unchanged) beside a new
compact **"Your positions" panel** (`common/YourPositionsPanel.vue`) that reuses the F4 state
machinery — `compact` props on `EmptyPortfolioState` / `GetStartedCard` (parameterized, not forked),
the shared `useSharedWallets` store (no new endpoint, no duplicate fetch), the same state predicates
as `PortfolioView`. Positions state keeps liquid total and DeFi supplied/borrowed DISTINCT (standing
rule), shows top-3 Blend positions with the shared HF colour rule (extracted to `utils/health.ts`,
one source of truth with the Portfolio), and links to the Portfolio; the two panels stack below
1100px. All three states captured with real data. **H3** — the swap widget reskinned to the
Uniswap-standard layout, **presentation only**: a new `common/TokenSelect.vue` (BrandLogo chip +
symbol button opening a styled listbox with logo/symbol/name, Esc + click-outside close, drop-up
when space-constrained, F3-sourced static logos with monogram fallback) replaces the native
`<select>` — it receives the SAME whitelist array and emits the same asset keys; large amount
fields, balance + Max line from existing widget state (no new fetches), centered flip button, quote
rows / mainnet notice / signer guardrail / success / error panels restyled with the F2
insufficient-balance and F4 failed-atomically copy verbatim. Review gate held: script diff = the
`TokenSelect` import only; validators + whitelists 0 lines changed; the template's
`v-if`/`v-model`/`@click`/`:disabled` binding sets mechanically proven identical. Verified live
inside `ActionModal` (real testnet quote 10 XLM → 17.897 USDC, flip re-quotes). The Blend deposit
card needed no incidental changes. **H4** — flows made honest end-to-end (see §2/§3): with the new
predicate Blend + amount-less pools hide, the two Aquarius pools with measurable events render real
dollars, and the header carries "coverage since &lt;date&gt;" honest-window copy. All steps green
(web build + 49 tests + api build; one pre-existing legacy `app.controller.spec` failure verified
failing at HEAD, unrelated). Post-deploy: one-time per-pool Aquarius event backfill
(`LEDGER_LOOKBACK=115000 MAX_EVENT_PAGES=200`) to capture the full ~7d RPC retention.

Working: real dashboard structure, protocol browsing, pool detail views, wallet connection UX,
multi-wallet portfolio UX, backend-driven data in the important flows, a public beta on real Mainnet
data. Display polish landed this session: native token rendered as "XLM" (display-only helpers, DB
keys untouched), Blend lending panel trimmed to its real metrics (Liquidity, Total Supplied, Supply
APY, Borrow APY — Volume/Daily Reward removed as structurally empty for lending), dead pools hidden.
The SDEX swap widget now quotes the price live (via `/v1/actions/sdex/quote`) and derives min-receive
with auto-slippage instead of a manual field.

Partial / weak: loading/error/stale states are not yet consistent; responsive behavior needs a real
pass; some zones still mix real features and "coming soon" placeholders.

Network selection: the wallet network follows the Mainnet/Testnet toggle (`useNetwork`) as the single
source of truth — the Wallets Kit follows it via `kit.setNetwork`, signing uses the current network,
and `VITE_STELLAR_NETWORK` is only the initial default. Since Aug 2 (T3-D2 ungating) the swap runs
on **both networks**: mainnet behind the double flag (`VITE_ACTIONS_MAINNET_ENABLED` UX-side +
`ACTIONS_MAINNET_ENABLED` server kill-switch), with a real-funds warning banner and per-network
vetted pair lists; testnet unchanged. The Blend deposit card stays testnet-only (Lot A2).

Direction: a pure UI + composables/state + internal-API-consumer layer. Core network stats are already
served by the API from the DB (see §2).

Priorities: (1) responsive pass; (2) standardize loading/error/stale; (3) clarify real vs deferred
sections. (These are polish, not T1 criteria.)

---

## 2. Backend API — `apps/api`

**The product façade. Structurally central and now authoritative for the core surfaces.** NestJS 11.

Working: wallet routes (connect, overview, balances, refresh, primary/active/delete), wallet grouping
by persistent `userId`, protocol/pool routes serving real indexed data via `/v1/*` (raw SQL). **`GET
/v1/network/stats` is DB-backed** (reads `network_stats_latest`, scope `'global'`, populated by the
indexer step `73-network-stats-refresh` via `job:refresh`) — no live external fetch per request;
`protocolCount` is now a live count (= 4). The `actions/` module exposes the transaction builder
(`/v1/actions/sdex/swap`, `/v1/actions/sdex/quote`, `/v1/actions/blend/deposit`). Inactive entities
are excluded from `/v1/pools` (and 404 on `/v1/pools/:slug`) so dead pools never surface. **`GET
/v1/network/tvl-series` (G4, Lot G)** serves the hero's 7-day TVL curve — on-read hourly buckets (latest
snapshot per hour) over up to 7d from the new `network_tvl_snapshots` table (written by the indexer, §3),
gaps kept as gaps (no interpolation), `meta: { source: 'snapshots', from, to, firstSnapshotAt, partial }`.
**`GET /v1/pools/:slug/flows` coverage refined (H4, Lot H)**: `covered` now means the pipeline can
MEASURE flows — ≥1 flow-family event with computable USD (non-null scaled amount on a priced asset),
excluding the superseded `28-blend-events-scaled` legacy backfill (whose rows carry amounts, so the
USD test alone would not have hidden Blend); the aggregation applies the same filters, and the
response adds `coverageSince` (first measurable event day) so the UI dates the window honestly. Net
effect: Blend + amount-less pools hide the section; pools un-hide organically as measurable liquidity
events arrive (§3).

Partial / weak: health/operational endpoints incomplete; freshness not yet exposed systematically
across routes. On `/v1/network/stats`: two fields (`activeWallets`, `dexVolume24hUsd`) come back `null`
because the stellar.expert summary endpoint returns 404 — a pre-existing source issue (already null in
the old live-fetch code), not a regression; minor debt.

Direction: stay the single authoritative UI-facing layer for dashboard stats, protocol analytics,
wallet data, freshness metadata, and (later) alerts and action preparation.

Priorities: (1) add health + freshness visibility (T3-D1); (2) fix the stellar.expert endpoint for the
two missing fields; (3) return a clean 400 instead of 500 when an action body is missing (minor).

---

## 3. Indexer / data layer — `apps/indexer`

**Substantially advanced and already powering the product.** Runner: tsx.

Working: Horizon + Soroban ingestion; protocol adapters in `lib/protocols/`; canonical refresh chain
`job:refresh` → 72 → 71 → per-protocol steps; persistence of asset prices, pool/reserve snapshots,
pool + protocol metrics (now including stellar-native in the protocol-level aggregation); wallet
balance snapshot generation; runs on a 15-minute cron on the VPS. **G0 (Lot G)** appends one
`network_tvl_snapshots` row at the tail of step 7 (`70-protocol-persist-metrics.ts`): `sum(
protocol_metrics_latest.tvl_usd)` + protocol count, `as_of` truncated to the minute and upserted
(idempotent per run) — one network-TVL history point per refresh cycle, read by `/v1/network/tvl-series`
(§2). Additive raw-SQL migration `stellar_v1_network_tvl.sql`; Prisma untouched. **H4 (Lot H)**: the
Aquarius and Soroswap event normalizers now extract liquidity add/remove amounts into
`normalized_events` — Aquarius `deposit_liquidity`/`withdraw_liquidity` (shape probe-verified against
live mainnet events: `value = [amount0, amount1, lp_shares]`, single-sided deposits keep an honest 0
leg) and Soroswap `deposit`/`withdraw` (defensive per the contract's snake_case map convention; none
existed in RPC retention to verify against). Same idempotent persist — and because it is an upsert on
`(contract_address, event_id)`, a re-ingest within retention REPAIRS previously amount-less rows (16
Aquarius rows repaired locally). Amounts are priced downstream via `asset_prices` like the bridge;
backfill is bounded by Soroban `getEvents` retention (~7 days). Blend event ingestion intentionally
stays out (state-only adapter; its pool hides the flows section per the H4 predicate, §2). Inactive entities (archived Soroban
contracts whose on-chain reads 404) are soft-disabled (`is_active=false`) and skipped by the refresh
instead of aborting the whole job. URL construction for Validation Cloud preserves the `/v1/<key>`
base path (the `joinUrl` helper) — this fixed a cascading refresh failure earlier this session.

Operational protocol coverage (verified in prod DB / API, Jun 18–19, 2026):
- Soroban — Blend, Soroswap, Aquarius
- Horizon — Stellar native DEX liquidity pools

Partial / weak: retry/backoff not standardized; health visibility limited; observability lightweight;
DeFindex scaffolded (`run:defindex`, `@defindex/sdk`) but **not validated** — it belongs to **T3-D1**,
not the MVP. A full refresh takes ~12 min on the 1-vCPU VPS (network-bound on trade pagination), which
is why the cron is set conservatively to 15 min.

Direction: move from "collection of ingestion scripts" to a documented ingestion platform with
predictable refresh behavior and surfaced freshness.

Priorities: (1) surface freshness in the API; (2) standardize retry/backoff; (3) validate DeFindex;
(4) expand coverage per roadmap. (All T3-D1.)

---

## 4. Wallets / identity / portfolio model

**Strong relative to overall maturity, still beta-level on security/session.**

Working: wallet session UI; address retrieval via wallet connect; backend resolution of a persistent
grouped `userId`; grouped multi-wallet portfolio; adding secondary wallets; per-wallet balances;
refresh flow from API to DB-backed snapshots (raw SQL v2); select/refresh/delete/activate/primary
operations. There is a real "returning user with multiple wallets" foundation.

**Active signer vs watch-only — now formalized (T2-D1 Gap A).** `user_wallets.is_active_signer`
(boolean, DB-enforced singleton per user via the partial unique index
`user_wallets_one_signer_per_user`) is the persisted **designation**; actual signing capability is
the **live** half (`connectedAddress` from the Wallets Kit). The two reconcile as a hybrid: a
signing context is live iff the connected address equals the active-signer wallet's address.
Connecting a wallet via the Kit promotes it to active signer (singleton — demotes the previous),
which keeps the T1-D3 swap valid. Add-by-address stays `is_active_signer=false` = watch-only:
fully monitored, never signable. The signing guardrail in the swap widget blocks build/sign unless
the connected address is the active signer. The three axes — `is_active_signer` (sign),
`is_primary` (showcase/default), `is_active` (refresh gate) — are orthogonal and never merged.

**DeFi position aggregation — now live (T2-D1 Gap B).** The portfolio aggregates Blend positions and
health across all tracked wallets (signer + watch-only). Part 1 resolves and persists per-asset
supply/borrow (`wallet_protocol_positions`) + a per-pool health factor (`wallet_pool_health`) via
`refreshWallet`. Part 2 surfaces it: `GET /v1/wallets/:id/positions` (per-pool supplied/borrowed +
HF) and a `defi` block on `GET /v1/wallets/overview` (Σ supplied / Σ borrowed / net + per-(wallet,pool)
health, riskiest first). All reads filter to each wallet's **latest snapshot** so repaid/exited
positions don't linger. The UI shows a consolidated "DeFi positions (Blend)" header plus per-wallet
supplied/borrowed/HF with colour-coded health states; `total_portfolio_usd` (liquid balances) stays
distinct from supplied/borrowed — they are not folded into one number. Health factors come from the
Blend SDK's `PositionsEstimate` (USD via the pool's Reflector oracle), internally consistent
(collateral/debt); the final visual cross-check against the mainnet.blend.capital UI has been
performed and **matched**.

Weak / not final: auth/session is not a final cryptographic production model; strong
proof-of-ownership is **deliberately deferred** — connecting a wallet via the Kit is the beta
"proof" you control a signer (no cryptographic challenge yet). Position aggregation is **Blend-only**
(Soroswap/Aquarius LP positions are post-beta).

Stance: acceptable for beta. Gap A (active-signer model + UI distinction + signing guardrail) and
Gap B (position aggregation + health factor, resolver → API → UI) are **both done**, and the visual HF
cross-check vs mainnet.blend.capital is matched — **T2-D1 is complete** (v2 schema live in prod).

---

## 5. Protocol coverage / analytics reality

**Real, operational, and demonstrable.** Verified by direct prod API/DB inspection on June 18–19, 2026.

| Protocol | Source | Pools | TVL (verified) | State |
|---|---|---:|---|---|
| Blend | Soroban RPC | 4 | ≈ $166M | operational (fixed, orbit, etherfuse, yieldblox; Forex excluded — frozen oracle) |
| Aquarius | Soroban RPC | 4 | ≈ $22.7M | operational |
| Stellar native DEX | Horizon | 9 | ≈ $6.2M | operational (now aggregated at protocol level) |
| Soroswap | Soroban RPC | 1 active | ≈ $130k | operational (dead native/EURC pair disabled) |
| DeFindex | DeFindex API (SDK) | 3 vaults | ≈ $18.8M | operational — **live in prod since Aug 4** (T3-D1) |
| Wallet balances | Horizon + Stellar RPC | — | — | operational |

All five protocols aggregate at the protocol level (`protocol_metrics_latest`), with a synchronous
`as_of` within one `job:refresh` cycle, observed advancing across consecutive cycles.
`protocolCount` = 5 (DeFindex added — T3-D1 Lot B; enumerated from `GET /vault/discover`, 3 mainnet
vaults incl. an EURC one, TVL priced via the `asset_prices` pipeline, APY stored as a fraction; venue
`defindex`, `entity_type='yield_vault'`). The Soroswap native/EURC pair was archived on-chain (all reads 404); it is
soft-disabled and excluded from the API and from TVL aggregation, which corrected the inflated
Soroswap TVL (was ≈$587k including the dead pair, now ≈$130k of live liquidity).

**Blend pool coverage (updated June 26, 2026):** YieldBlox (`CCCCIQSD…`, ≈$2.9M, 8 reserves) added as
a 4th active Blend entity so positions on it resolve (test wallet `GCSQXZ…` supplies on YieldBlox; the
resolver/refresh are entity-driven, so the seed was the only change — no resolver/health code touched).
Its two previously-unpriced reserves (AQUA, USDGLO) were added to the pricing config (CoinGecko
`aquarius` / `glo-dollar`). The **Forex** pool is deliberately **excluded** — its on-chain oracle is
frozen (Blend UI: "oracle currently experiencing issues"), which would yield garbage HF / break refresh;
revisit when it recovers. `BLEND_POOL_ID` in the indexer `.env` is a discovery/probe default only — the
indexed perimeter is the Blend entities in the DB, not that var.

Remaining gaps: none for T3-D1 — the Lot B changes (DeFindex + freshness + retries) are **deployed
to prod** (VPS bootstrap + full `job:refresh` clean on Aug 4, ~3 min end-to-end; `/v1/protocols`
serves 5 protocols with `isStale=false`; Vercel front live). DeFindex user positions stay out of
scope (portfolio is Blend-only by design).

---

## 6. Data freshness / reliability

**First-class as of T3-D1 Lot B — live in prod since Aug 4.**

Exists: refresh jobs on a 15-min cron; persisted timestamps across snapshots/metrics (`snapshot_at`,
`as_of`, `occurred_at`, `observed_at`); synchronous refresh cycles; inactive sources soft-disabled.

**Landed (T3-D1 Lot B):**
- **Stale detection exposed on the read path** — every `/v1/*` payload with an `as_of` (protocols,
  pools, pool detail, `/v1/network/stats`) returns `isStale` + `staleAfterSeconds`, computed at read
  time (`apps/api/src/common/freshness.ts`). Threshold `FRESHNESS_STALE_AFTER_MINUTES`, default 45
  (3× the cron). `stale` kept as a backward-compatible alias.
- **UI staleness indicator** — freshness chip on the Protocol View header ("Updated Xm ago" → amber
  "Stale — older than 45m"), amber badge on stale protocol tabs, chip on `PoolDetail`
  (`FreshnessChip.vue`).
- **Standardized exponential-backoff retries** — every step of `71-refresh-all-metrics` runs through
  `runTsxWithRetry` (`scripts/shared/retry.ts`): 3 attempts, 5s→20s + jitter, per-step logging;
  non-fatal steps keep catch-and-log as the last resort.

Still incomplete (later T3): ingestion health endpoint / observability (RPC latency + error-rate
metrics are T3-D3).

---

## 7. Notifications / alerting

**Live in prod (T2-D2) — complete.** The in-app alerting engine runs end to end on the VPS —
`stellar_v3_alerting.sql` applied and the `job:wallet-alert` cron scheduled — with **real
`alert_fired` notifications in the prod DB**, and the delivery is captured in the submission demo. The
as-built is deliberately the minimal shape the T2-D2 criteria require — **not** the sub-minute event
stream from the architecture doc:
- **Rule storage:** `alert_rules` + `alert_rule_state` + `notifications` (`stellar_v3_alerting.sql`,
  depends on v1 entities + v2 `user_wallets`), managed via `GET/POST /v1/alert-rules`.
- **Evaluation:** a periodic **OS-cron sweep** (scripts `82`→`81`→`83`, `job:wallet-alert`) — no
  broker, no in-process scheduler — evaluating rules against the wallet/pool snapshot DB (first rule
  family: health-factor risk, consuming T2-D1's `wallet_pool_health`) and writing a `notifications`
  row on each fire/resolve edge.
- **In-app delivery:** `GET /v1/notifications` → a web notification **bell** + **Alerts page** via
  HTTP polling. The Alerts page is now the approved design (`AlertsView.vue` — Activity feed + Your
  alert rules — with the 4-step `AlertRuleModal.vue` builder), reconciled to the real contract in
  `composables/useAlerts.ts` (a thin view-model adapter over `useAlertRules` + `useNotifications`).
  The builder shows the full vision but gates creation to the one evaluated family — **wallet ·
  health-factor** — marking every other metric "soon" and disabling create, so nothing implies an
  alert that won't fire. (This supersedes the earlier `AlertRuleForm`/`AlertRulesList` scaffold.)
  The same shared data is also surfaced as a compact **dashboard Alerts panel** (`WalletAlertsPanel.vue`,
  in the multi-wallet right column) — recent notifications + "New alert rule" + "View all ›" to the
  full page — which replaced the old mock "Notifications / On-chain actions — Coming soon" placeholder
  (real on-chain actions remain T3-D2, out of scope here).

This matches the verbatim criterion (rules evaluated against the snapshot DB → in-app notifications).
Deploy is done (schema + cron live on the VPS, real `alert_fired` rows in prod) and the delivery is
captured in the ~5-min submission demo video — T2-D2 is complete.

---

## 8. On-chain actions / transaction builder

**Fully proven on Testnet, narrow in scope by design.** The non-custodial path works end-to-end from
the UI with a successful on-chain transaction.

Working (verified Jun 19, 2026): the `actions/` module in `apps/api` exposes `POST /v1/actions/sdex/swap`,
`POST /v1/actions/sdex/quote`, and `POST /v1/actions/blend/deposit`. The SDEX swap builds a
multi-operation XDR — `ChangeTrust` (classic) + `PathPaymentStrictSend` (classic) bundled in one
envelope — the literal `ChangeTrust + Deposit`-style multi-op the T1-D3 criterion asks for, executed on
Stellar's **native SDEX** (the exchange layer built into the protocol, no third-party contract). The
widget quotes the price live (Horizon strict-send), derives min-receive with 5% auto-slippage, signs
the XDR in-wallet via Stellar Wallets Kit (Freighter), and submits to the Testnet RPC. Backend never
sees private keys.

**Proven on-chain — fully successful swap (Jun 19, 2026):**
tx `fb10c5b8d86b87bc3408bf0d4e9698f93370a3e788244008ef31f6200a12b8b2` — **Successful** on Testnet
(ledger 3171933): swapped 10 XLM → 5.9118862 USDC, min-receive (5.616…) respected. Source account
`GCLSPNUDT5GCKMVOJXNDQ2HALGZQPB2MFY7FTJZ4QGY5QYYYP6SLCF2O`. Verifiable on stellar.expert/testnet.
This satisfies all three T1-D3 criteria: (1) multi-op XDR from the UI; (2) successfully executed on
Testnet; (3) signatures exclusively in-wallet via Wallets Kit.

What made it reliable: the swap originally failed `pathPaymentStrictSendTooFewOffers` because the
configured USDC issuer (GATALTGT, the Blend SAC wrap) has no direct XLM liquidity on Testnet, and the
manual min-receive assumed a ~1:1 rate. Fix: the swap now points to Circle's testnet USDC (GBBD47…,
deep XLM/USDC pool) via a swap-only asset constant (Blend's USDC untouched), and min-receive is derived
from a live quote with slippage instead of a manual guess.

Architectural fact (important): Stellar Protocol 20 forbids mixing `InvokeHostFunction` (Soroban) with
classic operations in one envelope. So the grant's literal `ChangeTrust + Deposit` single-XDR is only
achievable via classic SDEX, not Blend. Hence the SDEX swap is the primary single-XDR demonstration of
the criterion; the Blend deposit is a secondary Soroban pattern (two sequential txs).

**Generalized to multiple vetted SDEX pairs (Jul 21, 2026 — T3-D2 groundwork, still Testnet-only):**
the single hardcoded XLM→USDC widget is now a config-driven list. `sdex/swap` + `sdex/quote` accept an
explicit `{ code, issuer }` asset descriptor (legacy `'XLM'`/`'USDC'` strings still resolve for rollout
safety); the frontend drives rows from `apps/web/src/config/testnetSwapPairs.ts` — a **front-only**
config (no DB testnet entities, so prod TVL/`protocolCount` do not move). The UI is a single
Uniswap-style widget — From/To asset selectors (XLM + the vetted targets), an invert arrow, the
connected address's live testnet balances (Horizon `/accounts/:id`) beside each selector with a MAX
helper, live quote + 5% min-receive. Directions with no fillable path (most target→XLM books are empty)
surface the quote's clean "No liquidity for this direction on testnet" state, never a raw error. Pairs
are vetted against Horizon testnet `/paths/strict-send` (the same oracle `/quote` uses), each required
to fill a small strict-send at 5% slippage:

- **XLM → USDC** (`GBBD47…`, Circle) — deepest testnet book (8 levels). Flagship / proven path.
- **XLM → yXLM** (`GC63WR…`) — direct route, ~1:0.95.
- **XLM → AQUA** (`GC63WR…`) — direct route, fills (small unit output at current testnet price).
- Excluded as a negative check: **XLM → EURC** (`GDKH3M…`) has an XLM offer but returns 0 fillable
  strict-send records; meme AMM tokens omitted for demo credibility.

The security gate `validateSwapXdr` (previously present but **unwired**) is now enforced before every
signature: the returned XDR is validated against an intent derived from user input (source/destination =
user, exact asset code+issuer, sendAmount, destMin ≥ accepted). It was extended with an opt-in
`allowTrustlineFor` so a first-time swap's leading `ChangeTrust` (for the exact dest asset only) is
permitted — a `ChangeTrust` for any other asset, or any other extra op, is still rejected. **Proven
in-wallet (Jul 21, 2026):** two SDEX swaps through the unified widget were signed in Freighter and
landed on testnet, each validated against declared intent by `validateSwapXdr`.

Blend deposit — now exercised from the UI (Jul 21, 2026): a testnet-gated "Blend Deposit" card drives
the previously-never-UI-exercised `POST /v1/actions/blend/deposit`. Reality-checked against
soroban-testnet: supplying **XLM** collateral to pool `CCEBVDYM…` **simulates OK** (~0.06 XLM resource
fee) — native, no trustline, friendbot-funded → the reliably demoable path. **USDC** supply needs the
SAC-backed testnet USDC (`GATALTGT…`, a *different* asset than the Circle USDC the swap yields — the
card says so, and the swap cannot provide it).

The USDC 2-step is now **correct** (fixed Jul 21, 2026 after an on-chain `Contract #13` "trustline entry
is missing"): the Soroban deposit **cannot be simulated** until the classic `USDC:GATALTGT` trustline
exists, so a single build-then-2-sign is impossible. The endpoint detects the trustline via Horizon
balances (the source of truth #13 tests, not `rpc.getAssetBalance` which throws on a missing one); when
absent it returns **only** the ChangeTrust (`trustlineRequired: true`, empty deposit XDR) — the deposit
is never built/signed/submitted without the trustline. The card signs + **confirms the ChangeTrust
on-chain** (polls `getTransaction`), then **re-requests** the build (now simulatable) before signing the
deposit. A funded account with no USDC now gets an honest `#10` balance error, not a `#13`. Same
guardrails throughout (testnet-only, active-signer-only, light client-side XDR check). XLM deposit
stays single-step. **Proven on-chain (Jul 21, 2026):** an XLM deposit to Blend was signed in Freighter
and landed on testnet — tx `a842f370c70bf78e9ecd42a612fb22b6307be423478dddec13774bb9c1fbbe39`; the
2-step USDC ordering is proven in simulation.

USDC acquisition path (checked Jul 21, 2026): there is **no in-app way to obtain this reserve USDC**.
It is the SAC (`CAQCFV…`) of classic `USDC:GATALTGT` whose admin is the issuer account, so minting needs
that secret (Blend's `blend-utils` scripts) — not a permissionless faucet; and testnet SDEX has only
dust liquidity for it (~0.001 USDC for 50 XLM), failing the swap-vetting bar. So the deposit card makes
**XLM the default/primary (recommended, zero-prereq) path**, shows the connected address's live testnet
balances, and when USDC is selected with a 0 balance it blocks with an honest "can't be obtained in-app —
use XLM" message (the user must acquire that USDC out-of-band to demo the USDC 2-step). XLM deposit
sim on a fresh friendbot account: OK (~0.061 XLM resource fee).

The `getAssetBalance` trustline bug is **fixed** (both action paths now check classic trustlines via
Horizon — `hasClassicTrustline`; `ChangeTrust` is bundled iff genuinely missing, INV-5.1).

**Mainnet swaps are LIVE since Aug 2 (T3-D2)** — ungating replaced the hard testnet-only gate with a
controlled regime: server kill-switch `ACTIONS_MAINNET_ENABLED` (403 by default), server-enforced
100 XLM per-tx cap, issuer-verified 5-pair whitelist (XLM↔USDC/EURC/AQUA/yXLM/PYUSD), client-side
pre-sign XDR validation (`validateSwapXdr`, fail closed, incl. fee cap), in-wallet signing only.
First real mainnet swaps executed in both directions (1 XLM→USDC; USDC→XLM `eeeae199…`). Contract:
`docs/security-invariants.md`; evidence: `docs/evidence/mainnet-ungating-2026-08-02.md` +
`pair-vetting-2026-08-01.md`. The Blend deposit remains testnet-only until Lot A2.

---

## 9. Deployment / operations

**Real and operational, not yet fully matured.** Public beta live: `apps/web` on Vercel
(`stellar.getdig.ai`), `apps/api` on a DigitalOcean VPS behind nginx + PM2
(`stellar-api.getdig.ai`, `/health` ok), `apps/indexer` on a 15-min cron with `flock` guarding against
overlap. Local dev works (`docker compose` → Postgres 16 + Redis 7).

Incomplete: deployment is still manual (git pull + build + PM2 restart on the VPS; Vercel auto-deploys
the front); no CI/CD; mature observability (RPC latency/error metrics) not in place; no exposed
deployed-commit SHA to prove VPS/Vercel version alignment. Runbooks are maintained.

Near-term: this shape is fine for the beta and the Tranche 2 claim. CI/CD and observability are T3.

---

## 10. Strongest right now
1. Horizon + Soroban indexing foundation (4 protocols, verified coverage + freshness, 15-min cron)
2. Live beta on real Mainnet data
3. Backend/API as the single product façade (`/v1` raw-SQL pipeline, DB-backed network stats)
4. Non-custodial transaction builder: SDEX swap **fully successful** on Testnet, with live quote + auto-slippage
5. Grouped multi-wallet portfolio foundation (raw SQL v2)
6. Real wallet balance snapshot/refresh flows
7. Architectural separation (web / api / indexer)

## 11. Most fragile right now
1. Freshness/stale/retry operationalization + observability (T3)
2. Deployment maturity / CI-CD (T3)
3. Transaction builder breadth: SDEX swap + Blend testnet deposit both proven on-chain from the UI
   (deposit tx `a842f370…`); mainnet execution remains T3-D2

## 12. Closest tranche-relevant wins
1. SCF Tranche 3 (30%) submission — the T2 group (portfolio/active-signer, live alerting, live bridge)
   is **filed for disbursement review**, awaiting SCF validation
2. ~5-min prod demo video — recorded and attached (T2 deliverables + T1 MVP walkthrough)
3. (Next group) begin the T3 group — mainnet actions (T3-D2) + freshness/observability (T3-D1/D3)

---

## 13. Current execution priorities (updated 2026-08-04 — internal T3 target: Aug 15)
1. **T3-D2 KPI push** — mainnet swaps are live; 50+ wallets / 200+ txs accumulate only while the
   window is open. Distribution (Stellar/SCF channels, communities) is scheduled work.
2. **Lot A2 — Blend deposit on Mainnet** (the "vault/lending" half of T3-D2; testnet-proven
   `a842f370…`, mainnet extension under the same flag/cap regime)
3. **T3-D3** — sidebar UX redesign, RPC latency/error metrics, SDF reference packaging
4. **T3-D1 demo capture** (the only remaining T3-D1 item — everything else is live in prod)
5. Keep `grant-roadmap.md` and `status-board.md` aligned with this reality
   (T1 + T2 submissions both filed, awaiting SCF validation — nothing pending on our side)

(Done this session: data cleanup — stellar-native protocol aggregation, dynamic `protocolCount`=4,
dead Soroswap pair hidden + TVL corrected, "native"→"XLM" display, Blend panel trimmed; cron moved to
15 min; Validation Cloud `joinUrl` fix resolving a cascading refresh failure; T1-D3 SDEX swap proven
**fully successful** on Testnet via a live-quote + auto-slippage flow.)

What should not dominate now: over-engineering auth/session, premature abstraction layers, broad
refactors not tied to a tranche need, or polishing low-value UI before the Tranche 2 submission is out.

---

## 14. How to update this file
Update when a feature moves from partial to stable, a placeholder becomes real, a new backend/indexer
capability becomes operational, deployment reality changes, a fragile area becomes dependable, or a
grant deliverable meaningfully advances. Prefer brutal clarity over optimism.