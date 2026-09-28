# Hotfix — lending "supplied" side summed from the wrong column (2026-09-28)

**Branch:** `hotfix/lending-supplied-side` (from `main` @ `322517d`). **Scope:** `apps/api` only —
two SQL expressions + one comment in `apps/api/src/modules/stellar/stellar.service.ts`, one new
spec. No schema file, no indexer change, no web change. Post-grant hardening; surfaced by the Lot LM
L0 recon (`docs/evidence/lot-lm/l0-recon.md`, section E) and fixed first, on its own, because it
would propagate to any second lending venue.

## The bug

The indexer convention for lending reserves is **`b_supply_scaled` = supplied, `d_supply_scaled` =
borrowed** (`apps/indexer/src/lib/protocols/blend/compute-pool-metrics.ts:94-98`, commit `39d9a90`
"supplied / borrowed fixed", validated against blend.capital). Two API reads summed
`d_supply_scaled` where "supplied" was meant, so for Blend they returned **borrowed** figures:

| Query | Introduced | Served by | UI surface |
|---|---|---|---|
| `getProtocols` top-assets CTE (`stellar.service.ts:250`) | Lot Q, `eae90c5` | `GET /v1/protocols` → `topAssets[]`, `assetCount` | Protocols page cards: the up-to-3 circular asset marks + "+N" (`ProtocolsView.vue:132-138`) — ranked by borrowed value for Blend |
| `getPoolSeries` (`stellar.service.ts:930`) | Lot C, `305174a` | `GET /v1/pools/:slug/series` (lending pools only) | Pool detail TVL chart (`PoolDetailView.vue:364-380, 523-536`) whose footnote already says "Supplied × latest price" — it drew borrowed |

Column semantics per venue that flows through these queries (writer file:line):

| Venue | Writes `reserve_snapshots`? | `d_supply_scaled` | `b_supply_scaled` |
|---|---|---|---|
| Blend (`lending`) | `blend/persist-pool-state.ts:227-300` from `fetch-pool-state.ts:202-213` | dToken supply = **borrowed** | bToken supply = **supplied** |
| Soroswap (`amm`) | `soroswap/persist-pair-reserves.ts:126-166` | pair reserve (liquidity) | not written (NULL) |
| Aquarius (`amm`) | `aquarius/persist-pool-reserves.ts:126-166` | pool reserve (liquidity) | not written (NULL) |
| stellar-native (`amm`) | no (reserves in `pool_snapshots.metadata`) | — | — |
| DeFindex (`vault`) | no | — | — |

So the top-assets query must pick the column by venue type (the pattern the alerts TVL-drop query
already uses, `alerts.repository.ts:797-803`); the series query is behind an `isLending` gate and
only needs `b_supply_scaled`. Pool detail (`:658-659`) was already correct.

## The fix (`git diff`)

```diff
-          sum(coalesce(rs.d_supply_scaled, 0)) as amount
+          sum(coalesce(
+            case when v.venue_type = 'lending' then rs.b_supply_scaled else rs.d_supply_scaled end,
+            0
+          )) as amount
…
-  // per snapshot as sum(d_supply_scaled × latest asset price) — a degraded,
+  // per snapshot as sum(supplied × latest asset price), where supplied is
+  // b_supply_scaled (indexer convention: b = supplied, d = borrowed) — a degraded,
…
-        sum(rs.d_supply_scaled * coalesce(p.price_usd, 0)) as tvl_usd
+        sum(coalesce(rs.b_supply_scaled, 0) * coalesce(p.price_usd, 0)) as tvl_usd
```

## Before — production, public API, 2026-09-28 13:00 UTC

```
for s in blend-fixed-pool blend-orbit-pool blend-etherfuse-pool blend-yieldblox-pool; do
  curl -s https://stellar-api.getdig.ai/v1/pools/$s | jq '[.reserves[]|{s:(.supplied*.priceUsd),b:(.borrowed*.priceUsd)}]|{supplied:(map(.s)|add),borrowed:(map(.b)|add)}, .metrics'
  curl -s https://stellar-api.getdig.ai/v1/pools/$s/series | jq '.points[-1]'
done
curl -s https://stellar-api.getdig.ai/v1/protocols | jq '.[]|select(.id=="blend")|{tvlUsd,topAssets}'
```

| Pool | `series` last point (old = borrowed side) | Supplied side (detail reserves × price) | Pool `totalSuppliedUsd` | Pool `totalBorrowedUsd` |
|---|---|---|---|---|
| blend-fixed-pool | 35,311,430.74 | 205,622,617 | 207,131,369 | 35,313,343 |
| blend-orbit-pool | 406.99 | 191,047 | 191,057 | 407 |
| blend-etherfuse-pool | 1,563.00 | 16,436 | 16,466 | 1,570 |
| blend-yieldblox-pool | 43,034.94 | 375,888 | 378,965 | 43,145 |

Blend `topAssets` (prod, same call): USDC 35,061,760 · native 213,542 · EURC 79,820 (venue TVL
207,717,857) — USDC's *borrowed* figure ranked first.

The series equals the borrowed column to the cent. The supplied side matches each pool's own
`totalSuppliedUsd` within 0.7 % (metrics are priced at refresh time, the detail at read time).

## Before / after on the SAME data — local DB, both API builds, 2026-09-28 13:07–13:08 UTC

Local stack: `docker compose up -d postgres redis` (infra only). Local DB state: 4 Blend pools,
1,257 reserve rows, 196 Blend batches, latest batch **2026-09-03 16:10 UTC**, 756 price rows.
Procedure: branch `dist` → `PORT=3999 node dist/main.js` → capture; `git stash` the fix → `nest
build` (main) → capture; `git stash pop` → rebuild; `git diff --stat` verified intact after.

`GET /v1/pools/:slug/series`, `.points[-1]` (and full range):

| Pool | Before (main) | After (branch) | Points | First day before → after |
|---|---|---|---|---|
| blend-fixed-pool | 35,837,047.27 | **189,866,277.91** | 22 | 2026-03-19: 29,144,170.89 → 131,958,102.71 |
| blend-orbit-pool | 406.99 | **190,862.51** | 22 | 2026-03-31: 10,516.06 → 10,029,608.95 |
| blend-etherfuse-pool | 5,651.22 | **75,876.89** | 22 | 2026-03-31: 85,820.93 → 253,535.57 |
| blend-yieldblox-pool | 45,530.09 | **400,374.48** | 11 | 2026-06-26: 1,097,777.25 → 2,933,755.36 |

`GET /v1/protocols`, Blend `topAssets` (venue `tvlUsd` 190,533,392 unchanged — it comes from
`protocol_metrics_latest`, `assetCount` 10 unchanged):

| | 1st | 2nd | 3rd |
|---|---|---|---|
| Before | USDC 35,531,818 | native 256,399 | EURC 96,194 |
| After | **native 142,385,297** | **USDC 47,477,548** | **EURC 413,679** |

Non-lending venues are byte-identical before/after (aquarius, soroswap, defindex, stellar-native
`topAssets` compared with `cmp`): the `case` keeps `d_supply_scaled` for AMMs.

Cross-check against the pool's own metrics on the same local data (`psql`, latest batch per pool,
latest price per asset):

```
         slug         |        snapshot_at         | old_d_side_usd | fixed_b_side_usd | pool_total_supplied_usd | pool_total_borrowed_usd
 blend-etherfuse-pool | 2026-09-03 16:10:38.404+00 |        5651.22 |         75876.89 |                75876.89 |                 5651.22
 blend-fixed-pool     | 2026-09-03 16:10:39.874+00 |    35837047.27 |     189866277.91 |            189866277.91 |             35837047.27
 blend-orbit-pool     | 2026-09-03 16:10:41.573+00 |         406.99 |        190862.51 |               190862.51 |                  406.99
 blend-yieldblox-pool | 2026-09-03 16:10:43.993+00 |       45530.09 |        400374.48 |               400374.48 |                45530.09
```

The fixed sum equals `pool_metrics_latest.total_supplied_usd` **to the cent** on every pool; the old
sum equals `total_borrowed_usd` to the cent.

## After — production (TODO, founder, post-deploy)

<!-- TODO(founder): run after VPS deploy, paste outputs here, same commands as the "Before" block -->
```
date -u
for s in blend-fixed-pool blend-orbit-pool blend-etherfuse-pool blend-yieldblox-pool; do
  echo "$s series=$(curl -s https://stellar-api.getdig.ai/v1/pools/$s/series | jq -c '.points[-1]') totalSuppliedUsd=$(curl -s https://stellar-api.getdig.ai/v1/pools/$s | jq '.metrics.totalSuppliedUsd|round')"
done
curl -s https://stellar-api.getdig.ai/v1/protocols | jq -c '.[]|select(.id=="blend")|{tvlUsd,assetCount,topAssets:[.topAssets[]|{symbol,tvlUsd:(.tvlUsd|round)}]}'
```
Expected: each series last point ≈ that pool's `totalSuppliedUsd` (within price drift since the
last refresh); Blend top asset order likely native / USDC / EURC.

## Regression test + mutation check

`apps/api/src/modules/stellar/stellar.supplied-side.spec.ts` — mock `$queryRawUnsafe`, no DB,
asserts the SQL text of both queries (the only DB-free option; stated in the spec header).

```
===== MUTATION 1: revert top-assets expression only
  ● StellarService — lending "supplied" side reads b_supply_scaled › getProtocols top-assets CTE keys the amount on venue_type (lending → b_supply_scaled)
    Expected pattern: /case when v\.venue_type = 'lending' then rs\.b_supply_scaled else rs\.d_supply_scaled end/
Tests:       1 failed, 1 passed, 2 total
===== MUTATION 2: revert series expression only
  ● StellarService — lending "supplied" side reads b_supply_scaled › getPoolSeries (lending-only) sums b_supply_scaled × price, never d_supply_scaled
    Expected pattern: /sum\(coalesce\(rs\.b_supply_scaled, 0\) \* coalesce\(p\.price_usd, 0\)\) as tvl_usd/
Tests:       1 failed, 1 passed, 2 total
===== RESTORED: spec + build + full suite
Tests:       2 passed, 2 total
> nest build            (exit 0)
Test Suites: 15 passed, 15 total
Tests:       149 passed, 149 total     (baseline before the change: 14 suites, 147 tests)
```

## Retroactive change — stated plainly

Both queries recompute from `reserve_snapshots` at read time; nothing is stored. So the change is
**retroactive over the whole history**: every Blend pool TVL chart moves to the supplied side on
all points (Fixed pool ≈ $29–36M → ≈ $132–190M across its 22 daily points; the shape changes too,
because supplied and borrowed do not move together), and Blend's top-asset order on the Protocols
cards changes (locally USDC → native first). The numbers become true, in the same sense as the
2026-08-14 dead-reserves fix (`docs/evidence/dead-reserves-2026-08-14.md`): no data was
rewritten, the reads were wrong. `pool_metrics_latest`, protocol/venue TVL, the network TVL
snapshot and the alert evaluator were never affected (they already used the right column).

## Caching

None on this path. `apps/api` has no Redis or cache-manager dependency and no `Cache-Control` on
`/v1/protocols` or `/v1/pools/:slug/series` (only `/v1/ops/*` and faucet set `no-store`); the
response carries Express's default weak `ETag`, which only short-circuits when the body is
unchanged. The nginx site config (`docs/evidence/lot-s/nginx-site-config-deployed.conf`) has rate
limits and headers but no `proxy_cache`. The web fetches on mount with no client cache. **Values are
correct immediately after the API restart; nothing to flush.**

## Deploy note (API-only)

Per `docs/deployment.md` "API process: pm2 supervised": on the VPS `git pull` (or bundle) →
`pnpm -C apps/api build` → `GIT_SHA=$(git rev-parse --short HEAD) pm2 restart dig-stellar-api
--update-env`. No schema file, no indexer restart, no Vercel dependency. Then fill the "After —
production" block above.
