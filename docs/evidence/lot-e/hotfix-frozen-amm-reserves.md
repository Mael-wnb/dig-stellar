# Hotfix evidence — live reserve-snapshot writer for Soroswap & Aquarius

Closes the KNOWN ISSUE opened in this folder's `README.md` (frozen Soroswap/Aquarius
reserve TVL). Executed 2026-08-13 per `docs/hotfix-frozen-amm-reserves.md`.

## What changed

- New live writers on the refresh path, run every cycle BEFORE the metrics step so the
  same cycle's TVL is computed from just-fetched reserves:
  - `apps/indexer/src/lib/protocols/soroswap/persist-pair-reserves.ts`
  - `apps/indexer/src/lib/protocols/aquarius/persist-pool-reserves.ts`
  - wired into `run-soroswap-pair-refresh.ts` / `run-aquarius-pool-refresh.ts`
- Conventions mirror the Blend snapshot writer: same `reserve_snapshots` table, raw +
  scaled amounts (`d_supply_raw` / `d_supply_scaled` — the columns both AMM metrics
  readers already consume), decimals, `snapshot_at`, upsert on
  `(entity_id, asset_id, snapshot_at)`.
- Metrics read path verified correct as-is: both readers use
  `distinct on (asset_id) … order by snapshot_at desc, created_at desc` — the latest
  snapshot wins; no ordering quirk pinned the March rows. The bug was purely the
  missing writer.
- Seed demoted: `registry-export.ts` no longer exports reserve_snapshots and
  `seed-core.ts` no longer seeds them (−199 lines in the committed
  `core-registry.json`). The first `job:refresh` of a fresh clone now produces current
  rows by itself — we seed only what the first refresh cannot produce.

## Before / after TVL per pool (the delta IS how wrong the frozen values were)

Before = `pool_metrics_latest` computed 2026-08-13 ~10:20 UTC from 2026-03-19/20
reserves × live prices. After = recomputed 2026-08-13 ~11:00–12:00 UTC from live
reserves. Cross-check = the venue's own data at validation time (Aquarius: the
`amm-api.aqua.network` pool detail that app.aquarius.finance renders;
Soroswap: info.soroswap.finance now redirects to a Dune dashboard, so we used
stellar.expert's independent USD valuation of the pair contract's token balances).

| Pool | Before (frozen) | After (live) | Delta | Venue cross-check | Diff vs venue |
|---|---|---|---|---|---|
| soroswap-native-usdc-pair | $110,663 | $112,235 | +1.4% | $112,135 | +0.09% |
| soroswap-native-eurc-pair | $414,986 | $420,663 | +1.4% | $418,834 | +0.44% |
| aquarius-native-usdc-pool | $4,405,795 | $3,199,615 | **−27.4%** | $3,212,779 | −0.41% |
| aquarius-native-solvbtc-pool | $5,432,424 | $6,642,514 | **+22.3%** | $6,615,755 | +0.40% |
| aquarius-pyusd-usdc-pool | $8,028,144 | $8,029,403 | +0.02% | $8,040,737 | −0.14% |
| aquarius-xsolvbtc-solvbtc-pool | $2,244,851 | $10,799,508 | **+381%** | $10,425,770 | +3.6% |

All six recomputed TVLs land within 0.1–3.6% of the venue's own numbers (the 3.6% on
the xSolvBTC pool is BTC price-source variation between our `asset_prices` and Aqua's
oracle — normal tolerance). Raw reserve amounts match the venue exactly at snapshot
time (e.g. native-usdc: 9,982,584 XLM / 1,592,289 USDC ours vs 9,982,185 / 1,592,353
Aqua minutes later — swap drift only).

## Knock-on consumers

- Pool detail reserve bars: `pool_metrics_latest.metadata.reserveBreakdown` now carries
  live reserves (written by the same metrics step).
- Protocol totals (`70-protocol-persist-metrics.ts`): aquarius $20.11M → $28.67M,
  soroswap $0.526M → $0.533M.
- **Hero network TVL step-change (honest and expected): $230.86M (2026-08-13 10:23 UTC)
  → $239.43M (2026-08-13 12:06 UTC), i.e. +$8.57M — exactly the sum of the per-pool
  corrections.** Any chart discontinuity on 2026-08-13 is this fix, not an outage.

## Validation

- Fresh `reserve_snapshots` rows confirmed for all 6 Soroswap/Aquarius pools with
  2026-08-13 `snapshot_at`; repeat cycles accumulate rows (upsert per snapshot) as
  designed.
- `tsc --noEmit` (indexer): no errors in any changed file (pre-existing unrelated
  errors in `qa-reconcile.ts` + `@stellar/stellar-sdk` typings unchanged).
- `pnpm -C apps/api build` green; `pnpm -C apps/api test` 42/42 pass.
- `bootstrap:export` re-run (registry now 6 venues / 13 entities / 12 assets /
  40 entity_assets, no reserve section) and `bootstrap:core` re-run green against it.

## Retention note (no action now)

One row per asset per 15-min cycle across ~6 pools ≈ ~1.2k rows/day — trivial volume.
G4 recon showed Blend already accumulates 143d of history harmlessly, and pool-level
reserve history is exactly what the "Building history" charts want. Revisit pruning
only if volume ever matters.
