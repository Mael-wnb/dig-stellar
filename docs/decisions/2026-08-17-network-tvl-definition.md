# Decision: Canonical network-TVL definition (2026-08-17)

**Status: decided (founder ruling) and implemented.**

## Ruling

The dashboard's network TVL uses **our data only**. The DefiLlama chain-TVL hero
source is dropped entirely. One writer, one table, two surfaces:

1. **Canonical sum**: computed by indexer step 70 (`70-protocol-persist-metrics.ts`,
   `persistNetworkTvlSnapshot`) and written to `network_tvl_snapshots`:
   - Σ over `pool_metrics_latest` for **active entities of tracked venues**;
   - lending pools contribute **GROSS** (total supplied); DEX pools contribute
     pool liquidity;
   - **DeFindex is EXCLUDED from the network sum**: its vault funds sit inside
     Blend pools, so counting both double-counts. Its protocol card keeps its
     own figure.
2. **Both surfaces read the same snapshot**: the hero takes the latest point of
   `GET /v1/network/tvl-series`, the chart draws the series. They can never
   disagree again.
3. **Labels**: hero headline is **“Total value tracked”** (not “total TVL”),
   with an honest secondary line **“Net TVL (supplied − borrowed)”** from the
   same snapshot (`tvl_net_usd`).
4. **History is never rewritten**: the definitional step-down (~$249M → ~$230M)
   is marked by `meta.methodologyChangeAt` (first snapshot carrying
   `tvl_net_usd`) and surfaced as a dashed guide + footnote on the chart.
   Pre-change rows keep `tvl_net_usd = NULL`; that NULL is the changeover marker.
5. `GET /v1/network/stats` keeps its other external sources (XLM price,
   stablecoin mcap, USDC supply, fees…). Only the TVL source changed:
   `stellar_tvl_usd` is now copied from the latest `network_tvl_snapshots` point
   by step 73; the DefiLlama fetch is gone.

## As-implemented

- Schema: `apps/api/src/db/stellar_v1_network_tvl.sql` (additive
  `alter table … add column if not exists tvl_net_usd numeric`).
- Writer: `apps/indexer/src/scripts/ingest/70-protocol-persist-metrics.ts`.
- Stats copy: `apps/indexer/src/scripts/ingest/73-network-stats-refresh.ts`.
- API: `apps/api/src/modules/network/network.service.ts` (per-point `tvlNetUsd`,
  `meta.methodologyChangeAt`).
- Web: hero (`DashboardView.vue`) reads the latest tvl-series point;
  `NetworkTvlChart.vue` shows the changeover guide + footnote and a Net row in
  the tooltip.

## Validation evidence (local, 2026-08-17)

Per-venue itemization (`pool_metrics_latest`, active entities):

| Venue          | Pools | Gross TVL (USD) | Borrowed (USD) | Net (USD)   |
|----------------|------:|----------------:|---------------:|------------:|
| blend          |     4 |     181,468,448 |     43,575,002 | 137,893,446 |
| aquarius       |    21 |      42,016,980 |              0 |  42,016,980 |
| stellar-native |    60 |       5,395,377 |              0 |   5,395,377 |
| soroswap       |     4 |       1,181,135 |              0 |   1,181,135 |
| **Network (4 venues)** | | **230,061,940** | **43,575,002** | **186,486,938** |
| defindex (excluded)    | 3 | 19,309,600 | 0 | — (double-count with Blend) |

- Step 70 snapshot: `tvlUsd = 230061940.13015586`, `tvlNetUsd = 186486937.69599763`,
  `protocolCount = 4`.
- `GET /v1/network/tvl-series` latest point: `tvlUsd = 230061940.13015586`,
  `tvlNetUsd = 186486937.69599763`, **equal to the hero to the dollar** (the hero
  reads this same point). `meta.methodologyChangeAt = 2026-08-17T18:02:00Z`;
  older points (up to $249.4M under the old definition) untouched.
- `GET /v1/network/stats` → `stellarTvlUsd = 230061940.13015586` (copy of the
  same snapshot; DefiLlama gone).
- `pnpm -C apps/api build` ✓, `pnpm -C apps/api test` 122/122 ✓,
  `pnpm -C apps/web build` (vue-tsc) ✓.

## Notes

- VPS deploy requires applying the additive migration
  (`psql "$DATABASE_URL" -f apps/api/src/db/stellar_v1_network_tvl.sql`) before
  the next `job:refresh` cycle (step 70 now inserts `tvl_net_usd`).
- `apps/api` `pnpm lint` (eslint `--fix`) is **not green on main** (~650
  pre-existing errors) and rewrites dozens of unrelated files; do not run it as
  a validation step for scoped changes.
