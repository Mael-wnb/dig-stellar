# Lot XO — XO-1 build evidence: gates 1a/1b, RPC cost, API series, web (2026-10-26 → 2026-10-30)

Scope: read-only market analytics for XOXNO Lending (venue `xoxno`, 3 hub entities, 25 markets).
Out of scope (unchanged): XO-2 wallet positions (one wallet holds many Position NFTs — needs an
account-id dimension), spokes, actions / XDR, leaderboard, events, revenue, alerts, any XOXNO
HTTP API call in the pipeline. Rulings: `docs/decisions/2026-10-27-xoxno-tvl-and-pricing.md`.
Every local RPC run below used the PUBLIC endpoint (`mainnet.sorobanrpc.com`) at 4 req/s
(`XOXNO_READ_SPACING_MS = 250`), never the operator key.

## 1. What was built

- `lib/protocols/xoxno/` — `fetch-hub-state.ts` (pure on-chain read through the shared
  `SorobanReader`; XDR-typed decoding; per market the six accrued views + cached params; the
  aggregator price only for fallback-eligible markets, 3 keys per call), `persist-hub-state.ts`
  (venue / entity / assets / `entity_assets` upserts, one `pool_snapshots` + one
  `reserve_snapshots` row per market under a single `snapshot_at` in one transaction, the
  scoped `xoxno-aggregator` price rows, the 24 h `paramsCache` in the entity metadata),
  `compute-pool-metrics.ts` (TVL = cash × price over priced markets; `xoxno-aggregator` rows
  lose to any own source), `persist-pool-metrics.ts` (`pool_metrics_latest`, same columns as
  Blend so step 70 and `/v1/pools` need no change), `pricing-scope.ts` (the one
  fallback-eligibility predicate shared by fetch and persist), `types.ts`.
- `scripts/ingest/run-xoxno-hub-refresh.ts` — one hub per process, spawned by step 6c of
  `71-refresh-all-metrics.ts` (after DeFindex, before the protocol rollup; non-fatal per hub);
  `lib/ops-capture` is its first import. `70-protocol-persist-metrics.ts` folds `xoxno`.
- `scripts/shared/soroban-read.ts` — `readRaw` (raw `xdr.ScVal`); `read` unchanged
  (regression table below). `pricing-config.ts` — rule kind `external`, 14 markers, `USDT0`
  oracle rule; step 62 skips `external` symbols silently (15 warnings → 0).
- Bootstrap `xoxno-upsert-core.ts` (idempotent; merges entity metadata so the params cache
  survives a re-seed) + `core-registry.json` (+1 venue, +3 entities, +15 assets,
  +25 `entity_assets`).
- API: `STEP_LABELS.xoxno`; `getPoolSeries` uses `metadata.cash` for the `xoxno` venue
  (`stellar.pool-series-amount.spec.ts`, 3 tests; suite 369 passed).
- Web: `venueTheme.ts` / `protocolMeta.ts` (monogram chip, magenta), pool-detail copy for
  XOXNO hubs, and the lending action ("Supply / Withdraw") gated to Blend — any `lending_pool`
  used to open the Blend deposit widget (which refuses unvetted slugs, so the invariant held, but
  a XOXNO hub offered a Blend action). Dimmed + tooltip for XOXNO, like vaults.

## 2. Gate results (1a/1b, 2026-10-26/27)

Pass A (own prices forced stale, `PRICE_MAX_AGE_MINUTES=1`): Core hub 0/7 priced, no fallback
rows, TVL null; RWA 4/7 (USST, XAUM, deJTRSY, deJAAA from the aggregator); AMM 10/11 (LP tokens).
Pass B (after step 62): 25/25 priced; Core entirely from own sources; aggregator used for XAUM,
USST, deJTRSY, deJAAA and the 10 LP tokens only. Raw `get_reserves` byte-identical to the step-0
recon for 25/25 markets. Full local `job:refresh` with the API up: `/health` lists xoxno;
`/v1/protocols` xoxno TVL $150,307.31, 25 assets; `/v1/pools?protocol=xoxno` 3 pools (Core
$145,772 / RWA $2,502 / AMM $2,033); `/v1/ops/status` shows `step:xoxno`.

Regression of the `soroban-read` change (baseline with it stashed, 19:08 vs wired 19:15):

| venue | TVL before | TVL after | APY before → after |
|---|---|---|---|
| blend | 163,562,399 | 163,473,112 | 1.6562 / 10.0780 → 1.6570 / 10.0776 |
| aquarius | 45,681,455 | 45,645,566 | — |
| defindex | 18,921,724 | 18,921,693 | 5.1193 → 5.1193 |
| soroswap | 1,187,080 | 1,186,776 | — |
| stellar-native | 5,598,089 | 5,595,644 | — |

All drifts < 0.1 % over six minutes of market movement; pool-level APYs equal to 4 decimals.
Duration 267 s → 286 s locally (xoxno step 26.2 s at 120 ms spacing).

## 3. RPC cost per refresh (2026-10-30, ops capture per JSON-RPC method)

XOXNO step only (3 hubs), standalone runs with `OPS_METRICS_FILE`:

| run | simulateTransaction | getLedgerEntries | total |
|---|---:|---:|---:|
| before (1b call pattern, 250 ms spacing) | 188 | 3 | 191 |
| after, cold (params cache empty) | 184 | 3 | 187 |
| after, warm (cache ≤ 24 h) — steady state | 159 | 3 | 162 |

Per hub (warm): Core 43 (7 markets × 6 views + app version; 0 aggregator keys), RWA 45
(+ 4 keys in 2 chunks), AMM 71 (11 markets, + 10 keys in 4 chunks). Step duration 42.6 s.
The 1b figure of 187 counted simulations only. What was removed: 25 `get_sync_data` per
refresh (24 h cache) and 3 aggregator chunks (own-priced markets no longer sent). What cannot
be removed under the accepted design: the 6 accrued views per market (the `State` entry lags
accrual, `get_utilisation` ≠ borrowed/supplied, and deriving amounts from the accrued indexes
would re-implement the licensed accrual math). Cadence stays `*/15`.

Attribution inside a full `job:refresh` (run_at 2026-10-30T17:40:11Z, 445 s, 11/11 SUCCESS):
the shared ops JSONL grew by +72, +44 and +46 lines at the three hub step ends (18:46:50,
18:47:10, 18:47:33) = 159 + 3, and the `rpc_metrics_runs` row is

```
soroban-rpc | 927 calls | 3 errors | job=refresh | {"getEvents": 423, "getLatestLedger": 27, "getLedgerEntries": 16, "simulateTransaction": 461}
```

The 3 errors are three HTTP 429 from the public endpoint in the Aquarius aqua-usdc clpool step
(retried, step SUCCESS); the XOXNO hubs reported 0 retries / 0 failures.
Second full run (run_at 2026-10-30T18:58:13Z, 606 s, 11/11 SUCCESS; xoxno step 42.8 s, hubs
43 + 45 + 71, 0 retries / 0 failures): `soroban-rpc | 926 calls | 24 errors | job=refresh |
{"getEvents": 420, "getLatestLedger": 30, "getLedgerEntries": 16, "simulateTransaction": 460}` —
the 24 errors are public-endpoint 429s in the Soroswap (14), Aquarius (8) and native (2) steps,
all retried to SUCCESS. The XOXNO count is identical run to run (159 + 3): the step is
deterministic in the number of markets and fallback keys. `network_tvl_snapshots` after the run:
$212.9M over 5 venues (Blend, Aquarius, Soroswap, native, XOXNO; DeFindex excluded).

## 4. Params cache (requirement 1) and fallback scope (requirement 2)

`entities.metadata.paramsCache = { fetchedAt, appVersion, byAsset: { <asset>: { decimals,
interestRateModel } } }` per hub (7 / 7 / 11 entries). Served when `fetchedAt` is within 24 h and
`appVersion` matches; a seeded market missing from `byAsset` is read from chain (new market needs
no manual step); `XOXNO_PARAMS_REFRESH=1` forces a full re-read. `pool_snapshots.metadata.callPlan`
records `{ paramsFromCache, paramsFromChain, priceFallbackKeys, priceChunks }` per run.
Only fallback-eligible markets (no rule or the `external` marker) are sent to
`get_market_indexes_detailed`; the persist re-checks the same predicate before writing a row.

## 5. API series fix (2026-10-30)

`GET /v1/pools/:slug/series` multiplied `b_supply_scaled` (supplied) by price for every
lending pool; a XOXNO hub chart read ≈ $191k against a $140.7k hub TVL. Now per venue:
Blend supplied × price (unchanged, `blend-fixed-pool` last point $162.0M vs detail $162.4M),
XOXNO `metadata.cash` × price (`xoxno-core-hub` last point $140,478.19 = detail TVL
$140,478.19 after the same price step). Latest-price approximation and the 45-minute price
window apply to the series as before (an `xoxno-aggregator` row older than the window drops
its market from a point, as for any stale price).

## 6. Web (1c) — final state

Venue display name `XOXNO` (the longer name wrapped in the venue tiles and collided with the
asset stack); monogram chip; pool detail: "XOXNO, Lending market", lending action dimmed with
tooltip, protocol-aware description. Screenshots (local build against the local API, desktop
1440 px and phone 390 px viewport; the dev-only wallet-proof overlay hidden):
`screenshots/desktop-dashboard-protocols.png`, `screenshots/desktop-protocols-xoxno.png`,
`screenshots/desktop-pool-xoxno-core-hub.png`, `screenshots/mobile-dashboard-protocols.png`,
`screenshots/mobile-protocols-xoxno.png`, `screenshots/mobile-pool-xoxno-core-hub.png`,
`screenshots/mobile-pool-xoxno-core-hub-reserves.png`.

## 7. Known behaviours (not defects of this lot)

- Step order (reference prices before the Aquarius refresh): when the previous run is older than
  the 45-minute price window, the run leaves USDY unpriced (its own source is the Aquarius
  USDY/USDC pool's reserves, refreshed later in the same run); the next run within the window
  prices it — i.e. never on the `*/15` cadence, only after an idle. Pre-existing, not
  XOXNO-related. Observed locally 2026-10-30 (RWA 6/7 → 7/7 on the next cycle).
- An own-priced market whose own price is stale is unpriced (never falls back) — intended.
