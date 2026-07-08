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
validated, approved, or paid). The current phase is no longer T1 packaging but **T2 execution**:
T2-D1 portfolio/active-signer (substantially done), T2-D2 in-app alerting (built, awaiting internal
validation), T2-D3 bridge monitoring (code-complete, VPS deploy pending).

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
and `VITE_STELLAR_NETWORK` is only the initial default. The swap widget is gated Testnet-only
(disabled + notice on Mainnet) since the Mainnet action path is T3-D2, not yet validated.

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
are excluded from `/v1/pools` (and 404 on `/v1/pools/:slug`) so dead pools never surface.

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
balance snapshot generation; runs on a 15-minute cron on the VPS. Inactive entities (archived Soroban
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
(collateral/debt); a final visual cross-check against blend.capital's UI is recommended.

Weak / not final: auth/session is not a final cryptographic production model; strong
proof-of-ownership is **deliberately deferred** — connecting a wallet via the Kit is the beta
"proof" you control a signer (no cryptographic challenge yet). Position aggregation is **Blend-only**
(Soroswap/Aquarius LP positions are post-beta).

Stance: acceptable for beta. Gap A (active-signer model + UI distinction + signing guardrail) and
Gap B (position aggregation + health factor, resolver → API → UI) are **both done** — T2-D1 is
substantially complete (live on local; VPS applies the v2 schema at deploy).

---

## 5. Protocol coverage / analytics reality

**Real, operational, and demonstrable.** Verified by direct prod API/DB inspection on June 18–19, 2026.

| Protocol | Source | Pools | TVL (verified) | State |
|---|---|---:|---|---|
| Blend | Soroban RPC | 4 | ≈ $166M | operational (fixed, orbit, etherfuse, yieldblox; Forex excluded — frozen oracle) |
| Aquarius | Soroban RPC | 4 | ≈ $22.7M | operational |
| Stellar native DEX | Horizon | 9 | ≈ $6.2M | operational (now aggregated at protocol level) |
| Soroswap | Soroban RPC | 1 active | ≈ $130k | operational (dead native/EURC pair disabled) |
| Wallet balances | Horizon + Stellar RPC | — | — | operational |

All four protocols aggregate at the protocol level (`protocol_metrics_latest`), with a synchronous
`as_of` within one `job:refresh` cycle, observed advancing across consecutive cycles in prod.
`protocolCount` = 4. The Soroswap native/EURC pair was archived on-chain (all reads 404); it is
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

Remaining gaps: DeFindex (T3), freshness visibility, stronger retry/backoff. The implementation exists;
remaining work is operationalization and freshness exposure — all later tranches.

---

## 6. Data freshness / reliability

**Partially operationalized.**

Exists: refresh jobs on a 15-min cron; persisted timestamps across snapshots/metrics (`snapshot_at`,
`as_of`, `occurred_at`, `observed_at`); synchronous refresh cycles verifiable in prod; inactive sources
soft-disabled and excluded.

Incomplete: freshness metadata is not consistently exposed through the API; stale detection is not
first-class; retries/backoff are protocol-specific, not standardized; health visibility is limited.

Why it matters: data credibility, the T3-D1 freshness-tracking promise, user trust, debugging.
Priorities (all T3-D1): (1) expose freshness in API responses; (2) define expected intervals per
dataset; (3) auto-detect stale sources; (4) standardize retry/backoff; (5) minimal ingestion health
visibility.

---

## 7. Notifications / alerting

**Built (T2-D2), awaiting internal validation.** The in-app alerting engine exists end to end and is
functional locally; it is not yet SCF-claim-ready (pending internal validation/demo + VPS deploy). The
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

This matches the verbatim criterion (rules evaluated against the snapshot DB → in-app notifications).
Remaining before an SCF claim: internal validation/demo and the VPS deploy (apply
`stellar_v3_alerting.sql` + schedule the `job:wallet-alert` cron; see `docs/runbooks.md`).

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

Partial / weak (beyond the T1-D3 criteria): the Blend deposit endpoint exists but has not been
exercised end-to-end from the UI; minor known bug — `getAssetBalance` re-bundles `ChangeTrust` even
when the trustline already exists (harmless; fix via Horizon `/accounts/:id`). These are polish / T3-D2
items, not gaps against the T1-D3 contract.

The builder gates Mainnet-only swaps off (button disabled + notice + hard guard in `onSwap`), so no
real Mainnet swap can fire before T3-D2. The same builder code targets mainnet — only contract
addresses and the network differ.

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
1. Bridge monitoring (T2) — code-complete, not yet live on the VPS
2. Freshness/stale/retry operationalization + observability (T3)
3. Deployment maturity / CI-CD (T3)
4. Transaction builder breadth: SDEX swap proven; Blend deposit not yet exercised from UI
5. Alerting engine (T2) — built, not yet internally validated or deployed to VPS

## 12. Closest tranche-relevant wins
1. SCF Tranche 2 (20%) submission — all three MVP deliverables meet their criteria
2. Demo video covering D1 (live `/v1` data), D2 (live dashboard), D3 (live successful swap)
3. Formalize active-signer vs watch-only as groundwork for T2-D1

---

## 13. Current execution priorities
1. T1 (MVP) is submitted — **awaiting SCF validation**; no further T1 build work pending review
2. T2 execution: internal validation/demo of T2-D2 in-app alerting; T2-D1 final HF cross-check vs
   blend.capital; T2-D3 VPS deploy (bridge schema + Allbridge bootstrap)
3. Keep `grant-roadmap.md` and `status-board.md` aligned with this reality

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