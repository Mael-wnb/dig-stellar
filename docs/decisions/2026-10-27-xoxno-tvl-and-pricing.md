# Decision: XOXNO Lending — TVL definition, scoped price fallback, overlap, licence (2026-10-27)

**Status: decided (founder rulings at gates 1a/1b, 2026-10-26/27; production requirements
2026-10-30) and implemented (Lot XO, XO-1).**

## Context

XOXNO Lending is a Soroban lending protocol with one central pool contract (custody +
per-market accounting), a controller (accounts / risk / price views) and a price aggregator
(Reflector / RedStone / XOXNO feeds + Aquarius LP pricers). A market is a
`HubAssetKey { hub_id, asset }`; the 25 markets are grouped in three hubs (Core, RWA, AMM).
We model one entity per hub (Blend pattern: entity = pool, `reserve_snapshots` row = market).
Addresses, market list and units are verified in `docs/evidence/lot-xo/00-recon-verification.md`.

## Rulings

1. **TVL = pool cash.** `tvl_usd` for a hub is Σ `pool.get_reserves` × price over the PRICED
   markets — the cash held in the pool, which is also what DefiLlama sums for XOXNO. Supplied and
   borrowed are stored and served separately (`total_supplied_usd` / `total_borrowed_usd`, the
   Blend column convention `b_* = supplied`, `d_* = borrowed`). Unpriced markets are EXCLUDED
   from the sum and counted (`pricedMarkets / totalMarkets / unpricedMarkets`); nothing is ever
   priced at 1. The pool TVL history series (`GET /v1/pools/:slug/series`) uses the same leg
   (`reserve_snapshots.metadata.cash`) for the `xoxno` venue; Blend keeps supplied × price.
2. **Scoped exception to the 2026-08-17 "our data only" rule.** The XOXNO price aggregator
   (`controller.get_market_indexes_detailed`) may price an asset ONLY when that asset is
   structurally uncovered by our own pricing: no rule in `pricing-config.ts`, or the explicit
   `{ kind: 'external', source: 'xoxno-aggregator' }` marker (today XAUM, USST, deJTRSY, deJAAA
   and the 10 Aquarius LP tokens). It applies to XOXNO markets only, is written as
   `asset_prices.source = 'xoxno-aggregator'` and loses to any own-source row in the metrics
   readers. An asset WITH an own rule never falls back, even when its own price is stale: the
   product-wide staleness semantics apply (fresh ≤ `PRICE_MAX_AGE_MINUTES`, else the market is
   unpriced and the pool is flagged stale), exactly like Blend. Own max age on the fallback:
   **24 h** (`XOXNO_AGGREGATOR_MAX_AGE_SEC`), on top of the aggregator's own `stale` / `valid` /
   `error_code` flags. Own-priced markets are never even sent to the aggregator (zero calls).
3. **Aquarius LP overlap kept.** Hub 3 (AMM) holds Aquarius LP tokens that are also counted
   inside the Aquarius pools we track (≈ $2k at recon). Kept and documented; no exclusion.
   XOXNO IS folded into the canonical network-TVL sum (`network_tvl_snapshots` excludes only
   DeFindex), so the network figure rises by ≈ $145k at deploy, ≈ $2k of it overlapping.
4. **Licence posture: on-chain reads only.** The XOXNO lending repository is PolyForm
   Noncommercial. Everything in the adapter was derived from the on-chain WASM spec
   (`contractspecv0`) and read-only simulations; no code is vendored and no XOXNO HTTP API is
   called on the pipeline. Deriving amounts from the accrual math (indexes) was therefore ruled
   out: the adapter reads the accrued VIEWS (`get_supplied_amount`, `get_borrowed_amount`,
   `get_utilisation`, `get_deposit_rate`, `get_borrow_rate`) every refresh.
5. **Static params cached 24 h.** `get_sync_data` (decimals, interest-rate model, reserve
   factor) is read at most once per 24 h per hub, cached in the hub entity's metadata
   (`paramsCache`, DB-backed, no new infra), invalidated by a controller app-version change or a
   market missing from the cache, and forceable with `XOXNO_PARAMS_REFRESH=1`.
6. **Venue naming / brand.** Venue display name `XOXNO` (the UI adds the type label); the chip
   shows the monogram until XOXNO provides an official mark with permission.

## As-implemented

- Adapter: `apps/indexer/src/lib/protocols/xoxno/` (`fetch-hub-state.ts`, `persist-hub-state.ts`,
  `compute-pool-metrics.ts`, `persist-pool-metrics.ts`, `pricing-scope.ts`, `types.ts`);
  runner `src/scripts/ingest/run-xoxno-hub-refresh.ts` (step 6c of `71-refresh-all-metrics.ts`,
  before the protocol rollup); bootstrap `src/scripts/bootstrap/xoxno-upsert-core.ts` +
  `registries/core-registry.json`.
- Pricing rules: `scripts/shared/pricing-config.ts` (rule kind `external`, 14 markers, `USDT0`
  oracle rule); step 62 skips `external` symbols silently.
- API: `stellar.service.ts getPoolSeries` picks the amount leg per venue
  (`stellar.pool-series-amount.spec.ts`); ops label `STEP_LABELS.xoxno`.
- Web: theme/meta entries (monogram), pool detail copy, lending action gated to Blend.
- Evidence and numbers: `docs/evidence/lot-xo/`.
