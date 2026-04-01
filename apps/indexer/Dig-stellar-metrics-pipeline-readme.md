# Dig Stellar — Metrics Pipeline Recap

## Objective

This repo now has a **clean refresh flow** for Stellar protocols, with a clear separation between:

* reusable protocol logic in `src/lib/protocols/...`
* executable refresh scripts in `src/scripts/ingest/...`
* shared DB / lookup / pricing helpers in `src/scripts/shared/...`

The goal is to be able to:

1. refresh a **single pool** for one protocol
2. refresh **all pools** across protocols
3. expose consistent metrics to the API
4. add new pools without rebuilding the whole pipeline

---

## Current protocol status

### Soroswap

Working end to end.

Main flow:

* fetch pair state
* fetch pair events
* normalize events
* persist normalized events
* compute / persist pool metrics

Single-pair runner:

* `src/scripts/ingest/run-soroswap-pair-refresh.ts`

Reusable logic:

* `src/lib/protocols/soroswap/fetch-pair-state.ts`
* `src/lib/protocols/soroswap/fetch-pair-events.ts`
* `src/lib/protocols/soroswap/normalize-pair-events.ts`
* `src/lib/protocols/soroswap/persist-pair-events.ts`
* `src/lib/protocols/soroswap/persist-pair-metrics.ts`
* `src/lib/protocols/soroswap/types.ts`

---

### Aquarius

Working end to end.

Main flow:

* fetch pool state
* fetch pool events
* normalize events
* persist normalized events
* compute / persist pool metrics

Single-pool runner:

* `src/scripts/ingest/run-aquarius-pool-refresh.ts`

Reusable logic:

* `src/lib/protocols/aquarius/fetch-pool-state.ts`
* `src/lib/protocols/aquarius/fetch-pool-events.ts`
* `src/lib/protocols/aquarius/normalize-pool-events.ts`
* `src/lib/protocols/aquarius/persist-pool-events.ts`
* `src/lib/protocols/aquarius/persist-pool-metrics.ts`
* `src/lib/protocols/aquarius/types.ts`

---

### Blend

Working end to end.

Main flow:

* fetch pool state from Blend SDK
* resolve reserve assets
* persist reserve snapshots / pool state
* compute / persist pool metrics from latest reserve snapshots + latest prices

Single-pool runner:

* `src/scripts/ingest/run-blend-pool-refresh.ts`

Reusable logic:

* `src/lib/protocols/blend/fetch-pool-state.ts`
* `src/lib/protocols/blend/persist-pool-state.ts`
* `src/lib/protocols/blend/compute-pool-metrics.ts`
* `src/lib/protocols/blend/persist-pool-metrics.ts`
* `src/lib/protocols/blend/types.ts`

Important note:

* `run-blend-pool-refresh.ts` must receive the correct `BLEND_POOL_ID`
* the global refresh script now passes it explicitly to avoid cross-pool corruption

---

## Global orchestrator

Global refresh script:

* `src/scripts/ingest/71-refresh-all-metrics.ts`

Current responsibilities:

1. refresh reference prices
2. refresh derived Soroswap prices
3. refresh Blend pools + metrics
4. refresh Soroswap pools + metrics
5. refresh Aquarius pools + metrics
6. refresh protocol-level metrics

This script reads pool lists from the database and runs each protocol-specific runner with the correct env vars.

---

## Pricing layer

### Current structure

Shared helpers:

* `src/scripts/shared/pricing.ts`

  * `getLatestAssetPricesMap`
  * `safeDivide`
  * `inferStablePrice`

Config-driven price rules:

* `src/scripts/shared/pricing-config.ts`

Reference price refresh:

* `src/scripts/ingest/62-price-reference-assets.ts`

Derived Soroswap price refresh:

* `src/scripts/ingest/63-price-soroswap-derived.ts`

Price report / debug:

* `src/scripts/ingest/64-asset-prices-latest-report.ts`

### Current pricing behavior

Supported patterns:

* direct CoinGecko prices
* stable hardcoded prices
* manual env fallback prices
* BTC proxy prices for wrapped BTC-style assets
* Soroswap-derived prices for assets that can be inferred from a priced pair

### Example assets currently covered

* `native`
* `USDC`
* `PYUSD`
* `EURC`
* `SolvBTC`
* `xSolvBTC`
* `USTRY`
* `CETES`
* `TESOURO`
* `oUSD`

---

## Debug philosophy

Reusable logic lives in `lib/`.

Debug artifacts are optional and should only be written when needed.

Examples:

* `lib-soroswap-pair-state.json`
* `lib-soroswap-pair-events.json`
* `lib-soroswap-pair-events-normalized.json`
* `lib-aquarius-pool-state.json`
* `lib-aquarius-pool-events.json`
* `lib-aquarius-pool-events-normalized.json`
* `lib-blend-pool-state.json`
* `lib-blend-pool-metrics.json`

These are useful for inspection, but they are not the source of truth. The source of truth is:

* chain / SDK reads
* database tables
* API output

---

## Main database tables actually used

### Core registry

* `venues`
* `entities`
* `assets`
* `entity_assets`

### Event / state / metrics storage

* `normalized_events`
* `reserve_snapshots`
* `pool_metrics_latest`
* `protocol_metrics_latest`
* `asset_prices`

### Optional / auxiliary

* `pool_snapshots`
* `sync_cursors`

### Practical mapping by protocol

#### Soroswap

Uses mainly:

* `entities`
* `assets`
* `entity_assets`
* `normalized_events`
* `reserve_snapshots`
* `pool_metrics_latest`
* `asset_prices`

#### Aquarius

Uses mainly:

* `entities`
* `assets`
* `entity_assets`
* `normalized_events`
* `reserve_snapshots`
* `pool_metrics_latest`
* `asset_prices`

#### Blend

Uses mainly:

* `entities`
* `assets`
* `entity_assets`
* `reserve_snapshots`
* `pool_metrics_latest`
* `asset_prices`

Blend currently does not depend on normalized swap-style event history in the same way as Soroswap / Aquarius.

---

## How to refresh one pool

### Soroswap

```bash
export SOROSWAP_PAIR_ID=<PAIR_ID>
export ENTITY_SLUG=<ENTITY_SLUG>
pnpm tsx src/scripts/ingest/run-soroswap-pair-refresh.ts
```

### Aquarius

```bash
export AQUARIUS_POOL_ID=<POOL_ID>
export ENTITY_SLUG=<ENTITY_SLUG>
pnpm tsx src/scripts/ingest/run-aquarius-pool-refresh.ts
```

### Blend

```bash
export BLEND_POOL_ID=<POOL_ID>
export ENTITY_SLUG=<ENTITY_SLUG>
pnpm tsx src/scripts/ingest/run-blend-pool-refresh.ts
```

Debug mode when needed:

```bash
export DEBUG=1
```

---

## How to refresh everything

```bash
pnpm tsx src/scripts/ingest/71-refresh-all-metrics.ts
```

Recommended env:

```bash
export STELLAR_RPC_URL=https://mainnet.sorobanrpc.com
export HORIZON_URL=https://horizon.stellar.org
export LEDGER_LOOKBACK=20000
export EVENTS_LIMIT=200
export MAX_EVENT_PAGES=50
```

---

## How to add a new pool

### Soroswap / Aquarius

1. create the `entities` row with the correct slug and contract address
2. ensure reserve assets exist in `assets`
3. ensure `entity_assets` is populated if needed by the API layer
4. run the single-pool refresh script
5. verify API output

### Blend

1. create or update the `entities` row with:

   * correct slug
   * correct display name
   * correct contract address
2. run:

   * `62-price-reference-assets.ts` if new reserve assets need prices
   * `run-blend-pool-refresh.ts`
3. verify `reserve_snapshots`
4. verify `pool_metrics_latest`
5. verify `/v1/pools/<slug>`

Important:

* the `entities.contract_address` must be correct
* the global script uses it as the source of truth

---

## Known lessons / pitfalls

### 1. Env leakage is dangerous

If a runner depends on `POOL_ID` / `BLEND_POOL_ID` / `SOROSWAP_PAIR_ID` / `AQUARIUS_POOL_ID`, the orchestrator must pass the correct value explicitly.

### 2. DB registry correctness matters

If `entities.slug -> contract_address` is wrong, the refresh may run successfully but persist data for the wrong pool.

### 3. Discovery legacy files are useful, but not the main refresh path

The old numbered discovery files were useful to bootstrap each protocol, but the stable production path should go through:

* `lib/protocols/...`
* `run-...-refresh.ts`
* `71-refresh-all-metrics.ts`

### 4. Pricing needs to stay config-driven

Adding assets should mostly be a matter of editing `pricing-config.ts`, not scattering manual logic across scripts.

---

## Recommended next cleanup steps

### High value

* add a proper seed/upsert script for Blend pools
* document exact steps to add a new pool
* ensure debug JSON files are only written when `DEBUG=1`

### Nice to have

* harmonize `asset_prices.source` naming
* add a small validation script for `entities` consistency
* add per-protocol README sections or one architecture diagram

---

## Current conclusion

The pipeline is now in a good state for beta:

* protocol refreshes are separated and understandable
* global orchestration works
* prices are extensible
* API output is coherent
* new pools can be added with a predictable workflow

This is no longer a fragile prototype. It is now an operable refresh pipeline with a clear place for future cleanup and extension.
