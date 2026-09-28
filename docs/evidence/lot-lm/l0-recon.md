# Lot LM — L0 read-only recon: multi-protocol lending (XOXNO Lending + Alula)

**Date:** 2026-09-28 (probes 11:55–12:02 UTC, mainnet ledgers 64662148–64662204)
**Scope:** read-only reconnaissance for a cross-protocol *lending* layer (L1 markets, L2 positions + risk).
L3 actions are out of scope. No code, schema, DB, dependency or git change was made; this file is the
only artifact. Every number below traces to a command shown in the section that cites it.
**Phase:** post-grant (SCF #43 closed). Nothing here moves an SCF 43 criterion; target is the SCF 46
application (8 Nov 2026) + visible product upgrades.

Method: five read-only sweeps (code A–F, partner probes G-Alula / G-XOXNO) plus public-endpoint cost
sampling (H). Raw probe outputs are kept in the session scratchpad only (not committed):
`scratchpad/alula/*`, `scratchpad/xoxno/*`, `scratchpad/live/*`.

One limitation: the 7-day `rpc_metrics_runs` query (H) against the VPS database was **not run** — the
session's auto-mode policy declined the production read over SSH. H uses the public `/v1/ops/*`
endpoints (24h window) instead and gives the exact SQL to run.

One process note: the Alula probe script briefly wrote five scratch files under `apps/indexer/`
(pnpm cwd) before moving them to the scratchpad; `git status --porcelain` afterwards shows only the
pre-existing untracked `agent-world.json`. Nothing tracked was touched.

---

## 0. Executive summary

- **The venue model is already generic enough for L1.** `venues.venue_type` / `entities.entity_type`
  are free-text discriminators (`lending` / `lending_pool` for Blend); the API pool list/detail/series,
  the TVL-drop and APY alert families, `/health`, `/v1/protocols` and the web pool-kind labels all key
  on those values, not on `'blend'`. A new lending venue that writes `reserve_snapshots` with Blend's
  column semantics (`b_supply_scaled` = supplied, `d_supply_scaled` = borrowed, APY fractions) and
  `pool_metrics_latest` is served with **zero** type-branch changes (A2, E1). The mandatory code touches
  are two hard-coded lists in the indexer (71 discovery/steps, 70 `persistProtocol`), the ops target
  classifier, ops labels, and web venue theming (A3).
- **L2 has one real structural gap:** every reader assumes one health row per `(wallet, entity_id)`.
  Alula obligations (`{user, seed}`) and XOXNO accounts (PositionNFT ids) break that; a nullable
  `position_ref` on both v2 tables plus a widened `alert_rule_state` PK and ~8 read-side key changes
  are needed (C2). Blend rows stay NULL, so nothing existing changes.
- **Partner reality (verified on mainnet today):**
  - **XOXNO Lending:** 1 controller, 3 hubs, 25 hub markets, 30 live accounts, supplied ≈ $74.7k,
    borrowed ≈ $1.0k. Public REST (44 GET routes, no auth, no rate-limit headers) plus a complete
    on-chain view surface. Address → accounts **is** resolvable on-chain via the PositionNFT
    enumerable extension (`balance` + `get_owner_token_id`, verified). Per-account HF is a WAD view
    (`get_health_factor`), liquidation at 1.0. Prices: 10 of 25 markets already priced by our rules.
  - **Alula:** 1 market, 3 pools (XLM, USDC, PYUSD), TVL ≈ $11.8k, **market status =
    `FrozenByAdmin` since 2026-09-28 00:55 UTC after a bad-debt event on the native pool.** Public
    REST (8 GET routes) with per-ledger freshness; **no positions endpoint.** Obligations **cannot be
    enumerated from an address alone**: the deployed contract has no `AllObligations` key and no
    per-user index (the docs describe one that is not deployed). Only `seed = None` and the
    market-wide Earn seed (`keccak256("EV")`) are computable; the Multiply seed derivation is not
    public. All three Alula assets are already priced by our rules.
- **HF comparability:** Blend HF, Alula **LHF** (not Alula's unweighted "HF") and XOXNO HF are all
  "liquidation-threshold-weighted collateral / debt, liquidatable below 1.0". They can share
  `HealthFactorGauge` and `utils/health.ts` thresholds **if** the stored value is the
  liquidation-relative factor for every venue (C3).
- **Network TVL:** the canonical sum is a deny-list (`v.slug <> 'defindex'`), so both venues would be
  included automatically. Combined impact today ≈ +$86k on $254.4M (+0.03%), invisible on the chart;
  neither venue wraps Blend, so no double-count. Still needs a decision-doc addendum (E2).
- **Cost:** the refresh pipeline makes ≈ 755 Soroban RPC calls per run, 96 runs/day. L1 via partner
  REST adds 2 REST calls/run; L1 via RPC adds ≈ 27 RPC calls/run (+3.6%). L2 adds ≈ 3 (Alula) +
  ≈ 120–180 (XOXNO) calls per wallet sweep at today's 115 wallets (H).

---

## 1. Findings

### A. Venue / entity model today

#### A1. Blend end to end (raw-SQL v1)

Schema `apps/api/src/db/stellar_v1.sql`:

| Table | Columns (quoted) | Generic vs Blend-specific |
|---|---|---|
| `venues` (`:3-13`) | `id, slug unique, name, chain, venue_type text not null, logo_url, metadata jsonb, created_at, updated_at` | Generic. **No CHECK on `venue_type`.** Observed values (`apps/indexer/src/scripts/bootstrap/registries/core-registry.json`): `lending` (blend), `amm` (soroswap, aquarius, stellar-native), `vault` (defindex), `bridge` (allbridge). |
| `entities` (`:15-26`) | `id, venue_id → venues, slug unique, name, entity_type text not null, contract_address, metadata jsonb, is_active, created_at, updated_at` | Generic. Values: `lending_pool` (blend ×4), `amm_pool`, `yield_vault`. The orchestrator's discovery helper is typed to exactly these three: `71-refresh-all-metrics.ts:128` `entityType: 'amm_pool' \| 'lending_pool' \| 'yield_vault'`. |
| `assets` (`:31-43`) | `id, chain, contract_address unique, asset_type, symbol, name, decimals, logo_url, metadata, …` | Generic, keyed by SAC/Soroban contract (`asset_type='soroban_token'` everywhere). |
| `entity_assets` (`:47-55`) | `id, entity_id, asset_id, role text not null, metadata, unique(entity_id, asset_id, role)` | `role`: `reserve` (Blend), `token0/token1` (AMMs), `underlying` (DeFindex). |
| `pool_snapshots` (`:90-106`) | `venue_id, entity_id, snapshot_at, pool_id, pool_name, reserve_count, total_events, total_deposits, total_swaps, total_exit_pool, unique_callers, metadata, unique(entity_id, snapshot_at)` | Generic but event-oriented; Blend writes all counters `null` (`blend/persist-pool-state.ts:186-222`). |
| `reserve_snapshots` (`:111-136`) | `venue_id, entity_id, asset_id, snapshot_at, symbol, name, decimals, enabled, d_supply_raw, b_supply_raw, backstop_credit_raw, d_supply_scaled, b_supply_scaled, backstop_credit_scaled, supply_cap_raw, supply_cap_scaled, borrow_apr, est_borrow_apy, supply_apr, est_supply_apy, metadata, unique(entity_id, asset_id, snapshot_at)` | **Blend-shaped.** `b_supply_*`, `backstop_credit_*`, `supply_cap_*` and the four APR/APY columns are lending-only; AMMs reuse only `d_supply_scaled` as pool reserve (`66-soroswap-pool-metrics-v1.ts:51`). |
| `pool_metrics_latest` (`stellar_v1_metrics.sql:1-20`) | `venue_id, entity_id, as_of, metric_type ('latest'), tvl_usd, volume_24h_usd, fees_24h_usd, total_supplied_usd, total_borrowed_usd, net_liquidity_usd, total_backstop_credit_usd, weighted_supply_apy, weighted_borrow_apy, metadata, unique(entity_id, metric_type)` | Generic + lending-flavoured; `total_backstop_credit_usd` is Blend-only. APYs stored as **fractions** (`defindex/persist-vault-metrics.ts:22-23`, "7.14% → 0.0714"). |
| `protocol_metrics_latest` (`stellar_v1_metrics.sql:28-41`) | `venue_id, as_of, tvl_usd, volume_24h_usd, fees_24h_usd, avg_supply_apy, avg_borrow_apy, metadata, unique(venue_id)` | Generic. |
| `network_tvl_snapshots` (`stellar_v1_network_tvl.sql:24-35`) | `as_of pk, tvl_usd, protocol_count, created_at, tvl_net_usd null` | Generic; header `:7-13`: lending contributes GROSS (total supplied), DEX pool liquidity, DeFindex excluded. |

**Column semantics that any second lending venue must respect.** `blend/compute-pool-metrics.ts:92-98`:

```ts
// d_supply_scaled / b_supply_scaled are intentionally interpreted inverted
// compared to our previous assumption, based on validation against blend.capital UI.
const supplied = toFiniteNumber(row.b_supply_scaled);
const borrowed = toFiniteNumber(row.d_supply_scaled);
```

The same split is encoded by venue type in the alerts TVL query (`alerts.repository.ts:800-803`:
`case when v.venue_type = 'lending' then rs.b_supply_scaled else rs.d_supply_scaled end`) and in the
pool detail (`stellar.service.ts:652-667`: `supplied: b_supply_scaled`, `borrowed: d_supply_scaled`).
**Pre-existing inconsistency (verified):** two API reads sum `d_supply_scaled` as if it were TVL —
the protocols top-assets CTE (`stellar.service.ts:250`) and the pool series (`:930`). For Blend that is
the *borrowed* side. Any new lending writer inherits this; it must be fixed or at least known before
a second venue lands (see Risks).

**Seed rows / slugs.** Legacy `seed_blend_v1.sql:1-9` inserts
`('blend','Blend','stellar-mainnet','lending', …)`; the live bootstrap is
`apps/indexer/src/scripts/bootstrap/seed-core.ts` (`pnpm -C apps/indexer bootstrap:core`) over
`core-registry.json` (venues `:77-92`, assets `:98-115`, entities `:125-141`, `entity_assets`
`:154-163`, one `BEGIN/COMMIT`). Blend's adapter also self-upserts venue + entity each refresh
(`blend/persist-pool-state.ts:68-89`, `:93-130`, entity metadata `{reserveCount, admin, backstop,
oracle, status, maxPositions, minCollateral}`), reserve assets from on-chain token metadata
(`:134-142`) and links with role `reserve` (`:160-183`). Slugs are dash-only:
`blend-fixed-pool`, `soroswap-native-usdc-pair`, `aquarius-<a>-<b>-pool`, `defindex-meru-usdc`
— there is no `blend:<pool>` colon form anywhere.

Registry venue rows:

| slug | venue_type | metadata.source |
|---|---|---|
| blend | `lending` | blend_final_registry |
| soroswap / aquarius / stellar-native | `amm` | (per-protocol registries; native pools discovered at refresh) |
| defindex | `vault` (`category: "yield"`) | defindex_bootstrap |
| allbridge | `bridge` | allbridge-upsert-core |

#### A2. Venue category

There is no separate category column: **`venues.venue_type` is the category** and `entities.entity_type`
the entity shape. Every consumer branches on those two:

- API: `stellar.service.ts:308` (`type: row.venue_type` on `/v1/protocols`); `:454`
  `isAmm = protocol_type === 'amm' || entity_type === 'amm_pool'` (the only list branch); pool detail
  `:596-597` same test, non-AMM branch `:660-690` returns the lending shape and hard-codes
  `protocol.type: 'lending'` (`:675`) — DeFindex vaults go through it with empty `reserves`; series
  `:909-911` lending-only gate. Alerts: `alerts.repository.ts:800` and `:920` (`listApyPools`
  restricted to `venue_type = 'lending'`). `/health` (`app.controller.ts:39-44`) enumerates all venues.
- Web: `ProtocolsView.vue:36-45` `VENUE_TYPE_LABEL = { lending, amm, vault, bridge }` + `stellar-native`
  override; `poolKind()` `:69-74` from `entity_type`; `PoolDetailView.vue:44-57`
  `isLending = type === 'lending_pool'`. Branding by slug: `data/protocolMeta.ts:6-34`,
  `data/venueTheme.ts:16-22` (unknown slug → neutral `FALLBACK` `:24-29`, bullet monogram).
- Indexer: `71-refresh-all-metrics.ts:277-280` discovery by `(venue slug, entity_type)` pairs;
  `70-protocol-persist-metrics.ts:169-173` hard-coded `persistProtocol()` list; `:142` network-TVL
  deny-list; wallet health `81-stellar-wallet-blend-positions.ts:72-80` `where v.slug = 'blend' and
  e.entity_type = 'lending_pool'`.

**Smallest plug-in:** insert venues with `venue_type='lending'` + entities `entity_type='lending_pool'`
(registry JSON + optional `<venue>-upsert-core.ts`), write `reserve_snapshots` with Blend semantics
and `pool_metrics_latest`. Then list/detail/series, alert TVL/APY pickers, `/health`, `/v1/protocols`,
and the web kind labels work unchanged. Mandatory code touches: the two indexer lists (71, 70),
`OpsTarget` + host classifier (B2), `STEP_LABELS` / `RPC_LABELS` (`modules/ops/status.ts:80-96`),
and web `venueTheme`/`protocolMeta` + a bundled SVG for logos.

#### A3. DeFindex as the template (Lot B, commit `21352b3`, 27 files)

`docs/lot-b-freshness-defindex.md:21-53`, `docs/evidence/lot-b/README.md:44-47`: "the only hardcoded
list-of-4 was `70-protocol-persist-metrics.ts` (added `'defindex'`) … API and web are venue-driven".

| Layer | File | What |
|---|---|---|
| bootstrap | `apps/indexer/src/scripts/bootstrap/defindex-upsert-core.ts` (new) | venue `defindex`/`vault`, 3 `yield_vault` entities, assets, role `underlying` |
| adapter | `apps/indexer/src/lib/protocols/defindex/{fetch-vault.ts, persist-vault-metrics.ts, types.ts}` (new) | fetch via `@defindex/sdk` (`fetch-vault.ts:15-32`); persist `pool_metrics_latest` + `pool_snapshots` (`persist-vault-metrics.ts:100-188`); **no `reserve_snapshots`** |
| step | `apps/indexer/src/scripts/ingest/run-defindex-refresh.ts` (new) | env `ENTITY_SLUG`, `DEFINDEX_VAULT_ADDRESS`, `DEFINDEX_API_KEY` (`:18-34`); first line `import '../../lib/ops-capture'` (`:8`, added later in `1bedb2d`) |
| orchestrator | `71-refresh-all-metrics.ts:280` discovery, `:357-372` step 6b | |
| rollup | `70-protocol-persist-metrics.ts:173` | one `persistProtocol(client, 'defindex')` line; `:142` network exclusion |
| retry | `apps/indexer/src/scripts/shared/retry.ts` (new) | B1 |
| ops | `lib/ops-metrics.ts:25,89` (`'defindex-api'` target + host rule); `ops/status.ts:86,95` labels | later commits |
| API | `common/freshness.ts` (new), `stellar.service.ts` (+38), `network.service.ts` (+9) | freshness only, no DeFindex branch |
| web | `FreshnessChip.vue` (new) + freshness wiring; `PROTOCOL_META.defindex` / SVG pre-existed (`8297c98`), theme in Lot C (`305174a`) | |
| docs | `docs/lot-b-freshness-defindex.md`, `docs/evidence/lot-b/*`, `docs/runbooks.md`, `docs/current-state.md` | |

Not to follow: `apps/indexer/src/run-defindex.ts` (legacy Prisma path).

### B. Indexer pipeline

#### B1. Step order, adapters, retry, freshness, atomic batches

`72-run-refresh-job.ts` resolves RPC (`:38`), builds env (`:46-56`) and spawns
`71-refresh-all-metrics.ts` (`:69-73`). 71 is a **hard-coded sequence, no adapter registry**:

1. discovery `:277-280` — `soroswap/amm_pool`, `blend/lending_pool`, `aquarius/amm_pool`,
   `defindex/yield_vault` via `getPoolsByVenue` `:217-259` (`is_active = true`)
2. `prices:reference` → `62-price-reference-assets.ts` (`:284-286`)
3. `prices:soroswap-derived` per pair → `63-price-soroswap-derived.ts` (`:290-300`)
4. `blend:<slug>` per pool → `run-blend-pool-refresh.ts` (`:304-315`; env `ENTITY_SLUG`, `BLEND_POOL_ID`)
   → `fetchBlendPoolState` → `persistBlendPoolState` → `persistBlendPoolMetrics` (68 is called inside)
5. `soroswap:<slug>` (`:319-331`), `aquarius:<slug>` (`:335-349`, 5 s spacing), `stellar-native` (`:353-355`),
   `defindex:<slug>` (`:361-372`)
6. `protocol-metrics` → `70-protocol-persist-metrics.ts` (`:378-380`), which also writes
   `network_tvl_snapshots` (`70:128-162`)
7. `allbridge` (`:384-386`), `network-stats` → 73 (`:390-392`)
8. `persistOpsObservability` → `rpc_metrics_runs` + `refresh_step_runs` (`:172-215`, `:396`);
   any FAILED step → exit 1 (`:401-413`); every step non-fatal via `track`/`trackEach` (`:65-120`).

Retry: step-level `scripts/shared/retry.ts:55-100` (`runTsxWithRetry`, 3 attempts, 5 s / 20 s +
jitter) wrapped by `runStep` (`71:25-36`); HTTP-level `scripts/discovery/00-common.ts:95-172`
`fetchJson` retries network errors and HTTP 429 only (4 retries, 1/2/4/8 s). Blend uses SDK loads
(`blend/fetch-pool-state.ts:158-163`), not `fetchJson`.

Freshness (45 min): `apps/api/src/common/freshness.ts:12-19`
(`FRESHNESS_STALE_AFTER_MINUTES ?? STALE_THRESHOLD_MINUTES ?? '45'`), `computeFreshness` `:36-55`;
consumers `stellar.service.ts:25-37`, `network.service.ts:137-138`, `app.controller.ts:48-53`,
`ops/status.ts:196,366`. Web reads `staleAfterSeconds` (no constant). Indexer has no freshness logic.

Atomic batches (dead-reserves fix, `docs/evidence/dead-reserves-2026-08-14.md:53-72`): writers use one
`snapshotAt` per pool per run inside `BEGIN … COMMIT` (`blend/persist-pool-state.ts:64-66, 307-313`;
same in Soroswap/Aquarius persisters); readers filter to `max(snapshot_at)` per entity
(`compute-pool-metrics.ts:74-77`, `stellar.service.ts:224-228`, `alerts.repository.ts:790-806`). The
batch key is `snapshot_at`, not a run id. **A new lending writer must follow exactly this pattern**
(one timestamp, one transaction per entity) or removed reserves will be resurrected.

#### B2. Would partner REST fetches pollute `rpc_metrics_runs`?

`apps/indexer/src/lib/ops-metrics.ts`: `OpsTarget = 'soroban-rpc' | 'horizon' | 'defindex-api' |
'price-sources'` (`:25`). `installOpsCapture()` (`:101-113`) patches **global `fetch`** (`:115-145`)
and the axios instances of `@stellar/stellar-sdk`, `@blend-capital/blend-sdk`, `@defindex/sdk`
(`:151-183`). Classification is **host-based** (`classifyOpsTarget` `:81-95`): RPC hosts from env,
`horizon`, host contains `defindex` → `defindex-api`, `coingecko.com|llama.fi|stellar.expert` →
`price-sources`. **Unknown hosts return `null` and are dropped** (`:94`, `:131`, `:219`).

Answer: a `fetch('https://api.alula.finance/…')` or `fetch('https://api.xoxno.com/…')` from a step
that imports `ops-capture` is intercepted but **not recorded**, so it would neither pollute RPC
metrics nor be observable. Proposal (report-only): extend `OpsTarget` with `'alula-api' | 'xoxno-api'`,
add two host rules next to `:89` (`host.endsWith('alula.finance')`, `host.endsWith('xoxno.com')`),
update the SQL comment `stellar_v1_ops_metrics.sql:13` and `RPC_LABELS` (`ops/status.ts:93-98`). No
migration (`target text`). The `/v1/ops/metrics` `rpc[]` array already mixes REST (`defindex-api`,
`price-sources`) with RPC; a derived `kind: 'rpc' | 'rest'` in `ops.service.ts` would let the status
page group "Chain endpoints" vs "Partner APIs" without renaming the payload.

Evidence that the mechanism already works for a REST partner (public endpoint, 2026-09-28 11:55 UTC):

```
$ curl -s https://stellar-api.getdig.ai/v1/ops/metrics | jq -r '.rpc[] | "\(.target) calls24h=\(.calls)"'
defindex-api calls24h=576
horizon calls24h=96
price-sources calls24h=384
soroban-rpc calls24h=70048
```

#### B3. Asset pricing coverage

Sources (`62-price-reference-assets.ts`): CoinGecko simple-price (`:86`, optional `COINGECKO_API_KEY`),
manual stable/env/fallback rules, DB-cached fallback when CoinGecko fails (`:148-191`), plus
`soroswap_derived_pair` (`63-price-soroswap-derived.ts:106-133`). **No oracle (Reflector/SEP-40)
integration exists.** Rules are keyed **by symbol** (`scripts/shared/pricing-config.ts:16-50`
`PRICING_RULES_BY_SYMBOL`): native, USDC, PYUSD, oUSD, yUSDC, EURC, SolvBTC, xSolvBTC, BTC, yXLM,
USTRY, TESOURO, CETES, AQUA, USDGLO, USDY, ETH; unlisted → `inferStablePrice` (`pricing.ts:25-32`,
USDC/USDX) else **no price row** (`62:394-396`). Unpriced assets are silently valued at **$0** in every
metrics writer (`compute-pool-metrics.ts:92,101-107`; `66:52-64`; `69:132`;
`stellar-native/persist-pool-metrics.ts:137-144`; `defindex/persist-vault-metrics.ts:80-86`) and in the
API (`stellar.service.ts:247-256` `coalesce(price, 0)`) — TVL is undercounted with no stale flag.

Coverage check (contract-ID match between partner asset lists and `core-registry.json` assets):

```
$ jq -r '.hubMarkets[] | "\(.symbol)\t\(.token)"' scratchpad/xoxno/api/int_default.json | sort -u   # XOXNO, 25 markets
$ jq -r '.assets[] | "\(.symbol)\t\(.contract_address)"' apps/indexer/src/scripts/bootstrap/registries/core-registry.json
```

| Venue | Assets | Already priced (contract match) | Gaps |
|---|---|---|---|
| Alula (3 pools) | XLM `CAS3J7GY…XOWMA`, USDC `CCW67TSZ…JMI75`, PYUSD `CCCRWH6Q…PHGU2` | **3/3** (native, USDC, PYUSD) | none |
| XOXNO (25 hub markets) | see table | **10/25**: XLM, USDC, EURC, SolvBTC, xSolvBTC, PYUSD, USTRY, CETES, USDY, AQUA | **USDT0** `CBSJZEIO…26YF` (7 dec), **XAUM** `CC2RBGYN…VAGO` (9 dec), **USST** `CBZ4DCE7…N2PJ` (18 dec), **deJAAA** `CC64WBDG…YGSL` (18), **deJTRSY** `CBI7UCH5…IHRV` (18), and 10 Aquarius LP tokens (AQUA-USDC-LP, XLM-USDC-LP, USDY-USDC-LP, PYUSD-USDC-LP, XLM-AQUA-LP, CETES-USDC-LP, USDC-XAUM-LP, USTRY-USDC-LP, XLM-SolvBTC-LP, xSolvBTC-SolvBTC-LP) |

Value at stake in the XOXNO gaps (from the same `/integrations` payload, `tvlSuppliedUsd`): USDT0
$39.3, XAUM $26.5, USST $2.5, deJAAA $1.9, deJTRSY $0.2, LPs ≈ $438 (AQUA-USDC-LP $412) → **≈ $510 of
$74.7k unpriced (0.7%)** if we rely only on our rules. Both partners ship a USD price per market
(XOXNO `usdPrice` from its aggregator; Alula `oracle_price_usd` from its SEP-40 oracle), so a
`partner-oracle` price source tagged in `asset_prices.source` is the pragmatic fallback (see plan).
Note the symbol-keyed stable fallback would price any partner asset literally named `USDC` at 1 by
name alone; contract IDs must be verified (they match today).

DB access + env (for the adapter author): indexer v1 path uses a raw `pg` `Client`
(`scripts/shared/db.ts:11-15`, `DATABASE_URL`); RPC URL via `lib/rpc-config.ts:26-34`
(`STELLAR_RPC_URL` → `SOROBAN_RPC_URL` → public), Horizon `HORIZON_URL`; partner env pattern
`run-defindex-refresh.ts:29-34` (`DEFINDEX_API_KEY`, `DEFINDEX_API_URL`). Neither Alula nor XOXNO
requires a key today.

### C. Positions and health

#### C1. Schema, write path, read path

`apps/api/src/db/stellar_v2_multiwallet.sql:69-102` `wallet_protocol_positions`
(`user_wallet_id, venue_id, entity_id, position_type varchar(64), asset_id, asset_contract_id,
asset_symbol, amount_raw, amount_scaled, amount_usd, snapshot_at, metadata`) — append-only, **no unique
key, no CHECK**; writer uses `'supply'` / `'borrow'`. `:133-155` `wallet_pool_health`
(`user_wallet_id, venue_id -- blend venue, entity_id -- the specific pool, health_factor numeric
(NULL = no debt), total_collateral_usd, total_debt_usd, borrow_limit_usd, net_apy, positions_count,
snapshot_at, metadata`) — no unique key; design note `:124-131`: a value the evaluator reads must be a
column, not jsonb.

Writer `apps/indexer/src/scripts/wallets/81-stellar-wallet-blend-positions.ts` (header `:12-13`
"Scope: Blend only"): wallets `:57-68` (`user_wallets where chain='stellar' and is_active`), Blend
venue `:72`, pools `:76-85` (`v.slug='blend' and e.entity_type='lending_pool'`), per wallet × pool
`:101-114` `fetchBlendUserPositions` → skip if `!hasPosition` (`:112` — exited positions simply stop
appearing) → `resolveBlendUserHealth`; per-asset rows `:117-194` (raw + scaled + USD, metadata
`{source:'blend-sdk', poolId, poolSlug, collateralEnabled, collateral, supply, priceUsd}`); one health
row per (wallet, pool) `:197-226`; one `snapshotAt` per run `:96`; per-pool try/catch `:228-234`.
Adapter: `lib/protocols/blend/fetch-user-positions.ts:55-57` (`PoolV2.load`, `loadOracle`,
`loadUser`), `resolve-user-health.ts:33-45`. Orchestration: `82-run-wallet-alert-job.ts:62-66` spawns
81 then `:76` `pnpm run job:alerts` (api 83); cron every 15 min (`docs/runbooks.md:149`). The API also
spawns 81 for one wallet on `POST /v1/wallets/:id/refresh` (`wallets.service.ts:537-543`).

Read side `apps/api/src/modules/wallets/wallets.service.ts`: latest-snapshot-per-**wallet** rule
(`:72-75`, `with latest as (select max(snapshot_at) … where user_wallet_id = $1)`) in
`getWalletPositions` `:1100-1234` (health `:1108-1131` with `v.slug as venue_slug`, grouping
`keyOf(entityId, venueId)` `:1179-1183`) and `getWalletsOverview` `:906-1018` (legs bucketed by
`(walletId, entityId)` `:977-985`; `poolHealth[]` rows `:995-1006` carry **no venue slug**). The API
wallets service has no `'blend'` literal; the venue comes from `venues.slug`. Web: `usePools.ts:9`
(unused legacy) and `usePoolDetail.ts:38` default to Blend; labels say "Blend" in `PortfolioView.vue:334,339,556`
and `YourPositionsPanel.vue:124`.

#### C2. Multiple obligations per address / PositionNFT accounts

Nothing enforces the grain in DDL, but every reader assumes **one health row per `(wallet, entity_id)`**:

| Reader | Assumption | Evidence |
|---|---|---|
| `getWalletPositions` | `poolMap` keyed by `entity_id` → a 2nd obligation row overwrites the 1st | `wallets.service.ts:1179-1183, 1199-1221` |
| `getWalletsOverview` | legs bucketed per `(walletId, entityId)` → legs merged across obligations | `:975-985, 1005` |
| alerts `latestPerKey` | `distinct on (user_wallet_id, entity_id)` → one obligation survives, arbitrary tiebreak | `alerts.repository.ts:320-339` |
| `alert_rule_state` PK | `(rule_id, user_wallet_id, pool_entity_id)` → two obligations share one edge-state row (flapping) | `stellar_v3_alerting.sql:59-68`; `83-evaluate-alerts.ts:49-51` |
| web row keys | `` `${w.id}-${p.poolSlug}` `` → duplicate Vue keys | `PortfolioView.vue:142`, `YourPositionsPanel.vue:55` |
| `PoolDetailView` | tolerates N rows, aggregates `Math.min(hf)` | `:246-256, 265-285` |
| types | no sub-account field | `apps/web/src/types/wallet.ts:32-43, 63-76` |

Partner facts that drive the design (from G):

- **Alula:** positions are `Obligation(ObligationKey { user, seed: Option<BytesN<32>> })` in persistent
  storage. Verified readable by key: `getLedgerEntries(persistent, Vec[Symbol("Obligation"),
  Map{seed: void, user: Address}])` returned the live borrower's obligation (524 B). Verified **not**
  enumerable from an address: no `AllObligations` key, no `UserObligations(addr)` key, no
  `get_all_obligations` / `get_user_obligations` in the deployed spec (49 functions parsed from the
  on-chain WASM); only 2 obligation keys observed in 24 h of events, both `seed = None`. Computable
  seeds: `None` and Earn = `keccak256("EV")` (`obligation.rs:1369-1389`; instance key
  `EarnObligationSeed` is unset on mainnet → no Earn obligation exists yet). The **Multiply seed
  derivation is client-side and not public** (see open questions). So for L2, Alula positions =
  probe `(wallet, None)` + `(wallet, EarnSeed)` per tracked wallet by direct storage read (2 keys per
  wallet, batched), and document Multiply as unsupported until the formula is known.
- **XOXNO:** account = PositionNFT token id (`token_id == account_id`). Verified on-chain resolution
  without any API: NFT `balance(owner) -> u32` then `get_owner_token_id(owner, index) -> u32`
  (OpenZeppelin `NonFungibleEnumerable`, `contracts/position-nft/src/contract.rs:12-15, 174`); e.g.
  `balance(GB6UDJ…) = 3 → ids 1, 30, 53`. Per-account views on the controller: `get_health_factor(id)
  -> i128 WAD` (`i128::MAX` if no debt), `get_total_collateral_usd`, `get_total_borrow_usd`,
  `get_ltv_collateral_usd`, `get_liquidation_collateral`, `get_account_positions(id)`,
  `get_account_attributes(id) -> {spoke_id, mode}`. REST alternative:
  `GET /stellar-lending/users/{owner}/positions` (indexed; owner not authoritative after an NFT
  transfer) — **no HF in that DTO**; the `/positions` leaderboard exposes an inverted percentage
  (debt / liquidation-collateral × 100).

**Minimal schema delta (proposal, not implemented)** — `stellar_v6_lending_positions.sql`, additive,
idempotent, same style as `is_active_signer` (`stellar_v2_multiwallet.sql:114-115`):

```sql
alter table wallet_pool_health        add column if not exists position_ref text;   -- NULL = single-obligation venue (Blend)
alter table wallet_pool_health        add column if not exists liquidation_health_factor numeric; -- Alula LHF; = health_factor elsewhere
alter table wallet_protocol_positions add column if not exists position_ref text;
create index if not exists wallet_pool_health_wallet_entity_ref_snap_idx
  on wallet_pool_health (user_wallet_id, entity_id, coalesce(position_ref,''), snapshot_at desc);
alter table alert_rule_state add column if not exists position_ref text not null default '';
-- + drop/recreate PK as (rule_id, user_wallet_id, pool_entity_id, position_ref)
```

Semantics: Alula → `position_ref = 'standard' | 'earn' | <seed hex>`; XOXNO → `position_ref =
<account_id>` (metadata carries `spoke_id`, `mode`); Blend → NULL. Read-side changes (~8): `latestPerKey`
distinct-on gains `coalesce(position_ref,'')` (`alerts.repository.ts:323-337`), `stateKey`
(`83:49-51`), `upsertRuleState` (`alerts.repository.ts:544`), `keyOf` / `legKeyOf`
(`wallets.service.ts:977-978, 1179-1180`), DTOs gain `positionRef` + `venueSlug`
(`wallets.service.ts:1161-1174`, `types/wallet.ts`), web row keys, notification payload (`83:166-178`).
`alert_rules` needs no change for a first cut (a wallet/pool rule matches every obligation of that
wallet/pool). Indexer: 81 becomes a per-venue dispatch over `venue_type='lending'` (Blend → existing
adapter; alula / xoxno → new `fetch-user-positions` + `resolve-user-health` under
`lib/protocols/<venue>/`).

#### C3. HF semantics (formulas with sources)

| Venue | Stored / displayed factor | Formula | Source |
|---|---|---|---|
| **Blend** | `health_factor = totalEffectiveCollateral / totalEffectiveLiabilities`, NULL when no debt | effective collateral = Σ collateral × `c_factor`; effective liabilities = Σ liabilities × (1 / `l_factor`) — i.e. collateral weighted **down** by collateral factor, debt weighted **up** by liability factor; liquidatable when < 1.0 | `apps/indexer/src/lib/protocols/blend/resolve-user-health.ts:39-45` (`PositionsEstimate.build`); blend-sdk 3.2.2 `dist/esm/pool/user_positions_est.js:65-66` (`toEffectiveAssetFromDTokenFloat` / `toEffectiveAssetFromBTokenFloat`), `pool/reserve.js:104-106` (`getLiabilityFactor = 1 / l_factor`), `:116-118` (`getCollateralFactor = c_factor`) |
| **Alula** | two numbers: `HF = Vc / Vb` (unweighted, "reciprocal of LTV") and **`LHF = Σ Vc_i × cLTV_i / Σ Vb_j × LF_j`**; liquidatable when **LHF < 1** | collateral value per pool = (tokens from jTokens, floor, + plain collateral) × price, weighted by `close_ltv_bps`; debt = tokens from dTokens (ceil) × price, weighted by `liability_factor_bps` (∈ [100%, 200%]; all live pools 10000 = 1.0). Live params: USDC open/close LTV 8000/8500, XLM 7000/7500, PYUSD 7500/8500 bps; `min_collateral_value_cents = 500` | https://docs.alula.finance/tech-docs/risk-management/health-factor (verbatim in G-Alula §5); `obligation.rs` L228-500 (GitHub main); `get_market_data` simulation 2026-09-28 11:57:31 UTC |
| **XOXNO** | `get_health_factor(account) -> WAD`; `i128::MAX` if no debt; `is_liquidatable = HF < 1e18` | `HF = Σ (floor position value × stamped liquidation_threshold) / Σ ceil debt value`; weights are the position's **stamped** LT (`entryLiquidationThresholdBps`), not the current listing; no e-mode; isolation is per spoke (permanent per account). Verified: account 1 HF = 1.2102, leaderboard `82.64%` = 100 / 1.2102 | `contracts/controller/src/risk/totals.rs:157-215`, `common/src/rates/value.rs:15-39`, `docs/reference/formulas.md:175-201`, `skills/xoxno-lending/math.md:264-284`; simulations 2026-09-28 11:59:54 UTC |

Frontend today: `apps/web/src/utils/health.ts:5-11` — green ≥ 1.5, amber ≥ 1.2, red below, null →
"No borrow" (duplicated in `PoolDetailView.vue:287-292`). `HealthFactorGauge.vue` props `:17-23`
(`healthFactor: number | null`, `dense`), scale clamped 1.0–2.0 (`:25-26`), gradient anchored at
1.2 / 1.5 (`:45-46`), tooltip "liquidation at 1.00" (`:48-53`).

**Verdict:** the three *liquidation-relative* factors (Blend HF, Alula **LHF**, XOXNO HF) share the same
contract — "1.0 = liquidatable, weights = liquidation thresholds" — so the gauge and thresholds are
reusable **as long as** the value written to `wallet_pool_health.health_factor` is that factor for all
venues. Alula's unweighted `HF` must not be the gauge input (it reads ~1.18× higher at 85% cLTV). The
bands 1.2 / 1.5 are display conventions, not protocol constants; they remain defensible for all three.
Differences to state in copy, not in the widget: Blend and Alula weight debt up by a liability factor
(Alula's are 1.0 today); XOXNO uses stamped-at-entry thresholds; Alula liquidations are further gated
by an insolvency LTV band (98.5%).

### D. Alerting

`alert_rules.metric` CHECK (`stellar_v3_alerting.sql:105-107`): `health_factor | price | tvl_drop_pct |
supply_apy | borrow_apy`; dispatch `families.ts:26-45`; pure state machine `evaluate.ts:73-149` (null →
ok `:108-114`). Subject columns: `user_wallet_id`, `pool_entity_id` (plain uuid, NULL = all),
`asset_id`.

| Family | Reads | Protocol coupling | Extending to a new lending venue |
|---|---|---|---|
| Health factor | `wallet_pool_health` latest per `(wallet, entity)` (`alerts.repository.ts:320-339`) | none — any venue writing health rows is evaluated; labels derived from `entities ⋈ venues` (`83:614-642`) | **New venue/entity rows + writer only** for one obligation per (wallet, pool); for Alula seeds / XOXNO accounts the C2 schema + key changes. Web always creates HF rules with `poolEntityId: null` (`useAlerts.ts:511-525`). |
| Asset price | `asset_prices` latest per asset (`:650-663`); picker `listPricedAssets` `:677-688` | none | nothing for the venue; new collateral assets need `asset_prices` rows (B3) |
| Pool TVL drop | `reserve_snapshots` latest batch vs 12–36 h earlier (`getPoolTvlWindows` `:764-828`; `venue_type='lending'` → `b_supply_scaled`); picker `listTvlPools` `:846-873` (entities with snapshots in 7 d) | by `venue_type`, not slug | **indexer must write `reserve_snapshots` batches**; no evaluator/schema change; stale guard > 24 h (`83:339-344`) |
| Supply / borrow APY | `pool_metrics_latest.weighted_*_apy` (`getPoolApys` `:880-904`); picker `listApyPools` `:911-925` (`venue_type='lending'`, `as_of` < 7 d) | by `venue_type` | **indexer must write `pool_metrics_latest`** with weighted APYs; nothing else |
| Auto pool-status (system) | live `PoolV2.load(...).metadata.status` (`83:585-589`) over `MAINNET_BLEND_POOLS` (`modules/actions/network-registry.ts:129-152`); `pool_status_state` (generic, entity_id PK) | **hard-coded Blend** (`83:568-616`, labels `families.ts:252-269`) | evaluator change: per-venue status reader (Alula `GlobalState.status` / pool `status` flags; XOXNO `Paused`, spoke `is_deprecated`, asset `paused/frozen` flags) — **defer**; not needed for L1/L2 |

Web rule creation: `AlertRuleModal.vue:41-45` scopes/metrics; pools picker = `fetchTvlPools` merged
with `fetchApyPools` flags (`useAlerts.ts:239-266`) → a new lending venue appears in the picker as
soon as it has `reserve_snapshots` and `pool_metrics_latest`. The hard-coded protocol list
`AlertRuleModal.vue:89-96` (blend, aquarius, soroswap, stellar-native) has no creatable metric.
`docs/alerting/probe-01-read-model.md:234` documents the "(wallet, pool) ≈ (wallet, venue, pool)"
assumption that C2 breaks; `docs/lot-n-alerting.md:99` lists non-Blend position alerts as deferred.

### E. API surface

#### E1. Routes and Blend-specificity

| Route | Code | Tables | Generic / Blend-specific |
|---|---|---|---|
| `GET /v1/protocols` | `stellar.controller.ts:9-12` → `getProtocols` `stellar.service.ts:216-322` | `venues ⟕ protocol_metrics_latest`; top-assets CTE `:239-285` | generic by venue; **top-assets sums `d_supply_scaled`** (`:250`, borrowed side for lending) |
| `GET /v1/pools?protocol&sort&order` | `:14-21` → `getPools` `:324-492` | `entities ⋈ venues ⟕ pool_metrics_latest`, swaps from `normalized_events`, tokens from `entity_assets` | generic; only `isAmm` branch `:454`; sort whitelist `:338-346` incl. `supplyApy/borrowApy` |
| `GET /v1/pools/:slug` | `:23-26` → `getPoolDetail` `:494-702` | latest `reserve_snapshots` + latest `asset_prices` (`:534-568`) | AMM branch `:599-650`; **everything else** (lending and vault) → lending shape `:652-696`, `protocol.type: 'lending'` hard-coded `:675` |
| `GET /v1/pools/:slug/flows` | `:32-38` → `:725-880` | `normalized_events` | generic; Blend state-only → `covered=false` (`:719-724`) |
| `GET /v1/pools/:slug/series` | `:42-45` → `:893-965` | `reserve_snapshots` × price | **lending-only gate** `:909-911`; sums `d_supply_scaled` (`:930`) |
| `GET /v1/wallets/overview`, `/:id/positions`, `/:id/balances`, `POST /:id/refresh` | `wallets.controller.ts:75-112` | v2 tables | schema-generic; `overview.poolHealth[]` lacks `venueSlug` (`wallets.service.ts:995-1006`); refresh spawns the Blend-only 81 |
| `GET /v1/network/stats`, `/tvl-series` | `network.controller.ts:9-18` → `network.service.ts:87-140, 146-218` | `network_stats_latest`, `network_tvl_snapshots` | generic. **Note:** `/v1/network/stats` reads a persisted row; the CLAUDE.md sentence "hits external APIs live" is outdated (step 73 writes it) |
| `GET /v1/ops/metrics`, `/status`, `/adoption`; `GET /health` | `ops.controller.ts:21-46`; `app.controller.ts:27-66` | `rpc_metrics_runs`, `refresh_step_runs`, `protocol_metrics_latest` | generic; step/target labels in `ops/status.ts:80-96` |

Units: APYs are **ratios** everywhere (`fetch-pool-state.ts:227`, `persist-vault-metrics.ts:22-23`);
web multiplies by 100 (`ProtocolsView.vue:59-62`, `PoolDetailView.vue:49-52`). **Utilization is not
persisted**; the web derives `borrowed / supplied` in two places (`ProtocolsView.vue:186-191`,
`PoolDetailView.vue:226-236`). Live sample (public API, 2026-09-28 11:56 UTC):

```
$ curl -s https://stellar-api.getdig.ai/v1/pools/blend-etherfuse-pool | jq -c '.reserves[0]'
{"assetId":"5e0f35b5-…","symbol":"CETES","decimals":7,"priceUsd":0.069,"supplied":108658.4993805,"borrowed":23.389052,
 "backstopCredit":6.0605108,"supplyCap":160000000,"supplyApr":1e-7,"supplyApy":1.0000001e-7,"borrowApr":0.0010009,"borrowApy":0.0010014}
$ curl -s https://stellar-api.getdig.ai/v1/pools | jq -r 'group_by(.protocol.id) | .[] | "\(.[0].protocol.id) type=\(.[0].protocol.type) n=\(length)"'
aquarius type=amm n=21 · blend type=lending n=4 · defindex type=vault n=3 · soroswap type=amm n=4 · stellar-native type=amm n=9
```

There is **no per-asset cross-venue endpoint**; per-asset rates exist only inside
`/v1/pools/:slug.reserves` (one call per pool) or directly in `reserve_snapshots`.

#### E2. Canonical network TVL

Decision `docs/decisions/2026-08-17-network-tvl-definition.md:10-17`. Code (verified):
`70-protocol-persist-metrics.ts:128-162` sums `pool_metrics_latest.tvl_usd` (net = minus
`total_borrowed_usd`) over `e.is_active = true and v.slug <> 'defindex'` (`:142`), preceded by the
hard-coded `persistProtocol()` list `:169-173`. **Deny-list, not allow-list**: any venue whose entities
land in `pool_metrics_latest` is included and bumps `protocol_count`. The only "methodology change"
marker is the `tvl_net_usd` NULL → non-NULL step (`network.service.ts:183-198`); a second
definitional change would render as an unannotated step.

What XOXNO / Alula change (public reads, 2026-09-28 11:56 UTC):

```
$ curl -s https://stellar-api.getdig.ai/v1/network/tvl-series | jq -c '.points[-1]'
{"t":"2026-09-28T11:00:00.000Z","tvlUsd":254365901.26,"tvlNetUsd":219022264.92,"protocolCount":4}
XOXNO supplied (tvlSuppliedUsd, /integrations/lending/stellar 11:57:57Z) = 74,709.28 ; borrowed 1,006.31
Alula  supplied+collateral (tvl_usd_cents 11:55:37Z)                    = 11,801.82 ; borrowed ≈ 176.9 (XLM 7.465 × 0.213 + USDC 16.96)
```

Gross impact ≈ **+$86.5k on $254.4M (+0.034%)**, `protocolCount` 4 → 6. Double-count check: XOXNO
custody is its own Pool contract (`get_reserves` = booked cash, matched DefiLlama exactly); Alula
custody is the Market contract. Neither routes deposits into Blend, so the DeFindex-style exclusion
does **not** apply. XOXNO's repo contains a `defindex-strategy` contract (vaults depositing *into*
XOXNO) — DeFindex is already excluded, so no new double count either. Recommendation: include both,
gross supplied, and amend the decision doc (no code for the sum itself).

#### E3. Response shapes

`/v1/pools` item (`stellar.service.ts:465-491`, `types/protocol.ts:61-74`): `{ id: entity_slug, name,
type: entity_type, protocol: { id, name, type: venue_type, logoUrl }, chain, contractAddress,
tokens[{assetId, symbol, logoUrl, role}], metrics: { tvlUsd, volume24hUsd, fees24hUsd,
totalSuppliedUsd, totalBorrowedUsd, supplyApy, borrowApy (ratio), swaps24h }, updatedAt, stale,
isStale, staleAfterSeconds, ageSeconds }`. Detail lending branch adds `metrics.totalBackstopCreditUsd,
netLiquidityUsd, events24h` + `reserves[]` (fields as sampled above). `/v1/protocols` item
(`:305-321`): `{ id, name, type, chain, logoUrl, tvlUsd, volume24hUsd, fees24hUsd, avgSupplyApy,
avgBorrowApy, topAssets[≤3], assetCount, updatedAt, freshness… }`.

### F. Web reuse inventory (design rule: derive, no new pattern)

- **Routing:** no vue-router. `composables/useView.ts:14-23` `AppView = 'dashboard' | 'protocols' | 'pool'
  | 'portfolio' | 'alerts' | 'status'`, hash sync `:29-52`; `App.vue:45-50` switch; nav
  `components/shell/AppSidebar.vue:38-48`. A new view = one union member, one `v-else-if`, one nav item.
- **Data:** `api/client.ts:29-52` `apiFetch`; `api/pools.ts:11-36`; `composables/useProtocol.ts:56-339`
  (live pools store, dust filter `MIN_POOL_TVL_USD=100` `:10`, `staleProtocolIds` `:122-128`);
  `useSharedWallets.ts:14-29` singleton over `useWallets.ts:62-108` (overview + per-wallet
  balances/positions); `usePools.ts` is unused legacy.
- **All-pools table** `components/views/ProtocolsView.vue`: `poolKind` `:69-74`; `pctRatio` `:59-62`;
  sort keys `:161`, `toggleSort` `:178-184`, `metricVal` `:206-218` returns null for N/A → sorts last
  `:239-242`; `util()` `:186-191`; row model `:223-270`; **adaptive columns** `:284-336` — the lending
  tab is already `TVL · Supply APY · Borrow APY · Utilization` (`:310-316`), narrow variants
  `:285-308`, "All" tab uses a per-row Key metric `:330-334`; markup `:416-488` (card
  `rounded-[18px]` on `--dig-surface`/`--dig-line`, `dig-chip` filter bar `:418-436`, header
  `text-[11px] uppercase tracking-[0.04em]` `:442-449`, `dig-row` rows with `PairLogo`/`BrandLogo`
  `:458-464`, Stale badge `:468`, `tabular-nums` value cells `:481-482`).
- **Pool detail** `PoolDetailView.vue`: type branches `:44-47`; stat strip per kind `:90-125`;
  utilization risk row with 80/90 thresholds `:226-236`; "Your position" from shared wallets
  `:243-285`; **Reserves & rates table** `:741-782` (Asset with `BrandLogo variant="asset"` 22 px ·
  Price · Supplied · Borrowed · Backstop · Supply cap · Supply APY green · Borrow APY red) — the
  closest existing per-asset lending row.
- **Shared components:** `BrandLogo.vue` props `:14-28` (`primary`, `fallback`, `letter`, `tint`,
  `size`, `radius`, `variant: 'tile' | 'asset'`), fallback chain `:41-46`; `PairLogo.vue` `:24-38`;
  `FreshnessChip.vue` props `:11-15` (`updatedAt`, `isStale`, `staleAfterSeconds`), click → `#status`;
  `PositionAssetChips.vue` `:26-33` (groups legs by `side`, supplied/borrowed/other);
  `HealthFactorGauge.vue` `:17-23`; `YourPositionsPanel.vue` (top-3 by supplied `:42-66`, gauge dense
  `:128`, sub-label hard-coded "Blend, {{wallet}}" `:124`).
- **Formatters** `utils/format.ts`: `formatUsd` `:18-30`, `formatPrice` `:33-36`, `formatPct` `:40-44`
  (change arrows, **not** for APY), `formatTokenAmountCompact` `:64-84`, `displaySymbol` `:106-108`
  (`native → XLM`). **No shared ratio→percent formatter** (inline copies: `ProtocolsView.vue:59-62`,
  `PoolDetailView.vue:49-52`, `GetStartedCard.vue:57`, `StatusView.vue:100`).
- **Tokens** `style.css:31-46`: `--dig-bg #141414`, `--dig-surface #1E1E1E`, `--dig-surface-2 #242422`,
  `--dig-surface-3 #262624`, `--dig-line #2F2F2C`, `--dig-line-soft #2C2C29`, `--dig-text`,
  `--dig-text-2`, `--dig-muted`, `--dig-faint`, `--dig-accent #D5FF2F`, `--dig-green #2E9E63`,
  `--dig-red #E0603E`, `--dig-amber #C98A1E`; hover classes `.dig-row/.dig-chip/.dig-btn` `:83-93`. No
  radius/spacing tokens — conventions are inline (`rounded-[18px]`, `py-[13px]`, `text-[14px]`).
- **Portfolio** `PortfolioView.vue`: `PositionRow` `:123-134` one row per (wallet, pool) `:136-156`;
  panel grid `2fr 1.3fr 1fr 1fr 90px` = Position · Wallet · Supplied · Health · Manage `:561-562`;
  gauge `:569/:587`; chips `:573/:591`; no venue column; "Blend" copy `:334, :339, :556`.

**Which view to extend:** a new `LendingRatesView` that reuses the `ProtocolsView` table markup and
its lending column set, with rows at the `(asset × venue)` grain grouped by asset (asset header =
`BrandLogo variant="asset"` + `displaySymbol`, exactly the Reserves & rates first cell; venue rows =
`BrandLogo` tile + name as in the "All" tab's Protocol column). Filter chips per venue reuse `:420-434`;
`FreshnessChip` per venue; `Stale` badge per row. `ProtocolsView` itself should not be pivoted (it is
one-row-per-pool by design).

**Genuinely missing (code, not visuals):** (1) an API read at the `(asset × venue)` grain (E3);
(2) a shared ratio→percent formatter; (3) venue theme + SVG + `venues.logo_url` seed for two venues;
(4) `venueSlug` on `overview.poolHealth[]` and a venue sub-label on position rows (replacing the
"Blend" copy); (5) a sub-account label (`positionRef`) on position rows; (6) nothing in the gauge.

### G. Partner probes (read-only)

#### G1. Alula REST (`https://api.alula.finance`, OpenAPI 3.1.0 "Alula Public API" v0.4.0)

```
$ curl -s -D - https://api.alula.finance/alula-openapi.json   # 11:55:04Z, 16107 B, 8 paths, all GET
/v1/protocol/summary · /v1/system/status (no-store) · /v1/markets · /v1/markets/{market}
/v1/assets (cursor, limit) · /v1/assets/{market}/{pool} · /v1/assets/{market}/{pool}/history (bucket 5m…1w) · /v1/tokens/{address}
$ curl -s https://api.alula.finance/v1/system/status          # 11:55:27Z
{"last_scrape_at":"2026-09-28T11:55:24.476935Z","last_scrape_ledger":64662148,"markets_total":1}
$ curl -s https://api.alula.finance/v1/protocol/summary        # 11:55:28Z  cache-control: public, max-age=15  etag: W/"p:64662148:2faa24c4ec563c3c"
{"observed_ledger":64662148,"market_count":1,"pool_count":3,"tvl_usd_cents":"1180182"}
$ curl -s https://api.alula.finance/v1/markets/CBP76I2FRMUKYKIYYBKN3DH7TSWMFAJF2WTDC7Q2OHQFBIVWP7CAAI5Q   # 11:55:37Z
{"observed_ledger":64662148,"pool_count":3,"truncated":false,"tvl_usd_cents":"1180182","config_hash":"2faa24c4ec563c3c","pools":[
 {"pool":"CAS3J7GY…OWMA","symbol":"native","decimals":7,"total_supplied":"502784422829","total_borrowed":"74651000","supply_apy_bps":0,"borrow_apy_bps":202,"utilization_bps":1,"tvl_usd_cents":"1071105","oracle_price_usd":"0.21295003525505"},
 {"pool":"CCCRWH6Q…PHGU2","symbol":"PYUSD","decimals":7,"total_supplied":"409090911","total_borrowed":"0","supply_apy_bps":0,"borrow_apy_bps":100,"utilization_bps":0,"tvl_usd_cents":"4090","oracle_price_usd":"0.99989951210105"},
 {"pool":"CCW67TSZ…JMI75","symbol":"USDC","decimals":7,"total_supplied":"10498217501","total_borrowed":"169633309","supply_apy_bps":0,"borrow_apy_bps":114,"utilization_bps":161,"tvl_usd_cents":"104987","oracle_price_usd":"1.00005254501350"}]}
$ curl -s "https://api.alula.finance/v1/assets/<market>/<USDC>/history?bucket=5m&start_date=<now-15m>"   # 4 buckets; stocks averaged, rates median per bucket
{"start_time":"2026-09-28T11:55:00Z","end_time":"2026-09-28T12:00:00Z","total_supplied":"10498217501","total_borrowed":"169633309","supply_apy_bps":0,"borrow_apy_bps":114,"utilization_bps":161,"tvl_usd_cents":"104987","oracle_price_usd":"1.00005254501350"}
$ curl -s https://api.alula.finance/v1/tokens/<USDC>  → {"address":"CCW67TSZ…","symbol":"USDC","decimals":7,"first_seen_ledger":63419107}
```

Shapes: amounts are decimal strings in token base units (7 dec); rates in bps; `tvl_usd_cents`
string; `oracle_price_usd` decimal string (14-decimal oracle). Freshness: `observed_ledger` in every
body + custom `alula-ledger` response header + weak ETag embedding ledger and config hash; scraper lags
chain by ~10–20 ledgers. Errors are `application/problem+json`. **No rate-limit headers; 30
back-to-back GETs all 200.** **No positions / obligations / user route** (`/v1/obligations`,
`/v1/positions`, `/v1/users/{addr}/obligations` → 404). `pool == token_address`; XLM symbol is
literally `native` (matches our convention).

#### G2. Alula on-chain (`CBP76I2FRMUKYKIYYBKN3DH7TSWMFAJF2WTDC7Q2OHQFBIVWP7CAAI5Q`)

Spec via `Server.getContractWasmByContractId` + `contract.Spec.fromWasm` (WASM 111,326 B, hash
`76e60d02…78b6`, 49 functions). Read views present: `get_global_state`, `get_all_pools`, `get_pool`,
`get_pool_data`, `get_market_data`, `get_user_obligation(ObligationKey)`, `get_oracle_price_decimals`
(= 14), `get_pool_asset_oracle_price`, `simulate_withdraw`. **Absent:** `get_all_obligations`,
`get_user_obligations`, `get_obligations_by_user`. Storage enum `DataKey` has `AllPools`,
`Pool(Address)`, `CachedPrice(Address)` (temporary), `Obligation(ObligationKey)`,
`EarnObligationSeed`, … — **no `AllObligations`, no per-user key**.

Simulations (`simulateTransaction`, dummy source, never submitted; 11:57:30–34Z, ledger 64662173):
**every call succeeded, none hit a resource limit** (3 pools; `get_market_data` footprint 24 entries,
`minResourceFee` 211,392 stroops).

```
get_global_state -> {"name":"main","status":6 (FrozenByAdmin),"max_positions":10,"min_collateral_value_cents":"500","insolvency_ltv_bps":"9850","bad_debt_lock_d":"43200","oracle":"CBZDQPVY…7VWW", …}
get_all_pools    -> [USDC CCW67TSZ…, native CAS3J7GY…, PYUSD CCCRWH6Q…]
get_market_data  -> pools_data[3] (table below)
get_user_obligation({user:<random G>, seed:None})   -> Error(Contract, #200) ObligationDoesNotExist
get_user_obligation({user:GDGRMW55…JXQI, seed:None}) -> {"borrows":{"<native>":{"d_tokens":"74430065","originally_borrowed":"74624423"}},"deposits":{},"positions_count":1}   # 12:01:51Z
```

| pool | total_available | total_borrowed | total_collateral | PoolData.total_supply | apr b/s bps | apy b/s bps | oracle price (÷1e14) | open/close LTV bps | liability factor | max liq incentive |
|---|---|---|---|---|---|---|---|---|---|---|
| USDC | 10329040268 | 169633309 | 0 | 10498217501 | 101 / 0 | 114 / 0 | 0.99993603 | 8000 / 8500 | 10000 | 500 |
| native | 502709801737 | 74651000 | 200000000 | 502784422829 | 200 / 0 | 202 / 0 | 0.21269208 | 7000 / 7500 | 10000 | 1000 |
| PYUSD | 409090911 | 0 | 0 | 409090911 | 100 / 0 | 100 / 0 | 1.00089067 | 7500 / 8500 | 10000 | 500 |

Storage reads (`getLedgerEntries`, 11:58:47Z): instance (12 keys incl. `MarketStatus=FrozenByAdmin`,
`EarnObligationSeed` **unset**); `AllPools` persistent → 3 addresses; `AllObligations` → **0 entries**;
`Pool(USDC)` → full struct (2,732 B); `Obligation({None, GDGRMW55…})` → 1 entry (524 B, liveUntil
67244612); `UserObligations(addr)` (guess) → 0. Events last 24 h: 9 (`update_market_status
{FrozenByAdmin}` at ledger 64654225 / 00:55:06Z; `pool_bad_debt_locked(native)`;
`issue_cover_bad_debt(GDGRMW55…)`; 2 deposits + 2 withdrawals by one user). `getEvents` over a 7-day
window returned 0 on both RPCs tested although 1-day events exist → event history is not a reliable
enumeration path either.

**Assessment of "read AllPools / AllObligations directly in production" (docs):** reading `AllPools`
and `Pool(addr)` by key works and is cheap (1 `getLedgerEntries` for all keys). The `AllObligations`
half of the recommendation **does not match the deployed contract**; per-address probing of the two
computable seeds by key is the only viable L2 path today (2 keys per wallet, batched up to 200 keys per
request).

#### G3. Alula REST vs on-chain cross-check

REST `/v1/markets/{market}` at 11:55:37Z (ledger 64662148) vs `get_market_data` at 11:57:31Z (ledger
64662173, ~25 ledgers later). Verified unit derivations (`pool.rs`): `total_supply = total_available −
take_rate_fees_sum + total_borrowed` (USDC: 10329040268 + 169633309 − 456076 = 10498217501 ✓ all
pools); `utilization_bps = ceil(borrowed / supply × 1e4)`.

| pool | supplied REST = chain | borrowed = | util REST/chain | APY REST/chain | price REST / chain | REST tvl cents | (supply + collateral) × REST price | × chain price |
|---|---|---|---|---|---|---|---|---|
| native | 502784422829 ✓ | 74651000 ✓ | 1 / 1 | 0,202 / 0,202 | 0.21295004 / 0.21269208 (−0.121%) | 1071105 | 1071105.51 | 1069808.03 |
| PYUSD | 409090911 ✓ | 0 ✓ | 0 / 0 | 0,100 / 0,100 | 0.99989951 / 1.00089067 (+0.099%) | 4090 | 4090.50 | 4094.55 |
| USDC | 10498217501 ✓ | 169633309 ✓ | 161 / 161 | 0,114 / 0,114 | 1.00005255 / 0.99993603 (−0.012%) | 104987 | 104987.69 | 104975.46 |
| **total** | | | | | | **1180182** | **1180183.70** | **1178878.04 (−0.110%)** |

Findings: stocks and rates match on-chain exactly; **`tvl_usd_cents = floor((total_supply +
total_collateral) × oracle price × 100)`** — plain collateral is included (undocumented); the residual
delta is oracle drift between ledgers. Supply APY is 0 bps everywhere because utilization ≤ 1.6%
(`supply_apr = borrow_apr × U × (1 − take_rate)` floors to 0). Implied jToken rates are ~0.10 on
USDC/PYUSD (share scaling), so value-per-share must always be read, never assumed to be 1.

#### G4. XOXNO Lending: addresses, endpoints, API

Repo `XOXNO/rs-lending-xlm` (`git clone --depth 1`, 11:55:15Z). `configs/networks.json` /
`skills/xoxno-lending/addresses.md`:

| Role | Mainnet |
|---|---|
| Controller (only user-facing entrypoint) | `CAUCMIN5KSXEVZ7NMXR3LZATGD5EFIEUI5XWTFLYRO2R5OTXI22WE5JX` (wasm `52ed959d…fd9b`, **matches live instance**) |
| Pool (hub custody + accounting) | `CBXRNDQMAJFG4VUKMKFEMFS75UUXE2SPSNV4LEEFCSNBCN66PYRWBKXO` |
| Position NFT (`token_id == account_id`) | `CAWCSG77AY2W24QZ6ZXLHZU4UXEFHZBM6EI4A4IF7JB5CTY4XND3TI6C` |
| Price aggregator / XOXNO oracle adapter | `CBGUF2G2…NSMV` / `CDA3XS2H…22JM` (Reflector CEX/DEX/FX + RedStone feeds) |
| Governance (owner) | `CC44PEQW…C2AD` |

Hubs: 1 Core, 2 RWA, 3 AMM; 8 spokes; 25 hub markets / 57 spoke×hub×asset reserves. **No market
enumeration view on the controller** (`LastHubId` / `LastSpokeId` readable from instance storage;
markets from `configs/mainnet/markets.json`, the REST API, or events).

Controller views (74 functions, `interfaces/controller/src/lib.rs:14-199`, byte-for-byte equal to the
on-chain spec): `get_health_factor(u64) -> i128 WAD`, `is_liquidatable`, `get_total_collateral_usd`,
`get_total_borrow_usd`, `get_ltv_collateral_usd`, `get_liquidation_collateral`,
`get_collateral_amount(id, HubAssetKey)`, `get_borrow_amount`, `get_account_positions(id)`,
`get_account_attributes(id)`, `account_exists`, `get_market_index(HubAssetKey)`,
`get_market_indexes_detailed(Vec<HubAssetKey>)` (≤256; indexes + price WAD + `stale/valid` flags),
`get_spoke`, `get_spoke_asset` (ltv/lt/bonus/fees bps, caps, flags), `get_pool_address`. Pool views
(25): `get_reserves(HubAssetKey)`, `get_supplied_amount`, `get_borrowed_amount`, `get_utilisation`
(RAY), `get_deposit_rate` / `get_borrow_rate` (APR RAY), `get_sync_data` (full IRM params + state),
`get_bulk_indexes`.

REST: `GET https://api.xoxno.com/swagger.json` → 200, OpenAPI 3.0.0, 326 paths, **44 under
`/stellar-lending`, all GET, `security: []`**. Live (11:57–12:00Z, all 200, no auth, **no rate-limit
headers**, Cloudflare `Cache-Control: public, s-maxage=30` lists / 10 live-state / 120 analytics):

```
GET /stellar-lending/hubs -> [{"hubId":1,"name":"Core","tvlUsd":70490.25,"totalDepositsUsd":70490.25,"totalBorrowsUsd":1006.32,"assetCount":7,"spokeCount":8}, {2 RWA 2118.55}, {3 AMM 2100.51}]
GET /stellar-lending/participants -> {"suppliers":30,"borrowers":12,"total":30}
GET /stellar-lending/markets/detailed -> 25 × {hubId, asset, supplyIndex(RAY), borrowIndex, usdPrice(WAD), primaryPriceUsd, anchorPriceUsd, priceTimestamp, stale, deviation, valid}
GET /stellar-lending/reserves/1/1/CAS3J7GY… -> {"assetDecimals":7,"supplyApy":1.54e-07,"borrowApy":9.80e-05,"utilization":0.00196,"hubPool":{"suppliedShort":277109.85,"borrowedShort":543.51},"collateralFactorBps":7500,"liquidationThresholdBps":7800,"liquidationPenaltyBps":900,"liquidationFeesBps":1200,"targetHealthFactorWad":"1150000000000000000","irm":{…}}
GET /stellar-lending/accounts/1/positions -> {"positions":[3 rows: accountId, owner, spokeId, hubId, asset, positionMode, supplyScaledRay/borrowScaledRay, supplyAmount/borrowAmount (RAY strings), entryLtvBps 7500, entryLiquidationThresholdBps 7800, updatedAt(ms), ledger 64591650]}   # NO health factor
GET /stellar-lending/users/GB6UDJ…/positions -> same DTO across accounts 1, 30, 53
GET /stellar-lending/positions?orderBy=HealthFactor&top=5 -> {"positions":[{"accountId":"1","supplied":32.1154,"borrowed":21.0496,"healthFactor":82.6379}, …]}   # inverted %, = debt / liq-collateral × 100
GET /integrations/lending/stellar -> {"generatedAt":"2026-09-28T11:57:57.938Z","markets"[25],"hubMarkets"[25],"spokeMarkets"[57],"summary":{"marketCount":25,"tvlUsd":73702.98,"tvlCashUsd":73702.98,"tvlSuppliedUsd":74709.28,"borrowedUsd":1006.31,"participantsCount":30},"methodology":{…}}
   hubMarkets[i] keys: hubId, hubName, symbol, token, decimals, suppliedRaw/Usd, borrowedRaw/Usd, tvlCashRaw/Usd, tvlSuppliedRaw/Usd, supplyApy, borrowApy (fractions), utilizationRate, usdPrice, reserveFactorBps, marketStatus, marketAddress
```

Units: `*Ray`/`*Wad`/caps are decimal strings; `*Short`, `*Usd`, `*Apy`, `utilization` are floats
(fractions). Freshness: `updatedAt` + `ledger` per position row; `priceTimestamp` on
`/markets/detailed`; `generatedAt` on `/integrations`; **no `asOf`/ledger on list routes** (hubs,
spokes, reserves, stats).

On-chain simulations (11:59:54Z, ledger 64662202–204, all succeeded, max 16.8M CPU instr for
`get_market_indexes_detailed` ×3): `get_spoke_asset(1, XLM@1) → ltv 7500, lt 7800, bonus 900, fees
1200, supply_cap 50M XLM`; `get_market_indexes_detailed([XLM]) → price_wad 0.212686, stale:false,
valid:true`; account 1: `get_health_factor → 1210201130737267163 (1.2102)`, `get_total_collateral_usd
→ $32.115`, `get_total_borrow_usd → $21.048`, `get_liquidation_collateral → $25.472`; account 999999
→ `i128::MAX`, `account_exists false`. Pool: `get_reserves(XLM@1) = 2765663399975`,
`get_supplied_amount = 2771098478463`, `get_borrowed_amount = 5435078498`, utilisation 0.196%,
deposit rate 1.54e-7, borrow rate 9.81e-5 APR; USDT0@1 `get_delta_time = 524203000 ms` (≈ 6 days since
last accrual). NFT: `total_supply 30`, `balance(GB6UDJ…) = 3 → get_owner_token_id 0..2 = 1, 30, 53`.

Cross-checks: leaderboard `82.6379` = `21.0478 / 25.4721 × 100` ✓ (= 100 / 1.2102); HF uses ceil
debt (off-by-one check on the WAD) ✓; utilisation = borrowed / supplied ✓.

#### G5. XOXNO TVL vs DefiLlama

Adapter `DefiLlama-Adapters/projects/xoxno-lending/index.js` L9-12: registry from
`https://api.xoxno.com/integrations/lending/stellar` (`hubMarkets`, `User-Agent: dune-analytics`);
L54 `callSoroban(pool, fn, [hubAssetKey])`; **L70-73 `tvl: get_reserves` (booked pool cash), `borrowed:
get_borrowed_amount`**. So Llama TVL = cash only; supplied ≈ tvl + borrowed.

```
$ curl -s https://api.llama.fi/protocols | jq '.[] | select(.slug=="xoxno-lending") | .chainTvls'
{"Elrond":909965.20,"Elrond-borrowed":241504.13,"Stellar":71816.21,"Stellar-borrowed":1005.42}
$ curl -s https://api.llama.fi/protocol/xoxno-lending | jq '.currentChainTvls'   # last point 2026-09-28T11:35:11Z
{"Stellar":71924.26,"Stellar-borrowed":1005.68}
```

Reconciliation: Llama XLM 276,566.34 == on-chain `get_reserves(XLM@1) / 1e7 = 276,566.34` (exact).
Llama $71.9k vs XOXNO `tvlCashUsd` $73.7k → price source only (Llama XLM $0.2118 vs XOXNO oracle
$0.2127). The "≈ $73k" in the brief is cash TVL; the supplied figure (our gross convention) is
**$74.7k**. For Alula, DefiLlama (`slug=alula`, 2026-09-28 11:21Z) reports Stellar $11,729 /
borrowed $18.54 using "underlying token balances held by the Market contract", vs Alula's own
$11,801.82 (supply + collateral × oracle).

### H. Cost impact estimate

**Current calls per refresh run** (public `/v1/ops/metrics` + `/v1/ops/status`, 2026-09-28 11:55 UTC;
24h window; the requested 7-day DB query could not be run — see header):

```
$ curl -s https://stellar-api.getdig.ai/v1/ops/status | jq -r '.components[] | select(.kind=="step") | "\(.id) segments=\(.segments|length) lastDur=\(.segments[-1].durationMs)ms"'
step:prices:reference 96 2286 · step:prices:soroswap-derived 96 8843 · step:blend 96 11457 · step:soroswap 96 10580 · step:aquarius 96 166507
step:stellar-native 96 111049 · step:defindex 96 6150 · step:protocol-metrics 96 1376 · step:allbridge 96 1775 · step:network-stats 96 2007
$ curl -s https://stellar-api.getdig.ai/v1/ops/metrics | jq -r '.rpc[] | (.runs|map(.calls)) as $c | "\(.target) last20 min=\($c|min) avg=\(($c|add)/($c|length)|round) max=\($c|max) calls24h=\(.calls) errors=\(.errors)"'
defindex-api   last20 min=6   avg=6   max=6   calls24h=576   errors=0
horizon        last20 min=1   avg=1   max=1   calls24h=96    errors=0
price-sources  last20 min=4   avg=4   max=4   calls24h=384   errors=0
soroban-rpc    last20 min=749 avg=755 max=761 calls24h=70048 errors=0
```

| target | calls per run (last 20 runs) | calls / 24h (96 runs) |
|---|---|---|
| soroban-rpc | 749–761 (avg 755) | 70,048 |
| defindex-api | 6 | 576 |
| price-sources | 4 | 384 |
| horizon | 1 | 96 |

Two caveats. (1) `rpc_metrics_runs` is per **target**, not per step, so the Blend share of the 755 is
not measurable from data. (2) The wallet sweep (82 → 81) is **not instrumented**: `rpc_metrics_runs`
is written only by the 71 orchestrator (`71:172-215`), so today's Blend position calls are invisible.
From code (`81:101-114`, `fetch-user-positions.ts:55-57`: `PoolV2.load` + `loadOracle` + `loadUser`
per wallet × pool, ≥ 3 RPC calls each), with 115 tracked wallets (`/v1/ops/adoption`:
`"wallets":{"total":115,"signers":87,"watchOnly":28}`) and 4 pools, the sweep is on the order of
**≥ 1,400 RPC calls per run, 96 runs/day** — an estimate, not a measurement.

7-day query to run on the VPS (read-only), for the record:

```sql
select target, count(*) runs, sum(calls) calls, sum(errors) errors, round(avg(calls),1) avg_calls_per_run,
       min(calls) min_calls, max(calls) max_calls, round(avg(p95_ms)) avg_p95_ms
from rpc_metrics_runs where run_at > now() - interval '7 days' group by target order by calls desc;
select step, count(*) runs, sum((status<>'SUCCESS')::int) failed, round(avg(duration_ms)/1000.0,1) avg_s
from refresh_step_runs where run_at > now() - interval '7 days' group by step order by avg_s desc;
```

**Added calls per refresh run (L1 markets):**

| Venue | Partner-API route | Direct-RPC route |
|---|---|---|
| Alula | 1 GET `/v1/markets/{market}` (all pools, rates, prices, `observed_ledger`) → **+1 REST** | 1 `simulateTransaction get_market_data` (no resource-limit issue at 3 pools) or 1 `getLedgerEntries` (`AllPools` + 3 `Pool` + 3 `CachedPrice` keys) → **+1–2 RPC** |
| XOXNO | 1 GET `/integrations/lending/stellar` (25 hub markets, supplied/borrowed, APYs, utilization, prices) → **+1 REST** | `get_sync_data` × 25 markets + `get_market_indexes_detailed` × 1 (batched prices) → **+26 RPC**; spoke risk params (`get_spoke_asset`) only if shown → +57 |
| **Total** | **+2 REST/run (+192/day)** | **+27–29 RPC/run (+2.6–2.8k/day, +3.6–3.8%)** |

**Added calls per wallet sweep (L2 positions), 115 wallets:**

| Venue | Route | Calls per sweep |
|---|---|---|
| Alula | REST: **impossible** (no positions endpoint) | — |
| Alula | RPC: `getLedgerEntries` on `Obligation({wallet, None})` + `Obligation({wallet, EarnSeed})` for all wallets = 230 keys → 2 batched calls (≤ 200 keys/request); pool data + prices reused from L1 | **+2–3 RPC** |
| XOXNO | RPC: NFT `balance(owner)` × 115, then per account (30 exist protocol-wide; assume ≤ 10 ours) `get_owner_token_id` + `get_health_factor` + `get_total_collateral_usd` + `get_total_borrow_usd` + `get_account_positions` + `get_account_attributes` ≈ 6 | **+115 + ≈ 60 ≈ 175 RPC** |
| XOXNO | REST + RPC: `GET /users/{owner}/positions` × 115 (legs, stamped LT) + RPC `get_health_factor` per account (HF absent from the DTO) | **+115 REST + ≈ 10 RPC** |

Net: L2 adds ≈ 180 RPC calls per sweep (≈ +17k/day) on top of an uninstrumented ≈ 1.4k-per-sweep
Blend baseline — roughly +10–13% of sweep traffic, +25% of the *instrumented* daily total. Instrumenting
the sweep (import `ops-capture` in 81 and flush from 82) should be part of L2 so the number becomes
measured.

---

## 2. Proposed normalized shapes (proposal only)

### 2.1 Lending market row (L1)

Beta-first: **no new table**. One row per `(entity, asset, snapshot_at)` in `reserve_snapshots`, one
`pool_metrics_latest` row per entity, one `pool_snapshots` row per entity per run (all inside the
existing `BEGIN/COMMIT` + single `snapshot_at` pattern). Entity mapping: Blend = pool; **XOXNO = hub**
(`xoxno-core-hub`, `xoxno-rwa-hub`, `xoxno-amm-hub`, `contract_address` = Pool contract, metadata
`{hubId}`); **Alula = market** (`alula-main-market`, `contract_address` = Market). Venue rows
`xoxno` / `alula`, `venue_type='lending'`, entities `entity_type='lending_pool'`.

| Field (normalized) | Unit | Existing column | Blend source | XOXNO source (REST / RPC) | Alula source (REST / RPC) |
|---|---|---|---|---|---|
| venue, market_ref | slug, string | `venue_id`, `entity_id` (+ `metadata.marketRef`) | pool contract | `"${hubId}:${token}"` (HubAssetKey) | `"${market}:${pool}"` |
| asset | contract id, symbol, decimals | `asset_id`, `symbol`, `decimals` | reserve token | `hubMarkets[].token/symbol/decimals` / `get_sync_data.params` | `pools[].pool/symbol/decimals` / `get_pool_data` |
| supplied | token units | **`b_supply_scaled`** (+ `b_supply_raw`) | bToken supply | `suppliedRaw` / `get_supplied_amount` | `total_supplied` / `PoolData.total_supply` (+ `total_collateral` separately in metadata) |
| borrowed | token units | **`d_supply_scaled`** (+ `d_supply_raw`) | dToken supply | `borrowedRaw` / `get_borrowed_amount` | `total_borrowed` / `Pool.total_borrowed` |
| supply_apy, borrow_apy | fraction | `est_supply_apy`, `est_borrow_apy` (+ `supply_apr`, `borrow_apr`) | blend-sdk | `supplyApy`, `borrowApy` (fractions) / rates RAY (APR) | `supply_apy_bps / 1e4`, `borrow_apy_bps / 1e4` / `PoolData.apy.*_bps` |
| utilization | fraction | derived `borrowed / supplied` (not persisted; keep the current client derivation, or add to `metadata`) | — | `utilizationRate` / `get_utilisation` RAY | `utilization_bps / 1e4` |
| supply_cap | token units | `supply_cap_scaled` | reserve config | spoke-level `supplyCap` (varies by spoke → store hub-level null, metadata) | `PoolHealthConfig.supply_limit` |
| ltv, liquidation_threshold | fraction | **new: `metadata.ltv`, `metadata.liquidationThreshold`** (jsonb; promote to columns only if an alert family reads them) | c_factor / l_factor | per spoke×asset (`get_spoke_asset`) — hub row carries the Blue Chip spoke values or null | `open_ltv_bps`, `close_ltv_bps`, `liability_factor_bps` |
| price_usd | USD | `asset_prices` (source `partner-oracle:<venue>` when our rules have no price) | Blend oracle | `usdPrice` / `get_market_indexes_detailed.price_wad` | `oracle_price_usd` / `get_pool_asset_oracle_price` ÷ 1e14 |
| status | string | `metadata.status` | pool status | `marketStatus`, spoke flags | `GlobalState.status` (e.g. `FrozenByAdmin`), pool `status` flags |
| observed_ledger | int | `metadata.observedLedger` | — | (none on lists; `generatedAt` on `/integrations`) | `observed_ledger` / RPC `latestLedger` |
| source | string | `metadata.source` | `blend-sdk` | `xoxno-api` \| `soroban-rpc` | `alula-api` \| `soroban-rpc` |
| snapshot_at | timestamptz | `snapshot_at` (freshness = existing 45-min rule on `as_of`) | now | now | now |

Pool-level (`pool_metrics_latest`): `tvl_usd = total_supplied_usd` (gross, Blend convention),
`total_borrowed_usd`, `net_liquidity_usd`, `weighted_supply_apy`/`weighted_borrow_apy` (USD-weighted),
`total_backstop_credit_usd = null`.

Recommended source per venue for L1: **partner REST as primary** (1 call, includes prices and, for
Alula, a ledger stamp), **RPC as verifier** (a periodic cross-check step, e.g. every 4th run, comparing
supplied/borrowed to `get_market_data` / `get_supplied_amount`, logging the delta) — since the on-chain
data is the source of truth rule for anything that feeds an alert. Utilization is derived, not stored,
as today.

### 2.2 Lending position shape (L2)

| Field | Unit | Column | Blend | XOXNO | Alula |
|---|---|---|---|---|---|
| wallet, venue, entity | ids | existing | pool | hub of the account's positions (or the controller entity) | market |
| position_ref | text | **new `position_ref`** | NULL | `account_id` (NFT token id); metadata `{spokeId, mode}` | `'standard'` / `'earn'` / seed hex |
| health_factor | ratio, liquidation at 1.0, NULL if no debt | `health_factor` | effective collateral / effective liabilities | `get_health_factor / 1e18` (NULL when `i128::MAX`) | **LHF** (Σ Vc·cLTV / Σ Vb·LF), computed by us from the obligation + `get_market_data` |
| liquidation_health_factor | ratio | **new `liquidation_health_factor`** | = HF | = HF | LHF (same as above; keep the unweighted HF in metadata) |
| total_collateral_usd / total_debt_usd | USD | existing | effective values (as today) | `get_total_collateral_usd` (unweighted) / `get_total_borrow_usd` | Σ Vc / Σ Vb |
| borrow_limit_usd | USD | existing | `borrowCapUsd` | `get_ltv_collateral_usd` − debt | BC per docs |
| legs | per asset | `wallet_protocol_positions` (`position_type` `supply`/`borrow`, + `collateral` for Alula plain collateral) | as today | `get_account_positions` (scaled RAY → tokens via indexes) or REST `supplyAmount/borrowAmount` | `deposits[pool].{j_tokens→tokens, collateral}`, `borrows[pool].d_tokens→tokens` |
| source, snapshot_at | | `metadata.source`, `snapshot_at` | `blend-sdk` | `soroban-rpc` (+`xoxno-api` for legs) | `soroban-rpc` |

---

## 3. Proposed build plan (L1 then L2, STOP-AND-SHOW gates)

Ownership: partner fetch + persistence → **indexer**; contracts + `(asset × venue)` read → **api**;
views → **web**. Each step is a small, separately committable increment.

### L1 — Markets

| Step | What | Files likely touched | Gate |
|---|---|---|---|
| **L1-0 Registry + theming seeds** | venues `xoxno`, `alula` (`venue_type='lending'`), entities (3 XOXNO hubs, 1 Alula market), assets for the 5 non-LP XOXNO gaps (+ LP tokens as assets with no price rule), `entity_assets` role `reserve`; logos | `apps/indexer/src/scripts/bootstrap/registries/core-registry.json`, optional `xoxno-upsert-core.ts` / `alula-upsert-core.ts`, `seed-logos.ts`, `apps/web/src/assets/protocols/{xoxno,alula}.svg`, `data/venueTheme.ts`, `data/protocolMeta.ts` | local `bootstrap:core` output; `/v1/protocols` lists 8 venues |
| **L1-1 Adapters** | `lib/protocols/xoxno/{fetch-hub-markets.ts, persist-hub-state.ts, compute-hub-metrics.ts}` and `lib/protocols/alula/{fetch-market.ts, persist-market-state.ts, compute-market-metrics.ts}`; REST primary, RPC verifier; Blend column semantics; `BEGIN/COMMIT` + single `snapshot_at`; partner price fallback written to `asset_prices` with `source='partner-oracle:<venue>'` | new files; `scripts/ingest/run-xoxno-refresh.ts`, `run-alula-refresh.ts` (first line `import '../../lib/ops-capture'`) | one local `job:refresh`, itemized supplied/borrowed per market vs partner UI + on-chain (like `docs/evidence/lot-p/p2-tvl-crosscheck.txt`) |
| **L1-2 Wiring** | 71 discovery + steps (`xoxno:<slug>`, `alula:<slug>`), 70 `persistProtocol` ×2, `OpsTarget` + host rules, `STEP_LABELS` / `RPC_LABELS`, `stellar_v1_ops_metrics.sql` comment | `71-refresh-all-metrics.ts:277-280, 304-372`, `70-protocol-persist-metrics.ts:169-173`, `lib/ops-metrics.ts:25, 81-95`, `modules/ops/status.ts:80-96` | `/v1/ops/metrics` shows `xoxno-api`, `alula-api`; `/health` green for both |
| **L1-3 API** | `GET /v1/lending/rates` — `(asset × venue)` rows from latest `reserve_snapshots` ⋈ `assets` ⋈ `venues (venue_type='lending')` ⋈ latest `asset_prices`, with utilization computed once server-side, `freshnessFields` per row; fix or document the `d_supply_scaled` uses at `stellar.service.ts:250, :930` | `apps/api/src/modules/stellar/stellar.{controller,service}.ts`, `apps/web/src/types/protocol.ts` | **STOP-AND-SHOW** the JSON (all three venues, XLM/USDC/PYUSD/EURC rows) before any UI |
| **L1-4 Web** | `LendingRatesView.vue` derived from the `ProtocolsView` table (lending column set, chips, sort, N/A, Stale badge, `BrandLogo`), grouped by asset; shared `formatRatioPct` in `utils/format.ts`; nav item; `useLendingRates.ts` | `components/views/LendingRatesView.vue` (new), `composables/useView.ts`, `App.vue`, `shell/AppSidebar.vue`, `api/lending.ts`, `utils/format.ts` | **STOP-AND-SHOW** a capture before polish; then `pnpm -C apps/web build` |
| **L1-5 TVL decision addendum** | include both (gross), amend the decision doc, note `protocolCount` 4 → 6 and the ≈ +0.03% step | `docs/decisions/2026-08-17-network-tvl-definition.md` (addendum), `docs/current-state.md`, `docs/runbooks.md`, `docs/status-board.md` | founder ruling |

No schema file is required for L1 (all additive data in existing tables; LTV/LT in `metadata`).

### L2 — Positions + risk

| Step | What | Files | Gate |
|---|---|---|---|
| **L2-0 Schema** | `apps/api/src/db/stellar_v6_lending_positions.sql` (C2 DDL: `position_ref` ×2, `liquidation_health_factor`, index, `alert_rule_state` PK widen). Mount as `docker-compose.yml` `…/60-stellar_v6_lending_positions.sql` (existing numbering: 10–16 v1, 20 v2, 30 v3, 40 v4; note `stellar_v5_faucet_campaign2.sql` is applied manually per `docs/runbooks.md:182`, not mounted — add `50-` for it in the same change or keep consistent) | new SQL, `docker-compose.yml`, `docs/runbooks.md` "Apply raw SQL schemas" | `pnpm -C apps/api test` still green (alerting specs) |
| **L2-1 Sweep dispatch** | 81 → per-venue loop over `venue_type='lending'`: Blend adapter unchanged; `lib/protocols/alula/{fetch-user-positions.ts, resolve-user-health.ts}` (batched `getLedgerEntries` on the two computable seeds, LHF computed from `get_market_data`); `lib/protocols/xoxno/{fetch-user-positions.ts, resolve-user-health.ts}` (NFT enumerable → per-account views); instrument the sweep (`ops-capture` in 81, flush in 82) | `scripts/wallets/81-stellar-wallet-blend-positions.ts` (rename to `81-stellar-wallet-lending-positions.ts` or keep + dispatch), new adapter files, `82-run-wallet-alert-job.ts` | **STOP-AND-SHOW**: health rows for one known XOXNO account (e.g. account 1 → HF 1.21) and one Alula obligation (`GDGRMW55…`), values cross-checked vs partner views |
| **L2-2 API** | `positionRef`, `venueSlug`, `venueName`, `liquidationHealthFactor` on overview `poolHealth[]` and `/positions` pools; key changes at `wallets.service.ts:977-978, 1179-1180`; evaluator keys (`alerts.repository.ts:323-337, 544`; `83:49-51, 166-178`) | `modules/wallets/wallets.service.ts`, `modules/alerts/*`, `scripts/83-evaluate-alerts.ts`, specs | `pnpm -C apps/api test`; HF rule fires on a seeded low-HF row (existing spec pattern) |
| **L2-3 Web** | venue sub-label + `positionRef` label on Portfolio / YourPositionsPanel rows (existing `text-[11.5px] var(--dig-faint)` line), "Blend" copy → venue-agnostic; gauge unchanged | `PortfolioView.vue:142, 334, 339, 556, 561-591`, `YourPositionsPanel.vue:55, 124`, `types/wallet.ts` | **STOP-AND-SHOW** before finalising |
| **L2-4 Alerts** | HF family works via schema + writer; TVL-drop / APY pickers pick up new venues automatically; pool-status family stays Blend (deferred, documented) | `docs/alerting/probe-01-read-model.md` addendum, `docs/lot-n-alerting.md` | rule created in UI for a XOXNO/Alula pool |

### Deploy order (per `docs/deployment.md` / `docs/runbooks.md`; VPS deploys via git bundle)

1. VPS: `git bundle` → `pnpm install` → apply `stellar_v6_lending_positions.sql` (L2 only) →
   `pnpm -C apps/indexer bootstrap:core` (new venues/entities/assets/logos) → restart api → one manual
   `job:refresh` → verify `/health`, `/v1/protocols`, `/v1/pools?protocol=xoxno|alula`,
   `/v1/ops/metrics` targets.
2. Vercel web only after the API serves the new endpoint (L1-3) and, for L2, after one sweep has
   written `position_ref` rows.
3. Status page (`#status`) will list the new steps by raw key until `STEP_LABELS` ships (never dropped).

---

## 4. Open questions

### For XOXNO (Mihai)

1. **Canonical TVL:** `/integrations` `tvlCashUsd` ($73.7k, = DefiLlama `get_reserves`) vs
   `tvlSuppliedUsd` / `stats/history.supplied` ($74.7k). Which does xoxno.com show, and is the
   `/defillama` route's `tvl` intentionally supplied-based while the Llama adapter is cash-based? (We
   would display gross supplied to match our Blend convention.)
2. **Owner → accounts:** is NFT `balance(owner)` + `get_owner_token_id(owner, index)` a supported,
   stable public read (across NFT upgrades / burns), or should integrators rely only on
   `/users/{owner}/positions`? What is the indexer latency after an NFT transfer?
3. **Per-account HF in the API:** `/accounts/{id}/positions` has no HF and `/positions` exposes the
   inverted percentage. Will `healthFactorWad` (contract convention) be exposed per account, at which
   price/index snapshot? Confirm HF uses ceil-rounded debt (our off-by-one check).
4. **Prices:** API `usdPrice` (0.212704) vs live `price_wad` (0.212686) for XLM in the same minute —
   which feed/timestamp, and which of `price_wad` / `primary` / `anchor` should a third party show?
5. **Polling policy:** no rate-limit headers observed; expected cadence for an external indexer
   (`/integrations` every 15 min, `/users/{owner}/positions` × ~120 every 15 min)? Any User-Agent /
   attribution requirement? Is `https://stellar-gateway.xoxno.com` open to partners?
6. **`/integrations/lending/stellar` stability:** versioning guarantee, `generatedAt` cadence, and
   at which ledger `tvlCashRaw` is read.
7. **Index staleness:** USDT0@1 `get_delta_time` ≈ 6 days. Do you run an `update_indexes` keeper, or
   should displayed APY/indices be recomputed client-side from `get_bulk_indexes`?
8. **Account TTL:** `AccountMeta(1)` liveUntil ≈ +18 days. What is the `renew_account` policy; do
   views trap on archived accounts?
9. **`get_account_positions` map keys** are `HubAssetKey` structs (JS `scValToNative` cannot key
   them) — any planned ABI change?
10. **DeFindex-adapter accounts** (supply-only, vault as owner): present in `/users/{owner}/positions`?
    Should they be excluded from user-facing totals?
11. **Testnet parity:** `testnet-api.xoxno.com` + testnet controller `CCXRWJ6S…V3F3` kept at the same
    wasm hash for integration tests?

### For Alula

1. **`AllObligations` / `get_all_obligations`:** the developer quickstart recommends them, but the
   deployed mainnet Market (wasm `76e60d02…78b6`) has neither the storage key nor the function. Is a
   newer contract planned? Until then, how does Alula's own UI list a user's obligations?
2. **Multiply seed derivation:** the token-pair → `BytesN<32>` formula is not in the market contract
   or docs. Please share it (or a view) so `(user, seed)` keys can be probed per wallet.
3. **Positions endpoint:** any plan for `GET /v1/obligations?user=…` (with LHF)? Without it L2 relies
   on direct storage reads.
4. **`tvl_usd_cents` definition:** we measured `(total_supply + total_collateral) × oracle × 100`;
   please confirm (collateral included; undistributed take-rate fees excluded).
5. **Market status:** `FrozenByAdmin` since 2026-09-28 00:55 UTC after `pool_bad_debt_locked(native)`
   + `issue_cover_bad_debt`. What is the re-activation plan and the expected cadence of such freezes?
   (This determines whether the venue is shown as "frozen" in the rates view at launch.)
6. **jToken share scaling:** USDC/PYUSD `total_supply / total_j_tokens ≈ 0.10` — initial mint ratio?
   Confirm value-per-share must always be read from the pool.
7. **Oracle:** `CBZDQPVY…7VWW` — SEP-40 provider identity and refresh cadence; is REST
   `oracle_price_usd` the market's `CachedPrice` or a direct oracle read?
8. **Rate limits / polling** for `/v1/markets/{market}` every 15 min; any attribution requirement.
9. **Event archive:** `getEvents` returned nothing beyond ~1 day on two RPCs; do you provide an
   archival events/obligations dump?

---

## 5. Risks

| Risk | Evidence | Mitigation in plan |
|---|---|---|
| **Partner API dependency** (no SLA, no rate-limit policy, XOXNO list routes carry no ledger stamp; Alula scraper lags 10–20 ledgers) | G1, G4 headers; `defindex-api` precedent | REST primary + RPC verifier step; per-venue `ops` target + freshness chip; the 45-min stale rule already covers outages |
| **Alula obligation enumeration** impossible from an address; Multiply seeds unknown; docs describe an undeployed contract | G2 storage reads, spec parse | Support `standard` + `earn` only, label Multiply as unsupported; ask Alula (Q1–Q3) |
| **Alula market frozen with bad debt at TVL ≈ $11.8k** | `update_market_status {FrozenByAdmin}` ledger 64654225; `GlobalState.status=6` | show status in the rates view from `metadata.status`; do not launch positions UI for Alula until re-activated |
| **HF comparability** — Alula's unweighted HF vs LHF; XOXNO stamped thresholds | C3 | store the liquidation-relative factor only; copy explains per-venue semantics |
| **Pricing gaps** — 15 XOXNO assets unpriced by our rules (≈ $510 today), silent $0 valuation | B3 | `partner-oracle:<venue>` fallback source, confidence flagged; LP tokens partner-priced only |
| **Network-TVL definition** — deny-list auto-includes; no methodology-change marker for a second step | E2 | decision-doc addendum; impact +0.03% (invisible) |
| **Pre-existing `d_supply_scaled` misuse** in top-assets and series | `stellar.service.ts:250, :930` verified | fix in L1-3 (or document) before a second lending venue makes it visible |
| **RPC cost** — L2 XOXNO ≈ +175 calls/sweep; sweep uninstrumented today | H | instrument 81/82; batch NFT reads via `getLedgerEntries` if the OZ enumerable key layout is confirmed; prefer REST legs + RPC HF |
| **Grain change** (`position_ref`) touches alert state PK | C2 | additive DDL with defaults; Blend rows NULL; specs extended |

## 6. Explicitly out of scope

- **L3 actions** (supply/withdraw on XOXNO/Alula). Plug-in point only: `apps/api/src/modules/actions`
  (`network-registry.ts` pool registry, `derivePoolStatus`) and the web action gating
  (`PoolDetailView.vue:395-402`); XOXNO's `controller.supply(caller, account_id, spoke_id, …)` and
  Alula's `deposit/borrow` would each need their own client-side XDR validators per
  `docs/security-invariants.md`. Nothing here is designed for it.
- **Any new visual pattern.** The rates view derives from the `ProtocolsView` table and the Reserves &
  rates row; positions reuse `HealthFactorGauge`, `PositionAssetChips`, `BrandLogo`, `FreshnessChip`.
- **Other protocols**, the auto pool-status alert family for the new venues, spoke-level (XOXNO) or
  per-obligation (Alula Multiply) analytics, and Prisma/legacy paths.
