# Price sources v2 — phase A2: max-age rule on every price reader (code + tests, 2026-09-29)

**Not deployed tonight.** Branch `fix/price-max-age` from `main` (`54fb9b6`). Zero SQL.
A1 (`fdd370b`) gave every asset with a qualifying pool a fresh on-chain row; A2 makes a row
that is too old count as **absent**, so BTC / xSolvBTC / USDGLO (and any future dead feed)
stop being served from their last row, and a pool with no priced reserve gets `tvl_usd = NULL`
instead of `$0`.

## Rule

One threshold, **`priceMaxAgeMinutes()` = `PRICE_MAX_AGE_MINUTES`, else
`FRESHNESS_STALE_AFTER_MINUTES`, else 45** — the product's existing venue staleness
definition (`/health` reports `staleAfterSeconds: 2700`). A price row is normally 8–23 min old
when read (15-min cadence, 7–8 min runs); 45 min = two missed runs. Applied as one SQL fragment
on both sides: indexer `shared/prices.ts` `freshPriceSql(alias)` and API
`common/freshness.ts` `freshPriceSql(alias)` → `<alias>.observed_at > now() - interval 'N minutes'`.
The faucet witness keeps its own 24 h rule (`witness.service.ts`, untouched).

## Readers changed (every reader of `00-recon.md` §d)

| Reader | Change |
|---|---|
| `shared/prices.ts` `getLatestAssetPricesMap` (SDEX metrics, Allbridge flows) | fresh filter |
| `soroswap/persist-pair-metrics.ts`, `aquarius/persist-pool-metrics.ts` | fresh filter; TVL via `tvlFromLegs` → **NULL when no reserve is priced**, partial sum otherwise; warning line |
| `blend/compute-pool-metrics.ts` (+ `blend/types.ts`) | fresh filter; `tvlUsd` / `netLiquidityUsd` NULL when no reserve is priced |
| `stellar-native/persist-pool-metrics.ts` | TVL via `tvlFromLegs` (NULL when no leg is priced) — filter comes from the helper |
| `defindex/persist-vault-metrics.ts` (+ `defindex/types.ts`) | fresh filter in the lateral subquery; TVL NULL when no holding is priced |
| `wallets/80-stellar-wallet-balance-snapshots.ts` | fresh filter (`balance_usd` was already NULL without a price) |
| `63-price-soroswap-derived.ts` | uses the shared fragment (was an inline interval since A1) |
| API `stellar.service.ts` — top assets (`getProtocols`) | fresh filter; `tvl_usd` NULL instead of `coalesce(…, 0)`; ranked `nulls last` |
| API — pool detail reserves (`getPoolDetail`) | fresh filter → `price_usd` NULL |
| API — pool flows (`getPoolFlows`) | fresh filter on both legs (an unpriced leg contributes 0 USD, unchanged semantics) |
| API — pool TVL series (`getPoolSeries`) | fresh filter; `case when count(p.price_usd) = 0 then null …` → a snapshot with no priced reserve is a **gap** (the reducer already skips NULL), never a `$0` point |
| API — stellar-native token breakdown (`getStellarNativeTokens`) | fresh filter |

Not changed: the two `exists (select 1 from asset_prices …)` in the flow *filter* (they only gate
"has ever been priceable"; the USD value itself uses the fresh rule) and the witness.
`network_tvl_snapshots` (step 70) sums `pool_metrics_latest.tvl_usd` with SQL `sum`, which
ignores NULLs — an unpriced pool contributes nothing, as before it contributed 0.

## What the UI shows when a price is absent (verified in the web code, unchanged)

- Dashboard XLM tile / 24 h change: `—` (already).
- Pool detail: reserve price column `—` (`formatUsd(null)`); pool TVL **`—` instead of `$0`**
  when no reserve is priced (`formatUsd(null)`); a partially priced pool shows the partial sum
  (follow-up: a "partially priced" label).
- Top assets (protocol cards): an unpriced asset shows `—` and ranks last.
- Pool TVL series: the day is a gap, not a `$0` point.
- Portfolio: the asset group keeps its amount with `priced: false`, no USD (already).
- Alerts on price: never fire on `null`; the UI prints `—` (already).
- **Flagged, not corrected:** `useProtocol.ts` filters pools with `(tvlUsd ?? 0) < MIN_POOL_TVL_USD`
  (100), so a pool whose TVL becomes NULL **disappears from the protocol's pool list** until
  it is priced again. Same for the sort in `ProtocolsView.vue` (`tvlUsd ?? 0`).

## Tests

- Indexer (`pnpm -C apps/indexer test`, node:test): 14 pass — the 11 of A1 plus
  `prices.test.ts`: env precedence and garbage handling for `priceMaxAgeMinutes`, the SQL
  fragment (integer minutes, alias), `tvlFromLegs` (NULL when nothing priced, partial sum,
  empty pool).
- API (`pnpm -C apps/api test`, jest): **16 suites, 153 tests pass** — new
  `stellar.price-max-age.spec.ts` (helper precedence; `getProtocols` SQL has the filter, no
  `coalesce(…, 0)`, `nulls last`; `getPoolSeries` SQL has the filter and the NULL guard; the
  reducer drops a NULL point). The 2026-09-28 supplied-side spec is updated for the NULL guard
  wrapper and still pins `b_supply_scaled`. `nest build` OK.
- `tsc --noEmit` (indexer): no error in the touched files.

## Local captures (local Postgres, 2026-09-29 17:47–17:48Z)

Prices older than 45 min → the pool has no TVL:
```
[soroswap] soroswap-native-usdc-pair: no reserve priced (0/2) — tvl_usd = null      # last local price rows > 45 min old
[aquarius] aquarius-xsolvbtc-solvbtc-pool: no reserve priced (0/2) — tvl_usd = null
pool_metrics_latest: aquarius-xsolvbtc-solvbtc-pool | tvl_usd NULL | net_liquidity_usd NULL | 17:47:44Z
                     soroswap-native-usdc-pair      | tvl_usd NULL | net_liquidity_usd NULL | 17:47:40Z
```
Then step 1 writes a fresh native row (`onchain_soroswap_xlm_usdc` 0.22169) and the pair is
refreshed again → both legs priced → numeric TVL:
```
price source: native onchain (onchain_soroswap_xlm_usdc) => 0.22168994201847594
soroswap-native-usdc-pair | tvl_usd 132461.05 | 17:48:02Z
aquarius-xsolvbtc-solvbtc-pool | tvl_usd NULL                          # still no fresh price for either leg
```

## Expected effect in prod (from the A1 verification, `03-*`)

BTC and xSolvBTC (last row 69 846 at 17:00Z) and USDGLO (last row 06:30Z) become absent at the
first refresh after the deploy: their pools' TVL drops their contribution (SolvBTC keeps its
live on-chain price, so `aquarius-xsolvbtc-solvbtc-pool` → **partial sum (SolvBTC leg only)**,
not NULL — corrected 2026-10-14, the local capture above showed NULL only because both legs
were stale locally; `aquarius-usdglo-usdc-pool` → partial (USDC leg only);
`aquarius-btc-usdc-clpool` / `btc-eth` → BTC leg absent). Every other asset has a fresh
on-chain row each run, so nothing else changes. Wallet snapshots price holdings of those three
assets as NULL (no USD) from the next wallet refresh.

## Deploy (founder executes; **the API changes → build + restart are mandatory**)

Right after a refresh ends (:09 / :24 / :39 / :54). No `apt` expected (`NEEDRESTART_MODE=l` if
one were needed).

```bash
export PATH=/root/.nvm/versions/node/v24.19.0/bin:$PATH
cd /root/dig-stellar
git status --short                                          # must print NOTHING
git fetch origin && git merge --ff-only origin/main && git log -1 --format='%h %ci %s'
pnpm install --frozen-lockfile
pnpm -C packages/db prisma:generate
pnpm -C apps/api build                                      # REQUIRED: stellar.service.ts changed
cd /root/dig-stellar/apps/api
GIT_SHA=$(git -C /root/dig-stellar rev-parse --short HEAD) pm2 restart dig-stellar-api --update-env && pm2 save
sleep 3; curl -s http://127.0.0.1:3000/health | head -c 200; echo     # version == HEAD, db.ok true
```

Verification at the next refresh tick:
```bash
grep -n "tvl_usd = null\|no reserve priced\|no holding priced\|fresh-price window" /var/log/dig-stellar-refresh.log | tail -12
# Q1: every asset with its source and age (BTC / xSolvBTC / USDGLO must be > 45 min and absent from reads)
docker exec -i dig_stellar_postgres psql -U dig -d dig_stellar -Atc "select a.symbol, ap.source, round(ap.price_usd::numeric, 6) as price_usd, ap.observed_at, round(extract(epoch from (now() - ap.observed_at))/60) as age_min from (select distinct on (asset_id) * from asset_prices order by asset_id, observed_at desc) ap join assets a on a.id = ap.asset_id where a.chain = 'stellar-mainnet' order by age_min desc, a.symbol"
# pools whose TVL became NULL / partial
docker exec -i dig_stellar_postgres psql -U dig -d dig_stellar -Atc "select e.slug, pm.tvl_usd, pm.as_of from pool_metrics_latest pm join entities e on e.id = pm.entity_id where pm.tvl_usd is null or e.slug in ('aquarius-xsolvbtc-solvbtc-pool','aquarius-usdglo-usdc-pool','aquarius-btc-usdc-clpool','aquarius-btc-eth-pool') order by 1"
# API: pool detail of a pool with an unpriced reserve → priceUsd null; series → gap
curl -s https://stellar-api.getdig.ai/v1/pools/aquarius-xsolvbtc-solvbtc-pool | head -c 600; echo
curl -s https://stellar-api.getdig.ai/v1/network/stats | head -c 400; echo
```
Expected: `/health` version == HEAD; the xSolvBTC/SolvBTC pool shows its SolvBTC leg only
(partial sum, `priceUsd: null` on the xSolvBTC reserve); USDGLO/USDC shows only its USDC leg;
BTC/USDC shows only its USDC leg; `network/stats` TVL moves by the removed contributions only.
A pool with **no** priced reserve would show `tvlUsd: null` / `—` and drop out of the protocol
pool list under the $100 floor (flagged above) — no prod pool is in that case today.

**Deployment decision (2026-10-14):** A2 does **not** ship alone. It ships in one deployment
with A2-bis (below) and phase B (`05-phase-b-design.md`), so BTC / xSolvBTC / USDGLO go
straight from their dead row to a real price without ever showing `—`. The null rule is a
safety net that must practically never trigger.

## A2-bis (2026-10-14) — alert evaluator + pool list ordering

The 2026-10-14 review found three `asset_prices` readers outside the A2 rule, all in
`apps/api/src/modules/alerts/alerts.repository.ts`, plus one ordering gap. Fixed, zero SQL:

| Reader | Before | After |
|---|---|---|
| `latestPricesByAsset` (price family, `83-evaluate-alerts.ts`) | newest row, any age → a BTC rule evaluated against the 15-day-old 69 846 | `freshPriceSql('ap')`; a stale asset is absent from the map → the evaluator logs `no fresh price … — skipped`, state untouched (neither fires nor resolves) |
| `getPoolTvlWindows` (TVL-drop family) | `coalesce(px.price_usd, 0)` on the newest row of any age → a price turning absent read as a reserve worth $0 = a fake drop | fresh filter on the lateral; batch `tvl_usd` is `NULL` when `count(px.price_usd) < count(*)` (any unpriced reserve, i.e. null **or partial** TVL); the evaluator skips the pool for the run with `unpriced reserve in pool … (x/y priced) — skipped`. Consequence: a pool holding a reserve that is never priced is never TVL-drop-evaluated (before, that reserve silently counted $0) — acceptable, every perimeter reserve is on the pricing path |
| `listPricedAssets` (rule modal) | own 7-day window | aligned on the rule: the modal offers an asset IFF the evaluator would have data for it this sweep (the constant's stated honesty rule) — an asset is not creatable during an outage longer than the window, which is the honest answer |
| `GET /v1/pools?sort=…` | `order by pml.tvl_usd desc` → Postgres puts NULLs first | `nulls last` on every non-default sort column |

Tests: `alerts.price-max-age.spec.ts` (3 SQL shapes + NULL-window mapping) and a `getPools`
ordering case in `stellar.price-max-age.spec.ts` → API **17 suites, 158 tests pass**, `nest build`
OK. Unchanged: the `exists (select 1 from asset_prices …)` flow filters (gate "ever priceable"
only), step-1 internal readers (`xlm-price-db.ts`: own 6 h reference / 24 h change windows),
step 9 (`SAME_RUN_MAX_AGE_MS` 20 min on the native row), the faucet witness (24 h).

## Follow-ups

- "Partially priced" label on pool detail / protocol cards; keep NULL-TVL pools visible in the
  protocol list with `—` instead of hiding them under the $100 floor.
- Phase B: Reflector as primary + reference (BTC/ETH/USDGLO regain a price).
