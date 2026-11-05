# Price sources v2 — recon (read-only, 2026-09-29 16:23–16:45Z)

Goal: take CoinGecko off the critical path and give every priced asset a real price or an
explicit "no price". Branch `fix/price-sources-v2` from `main` (`9bf1b70`). Every statement
traces to a file at that commit, a local command, a read-only Soroban RPC simulation, or an
official doc page named inline. Prod figures are still to come from the founder's queries (§i).

## a) Inventory — every asset with a pricing rule, how it is priced today, product weight

Rules: `apps/indexer/src/scripts/shared/pricing-config.ts`. Writers of `asset_prices`: step 1
`62-price-reference-assets.ts` (one row per asset per run) and step 2
`63-price-soroswap-derived.ts` (derives the *unpriced* asset of a Soroswap pair — runs over
Soroswap pools only, `71-refresh-all-metrics.ts:288-300`). Nothing else writes prices.

Pools per asset come from the committed registry (`core-registry.json`, AMM pools) plus the
Blend/DeFindex reserve lists (from `reserve_snapshots`, local DB shape — prod list from §i Q2).
"Weight" below is the local-DB shape of Q2 (sum of `tvl_usd` of the pools that contain the
asset); prod numbers replace it once Q2 runs there.

| Asset | Rule today | State since 06:30Z | Pools containing it (venues) | Weight (local shape) |
|---|---|---|---|---|
| native (XLM) | coingecko → on-chain fallback (hotfix e982fb2) | live, `onchain_sdex_xlm_usdc` | 13 pools: Aquarius ×7, Soroswap ×2, Blend ×4; SDEX pools | ~207 M |
| USDC | stable 1 (`manual_stable`) | fine | 21 pools (every venue) | ~213 M |
| USTRY | coingecko `etherfuse-ustry` | **frozen** (last CG row) | aquarius-ustry-usdc-pool, soroswap-ustry-usdc-pair, Blend ×4 | ~193 M (Blend-dominated) |
| CETES | manual, **hard-coded 0.069** (Lot P ruling) | fixed value, ~5 % off the oracle | aquarius-cetes-usdc-pool, Blend ×4 | ~193 M |
| EURC | manual, **hard-coded 1.16** | fixed value, ~3 % off the oracle | soroswap-usdc-eurc-pair, soroswap-native-eurc-pair, SDEX USDC/EURC + XLM/EURC, Blend ×2 | ~191 M |
| TESOURO | coingecko `etherfuse-tesouro` | **frozen** | aquarius-usdc-tesouro-pool, Blend ×3 | ~190 M |
| SolvBTC / xSolvBTC | proxy BTC → coingecko `bitcoin` | **frozen** | aquarius-native-solvbtc-pool, aquarius-xsolvbtc-solvbtc-pool | ~22 M / ~14 M |
| PYUSD | stable 1 | fine (peg assumed) | Aquarius ×2, blend-yieldblox | ~9 M |
| AQUA | coingecko `aquarius` | **frozen** | Aquarius ×4 (vs USDC, vs XLM), SDEX XLM/AQUA + USDC/AQUA, blend-yieldblox | ~2.8 M |
| USDY | coingecko `ondo-us-dollar-yield` | **frozen** | aquarius-usdy-usdc-pool | ~2.0 M |
| yXLM | proxy XLM | live (`xlm_proxy:…`) | Aquarius ×2, SDEX XLM/yXLM | ~1.6 M |
| USDGLO | coingecko `glo-dollar` | **frozen** | aquarius-usdglo-usdc-pool, blend-yieldblox | ~0.8 M |
| yUSDC | stable 1 | fine (peg assumed) | aquarius-usdc-yusdc-pool, SDEX | ~0.8 M |
| ETH | coingecko `ethereum` | **frozen** | aquarius-eth-usdc-pool, aquarius-btc-eth-pool | ~0.7 M |
| BTC | proxy BTC → coingecko | **frozen** | aquarius-btc-usdc-clpool (concentrated), aquarius-btc-eth-pool | ~0.6 M |
| oUSD | stable 1 | fine (peg assumed) | blend-orbit-pool | ~0.2 M |

Key fact: the four Blend pools (the bulk of tracked TVL) hold USTRY, CETES, EURC, TESOURO —
all frozen or hard-coded today. This is the highest-weight defect, above BTC/ETH.

Wallets: `wallet_balance_snapshots` prices every held asset from the same `asset_prices`
rows (`80-stellar-wallet-balance-snapshots.ts:128-133`); Q3 gives the prod holdings per asset.

## b) On-chain sources already captured, per non-XLM CoinGecko asset

Only constant-product pools give a spot price from reserves (Aquarius `pool_type:
constant_product`, every Soroswap pair, every SDEX liquidity pool). Concentrated pools
(`*-clpool`) are excluded. Direct = paired with USDC; two-hop = paired with XLM, priced through
the XLM/USD already resolved in the same run (step 1 resolves XLM first).

| Asset | Direct vs USDC | Two-hop vs XLM | Notes |
|---|---|---|---|
| USTRY | aquarius-ustry-usdc-pool, soroswap-ustry-usdc-pair | — | deepest wins |
| CETES | aquarius-cetes-usdc-pool (~2.4 M per the Lot P ruling) | — | replaces the hard-coded 0.069 |
| EURC | soroswap-usdc-eurc-pair, SDEX USDC/EURC | soroswap-native-eurc-pair, SDEX XLM/EURC | replaces the hard-coded 1.16 |
| TESOURO | aquarius-usdc-tesouro-pool | — | |
| AQUA | aquarius-aqua-usdc-pool, SDEX USDC/AQUA | aquarius-native-aqua-pool, SDEX XLM/AQUA | |
| USDY | aquarius-usdy-usdc-pool | — | |
| USDGLO | aquarius-usdglo-usdc-pool | — | |
| ETH | aquarius-eth-usdc-pool | — | depth to check in prod (Q2) |
| SolvBTC | — | aquarius-native-solvbtc-pool | two-hop; xSolvBTC via xsolvbtc-solvbtc = three hops (not in phase A) |
| BTC (Stellar asset) | only a concentrated pool | — | **no on-chain spot in phase A → null**, Reflector in phase B |

Generalisation of `shared/xlm-price.ts` without rewriting it: the candidate becomes
`{ assetReserve, quoteReserveUsd, quoteKind: 'usdc' | 'xlm', observedAt, pool, source }`,
`poolImpliedXlmUsd` becomes `poolImpliedPriceUsd = quoteReserveUsd / assetReserve` (for an XLM
quote, `quoteReserveUsd = xlmReserve × xlmUsd`), and the three guards stay exactly as they are
(reserves ≤ 60 min, quote side ≥ 50 000 USD, ≤ 10 % deviation vs a CoinGecko reference younger
than 6 h — which, with CoinGecko no longer called, only ever applies to rows that predate
this change; after that liquidity and freshness are the protections). `selectXlmPrice` is
kept as a thin wrapper so the 8 existing tests keep passing; a generic loader in
`xlm-price-db.ts` builds candidates for any symbol from the same three tables.

## c) BTC / ETH and their proxies — Reflector feasibility (verified, no invented id)

Dependents: BTC (Stellar asset), SolvBTC, xSolvBTC (proxy BTC), ETH — weight ≈ 37 M in the
local shape, dominated by the two SolvBTC pools.

Contract ids come from the official Stellar docs page "Oracle Providers"
(`developers.stellar.org/docs/data/oracles/oracle-providers`), which lists the three public
Reflector mainnet contracts; everything else below was read **on-chain** with a read-only
`simulateTransaction` against `https://mainnet.sorobanrpc.com` on 2026-09-29 16:25Z (no key,
no signing; the interface names come from `github.com/reflector-network/reflector-contract`):

| Contract (official docs) | `base()` | `decimals()` | `resolution()` | `history_retention_period()` | Feeds relevant to us |
|---|---|---|---|---|---|
| `CAFJZQWSED6YAWZU3GWRTOCNPPCGBN32L7QV43XX5LZLFTK6JLN34DLN` — "External CEXs & DEXs" | `Other("USD")` | 14 | 300 s | 86 400 s | `Other`: BTC, ETH, USDT, XRP, SOL, USDC, ADA, AVAX, DOT, MATIC, LINK, DAI, ATOM, XLM, UNI, EURC |
| `CALI2BYU2JE6WVRUFYTS6MSBNEHGJ35P4AVCZYF3B6QOE3QKOB2PLE6M` — "Stellar Mainnet DEX" | `Stellar(CCW67…MI75)` = USDC | 14 | 300 s | 86 400 s | 52 Stellar assets; of ours: native, AQUA, yUSDC, EURC, USDGLO, CETES, USTRY, TESOURO, SolvBTC, PYUSD |
| `CBKGPWGKSKZF52CFHMTRR23TBWTPMRDIYZ4O2P5VS65BMHYH4DXMCJZC` — "Fiat exchange rates" | not probed | | | | not needed |

Live reads (`lastprice`, price / 10^14): CEX/DEX BTC **83 080.65**, ETH **2 676.55**, XLM
**0.22598**, USDC 1.0002 (timestamp 16:20:00Z); Stellar DEX: native 0.22633, AQUA 0.000377,
EURC 1.1271, USTRY 1.0761, TESOURO 0.2415, CETES 0.06557, USDGLO 0.99997, SolvBTC 83 368.8,
PYUSD 0.9987, yUSDC 0.9998 (16:25:00Z). Not in either feed: BTC/ETH as *Stellar* assets
(the CEX/DEX `Other` feed is the proxy), USDY, xSolvBTC, yXLM, oUSD.

Read method: `Contract.call('lastprice', Asset)` simulated through the Soroban RPC the
indexer already uses (`resolveRpcUrl()`), `PriceData { price: i128, timestamp: u64 }`, no key.
Verdict: **Reflector fits phase B** for BTC/ETH (proxy via `Other`) and as a second source for
the Stellar tokens above. Staleness guard = `timestamp` vs now (≤ 2 × resolution). Note for the
`#status` tile: these reads go to the RPC host, so `ops-metrics.ts` classifies them as
`soroban-rpc`, not `price-sources`, unless a contract-level classification is added.

## d) Every reader of `asset_prices`, and the proposed max-age rule

All readers take "latest row per asset, any source, **no max age**", except the faucet witness.

| Reader | Path | Query shape | Effect of a `null` price |
|---|---|---|---|
| `shared/prices.ts` `getLatestAssetPricesMap` | indexer helper — used by `stellar-native/persist-pool-metrics.ts`, `allbridge/persist-bridge-flows.ts` | `distinct on (asset_id) … order by observed_at desc` | asset absent from the map → contributes 0 |
| `soroswap/persist-pair-metrics.ts:57-61`, `aquarius/persist-pool-metrics.ts:53-57`, `blend/compute-pool-metrics.ts:42-46` | indexer, live path (own copy of the same SQL) | same | 0 contribution to `pool_metrics_latest.tvl_usd` |
| `defindex/persist-vault-metrics.ts:54-56` | indexer, live path (lateral subquery) | latest by `observed_at` | 0 |
| `63-price-soroswap-derived.ts:74-84` | step 2 | latest per asset | derives only when **no row at all** — a stale row blocks derivation |
| `wallets/80-stellar-wallet-balance-snapshots.ts:128-133` | wallet snapshots (cron + on-demand) | same | `balance_usd = null` (already handled: `priceUsd !== null ? … : null`) |
| `68-*`, `69-*`, `74-*`, `qa-reconcile.ts`, `64-*` | legacy / discovery tools, not on the live path | same | — |
| API `stellar.service.ts:269, 555, 802-810, 937, 1015` | `/v1/*` pools, top assets, series, flows | lateral `order by observed_at desc limit 1` (+ `coalesce(…, 0)` for TVL) | TVL contributions 0; `price_usd` null passed through |
| API `witness.service.ts:307-311` | faucet witness | `observed_at > now() - interval '24 hours'` | `unpriceable` leg — **kept as is** |

Proposed rule: **one threshold, 45 minutes**, the product's existing staleness definition
(`FRESHNESS_STALE_AFTER_MINUTES`, default 45, `apps/api/src/common/freshness.ts`; `/health`
reports `staleAfterSeconds: 2700`). Justification: the refresh cadence is 15 min and a run
takes 7–8 min, so a price row is normally 8–23 min old when read; 45 min = two missed runs,
the same tolerance venues get before being shown as stale. Where: indexer — a shared SQL
fragment in `shared/prices.ts` (`FRESH_PRICE_INTERVAL`, env `PRICE_MAX_AGE_MINUTES` default 45)
applied in `getLatestAssetPricesMap` and the four inline copies + step 2's "no fresh row"
condition + wallet snapshots; API — the same interval constant appended to the five lateral
subqueries (`and ap.observed_at > now() - interval '45 minutes'`), witness untouched.

What the UI shows when a price becomes `null` (verified in the web code):
- Dashboard XLM tile / 24 h: `—` (`formatPrice(null)`, `formatPct(null)`) — already.
- Pool detail reserves table: price column `—` (`formatUsd(null)`) — already. Pool TVL: the
  API sums `coalesce(price, 0)`, so a pool whose reserves are **all** unpriced shows **`$0`**
  (`formatUsd(0)`), and a partially priced pool shows a silently lower TVL. Proposal (API,
  small): `tvl_usd = null` when no reserve is priced → `—`; partial pricing stays a follow-up.
- Protocols list: `tvlUsd ?? 0` sorts the pool last, and `useProtocol.ts` **hides** pools under
  `MIN_POOL_TVL_USD = 100` — an unpriced pool disappears from the list until priced. To state
  in the evidence; not changed in phase A.
- Portfolio: `balanceUsd ?? null` → the asset group keeps its amount with `priced: false`
  (no USD) — already handled.
- Alerts: price rules evaluate `null` as "comparison false → never fires" (`evaluate.ts`
  comment); the alerts UI prints `—` (`formatUsdPrice(null)`).
- Network TVL (`network_tvl_snapshots`): unpriced reserves contribute 0 — a lower sum, no
  flag. Follow-up.

## e) CoinGecko off the critical path

Call CoinGecko only when a key is configured; without a key, **no call at all**. Two key shapes
(official `docs.coingecko.com/reference/authentication`): Pro = `https://pro-api.coingecko.com/api/v3/`
+ header `x-cg-pro-api-key`; the existing code targets the Demo shape (`api.coingecko.com` +
`x-cg-demo-api-key`, env `COINGECKO_API_KEY`), which the current auth page no longer documents.
Proposal: `COINGECKO_PRO_API_KEY` → Pro base + header; `COINGECKO_API_KEY` → Demo shape kept
for compatibility; neither set → the `coingecko` rule kind resolves on-chain directly. When a
key is set and the call succeeds, CoinGecko stays the first choice (reference for the
deviation guard).

## f) `#status` "Price sources" tile after the change

`ops-metrics.ts` samples every HTTP call to `coingecko.com`, `llama.fi`, `stellar.expert`.
After phase A the price-sources calls per run are: DefiLlama stablecoin mcap (1) and
stellar.expert USDC supply (1), both in step 9 — CoinGecko is not called. The tile then
measures exactly the external sources we still depend on and turns red if one of them fails
(≥ 25 % error rate per run = 1 failure out of 2). Reflector (phase B) is an RPC call, counted
under `soroban-rpc` unless a contract-level target is added — noted for phase B.

## g) Stablecoins and yield tokens

USDC stays `manual_stable` 1. PYUSD, yUSDC, oUSD are also `stable` rules today (peg assumed,
traced as `manual_stable`) — unchanged in phase A, Reflector Stellar DEX gives PYUSD/yUSDC in
phase B. USDGLO, USDY, USTRY, TESOURO: on-chain pool within guards, else `null` — **no
hard-coded value**. EURC and CETES lose their hard-coded `fallbackPriceUsd` (1.16 and 0.069)
for the same rule; `MANUAL_*_USD` env overrides stay as explicit, traced overrides.

## h) SQL

**Zero SQL for phase A and phase B.** New `asset_prices.source` values only (text column);
no column, table or index. Nothing here needs a migration runner.

## i) Read-only prod queries (founder runs; outputs to `01-prod-inventory.md`)

```bash
# Q1 — latest row per asset: source, price, age (minutes)
docker exec -i dig_stellar_postgres psql -U dig -d dig_stellar -Atc "select a.symbol, ap.source, round(ap.price_usd::numeric, 6) as price_usd, ap.observed_at, round(extract(epoch from (now() - ap.observed_at))/60) as age_min from (select distinct on (asset_id) * from asset_prices order by asset_id, observed_at desc) ap join assets a on a.id = ap.asset_id where a.chain = 'stellar-mainnet' order by age_min desc, a.symbol"

# Q2 — pools containing each asset + summed tvl_usd of those pools (weight)
docker exec -i dig_stellar_postgres psql -U dig -d dig_stellar -Atc "with latest as (select distinct on (rs.entity_id, rs.asset_id) rs.entity_id, rs.asset_id, rs.symbol from reserve_snapshots rs order by rs.entity_id, rs.asset_id, rs.snapshot_at desc) select l.symbol, count(distinct l.entity_id) as pools, round(sum(pm.tvl_usd)::numeric) as tvl_of_pools_containing_it, string_agg(distinct e.slug, ', ') as pools_list from latest l join entities e on e.id = l.entity_id left join pool_metrics_latest pm on pm.entity_id = l.entity_id where e.is_active group by l.symbol order by tvl_of_pools_containing_it desc nulls last"

# Q2b — depth of the candidate pools (latest reserves per pool, both legs)
docker exec -i dig_stellar_postgres psql -U dig -d dig_stellar -Atc "select e.slug, rs.symbol, round(rs.d_supply_scaled::numeric, 2) as reserve, rs.snapshot_at from (select distinct on (entity_id, asset_id) * from reserve_snapshots order by entity_id, asset_id, snapshot_at desc) rs join entities e on e.id = rs.entity_id where e.slug in ('aquarius-ustry-usdc-pool','soroswap-ustry-usdc-pair','aquarius-cetes-usdc-pool','soroswap-usdc-eurc-pair','soroswap-native-eurc-pair','aquarius-usdc-tesouro-pool','aquarius-aqua-usdc-pool','aquarius-native-aqua-pool','aquarius-usdy-usdc-pool','aquarius-usdglo-usdc-pool','aquarius-eth-usdc-pool','aquarius-native-solvbtc-pool','aquarius-xsolvbtc-solvbtc-pool') order by e.slug, rs.symbol"
docker exec -i dig_stellar_postgres psql -U dig -d dig_stellar -Atc "select e.slug, ps.snapshot_at, ps.metadata->'reserves' from (select distinct on (entity_id) * from pool_snapshots order by entity_id, snapshot_at desc) ps join entities e on e.id = ps.entity_id join venues v on v.id = e.venue_id where v.slug = 'stellar-native' order by e.slug"

# Q3 — holdings per asset across active tracked wallets
docker exec -i dig_stellar_postgres psql -U dig -d dig_stellar -Atc "select s.asset_symbol, count(distinct s.user_wallet_id) as wallets, round(sum(s.balance_scaled)::numeric, 2) as units, round(sum(s.balance_usd)::numeric) as usd from (select distinct on (user_wallet_id, asset_id) * from wallet_balance_snapshots order by user_wallet_id, asset_id, snapshot_at desc) s join user_wallets uw on uw.id = s.user_wallet_id and uw.is_active group by 1 order by usd desc nulls last"

# DeFindex DEGRADED on the last run — the step lines only
grep -n "defindex" /var/log/dig-stellar-refresh.log | tail -6
```
All four ran locally against the same schema (syntax checked); local numbers are not prod.

## Proposal

### Phase A — split in two, honest estimate

**A1 (tonight if validated by ~17:00Z / 19:00 Paris; else tomorrow morning) — ~1 h 15:**
- generalise the selection to any asset (candidate = pool reserves vs USDC or vs XLM, same
  guards, deepest wins; `selectXlmPrice` kept as a wrapper; tests extended);
- step 1: `coingecko` rules call CoinGecko only with a key (Pro or Demo shape), else on-chain;
  `manual` rules lose `fallbackPriceUsd` (EURC, CETES → on-chain; env override still honoured);
  `proxy BTC` → CoinGecko-with-key else **null** (phase B); one log line per asset naming the
  source; nothing hard-coded remains;
- step 2: derives when there is no **fresh** row (45 min), not only when there is none;
- evidence + runbook. Indexer-only change; the deploy block still rebuilds the API so
  `/health.version == HEAD` stays true.
Effect: every asset with a qualifying pool gets a fresh on-chain row this run; the readers
("latest row") pick it up immediately, which unfreezes Blend's USTRY/CETES/EURC/TESOURO, AQUA,
USDY, USDGLO, ETH (if deep enough). The tile goes green if DefiLlama + stellar.expert answer.
Assets with no qualifying source (BTC, xSolvBTC, possibly ETH/SolvBTC) keep serving their
last row until A2.

**A2 (tomorrow morning) — ~1 h 30:** the 45-minute max-age rule in all indexer readers and
the five API queries (+ `tvl_usd = null` when no reserve is priced), env
`PRICE_MAX_AGE_MINUTES`; API change → explicitly called out in the deploy block; evidence of
"no price" states in the UI.

### Phase B (later) — ~half a day
Reflector CEX/DEX for BTC/ETH (proxy via `Other`), Reflector Stellar DEX as a second source
for the Stellar tokens, staleness guard on the oracle timestamp, `soroban-rpc` vs
`price-sources` classification for the tile, PYUSD/yUSDC off the peg assumption.

Out of scope, unchanged: validators, flags, whitelists, AD1, UI beyond the `$0` → `—` case.
