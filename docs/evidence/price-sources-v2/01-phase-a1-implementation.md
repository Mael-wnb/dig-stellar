# Price sources v2 — phase A1 implementation and local proof (2026-09-29)

Keyless CoinGecko access is blocked from datacenter IPs; on-chain pricing generalised to every
asset, CoinGecko off the critical path. Recon: `00-recon.md`. Branch `fix/price-sources-v2`
from `main` (`9bf1b70`). Indexer only. **Zero SQL.**

## What changed

| File | Change |
|---|---|
| `shared/xlm-price.ts` | Generic `selectPrice` for any asset: manual override > CoinGecko (if called) > deepest on-chain constant-product pool vs USDC (1 hop) or vs XLM (2 hops, via this run's XLM/USD) within the unchanged guards > `null`. `candidatesFromPools(symbol, sets, xlmUsd)` builds candidates from the pools' latest reserves (pure); three-hop pairs are never candidates. `selectXlmPrice` / `poolImpliedXlmUsd` kept as wrappers — the 8 hotfix tests pass unchanged. |
| `shared/xlm-price-db.ts` | `loadPoolReserveSets` once per run (Aquarius constant-product + Soroswap from `reserve_snapshots`, SDEX from `pool_snapshots.metadata.reserves`; `*-clpool` / `pool_type = concentrated` excluded), generic `resolveAssetPrice` (reference row + manual env + selection), `resolveXlmPrice` kept as a wrapper. |
| `shared/prices.ts` | `priceMaxAgeMinutes()` — `PRICE_MAX_AGE_MINUTES`, else `FRESHNESS_STALE_AFTER_MINUTES`, else 45. Used by step 2 tonight; every reader in A2. |
| `shared/pricing-config.ts` | `manual` rules lose `fallbackPriceUsd`: the hard-coded EURC 1.16 and CETES 0.069 are gone; the env override stays. |
| `62-price-reference-assets.ts` | Rewritten around the shared selection. CoinGecko is called **only with a key** (`COINGECKO_PRO_API_KEY` → `pro-api.coingecko.com` + `x-cg-pro-api-key`; `COINGECKO_API_KEY` → the former Demo shape); no key → no call, logged once. XLM resolved first; every other asset through `resolveRule`: `stable` unchanged, `manual` = env override > on-chain > null, `coingecko` = CoinGecko (if answered) > env fallback > on-chain > null, `proxy XLM` follows XLM, `proxy BTC` = CoinGecko bitcoin (if answered) > the asset's own on-chain pool (SolvBTC via XLM, two hops) > null. One log line per asset: `price source: <ASSET> <kind> (<source>) => <price|null>`; a `null` writes no row and logs the named rejections. The former `db_cached_*` fallbacks are gone. |
| `63-price-soroswap-derived.ts` | Derives when a pair leg has no **fresh** row (`priceMaxAgeMinutes()`), not only when it has none. |
| `xlm-price.test.ts` | +2 tests (10 total): candidate building (direct / two-hop / three-hop excluded / XLM source name kept) and generic selection (deepest wins across pools, thin pool → null, nothing → `none`, manual override traced). |
| `.env.example`, `docs/runbooks.md` | Key names, override names, `PRICE_MAX_AGE_MINUTES`; runbook section "Price sources". |

Source strings written (existing text column, no consumer filters on them — verified in the
hotfix): `coingecko_direct`, `coingecko_btc_proxy`, `manual_env`, `manual_stable`,
`onchain_<aquarius|soroswap|sdex>_<asset>_<usdc|xlm>` (XLM keeps `onchain_sdex_xlm_usdc`),
`xlm_proxy:<upstream>`. Metadata carries `pool`, `quoteKind`, `hops`, `assetReserve`,
`quoteReserveUsd`, `reservesObservedAt`, `referenceUsed`, `rejected[]`.

## Properties, written as agreed

- **A1 cannot degrade the existing state.** In `main()` a `null` resolution executes `continue`
  before the insert: no row is written, the asset's last row stays the latest and the readers
  ("latest row, any source, no max age" until A2) keep serving it exactly as today. An asset
  with a qualifying pool gets a fresh row that those readers pick up immediately. The only
  values that change are therefore prices that were frozen or hard-coded, replaced by live
  on-chain ones; nothing becomes empty that was not already. Covered by the test "nothing at
  all → null with an explicit reason" plus the `continue` at `62-price-reference-assets.ts`
  (`if (resolved.priceUsd === null) … continue`).
- **Deviation guard.** For every asset but those with a CoinGecko row younger than 6 h (none
  after this change unless a key is configured), there is no reference: **freshness (≤ 60 min)
  and liquidity (quote side ≥ 50 000 USD) are the only protections in A1.** Phase B makes
  Reflector the reference of the deviation guard.
- **Pools.** Constant-product only (`*-clpool` and `pool_type = concentrated` excluded); two
  hops allowed (EURC, AQUA, SolvBTC); three hops excluded (xSolvBTC → null); quote side
  ≥ 50 000 USD for every asset, no exception — a thin candidate is rejected by name.
- **Weight.** The "weight" column of the recon is the TVL of the pools that **contain** the
  asset — an upper bound, not the asset's share or an exposure figure.
- **Execution paths.** No builder, validator, flag or whitelist reads a price; the faucet witness
  keeps its own 24 h rule (verified in the hotfix, unchanged here).

## Unit tests

```
$ pnpm -C apps/indexer test
✔ CoinGecko answered → coingecko wins over on-chain
✔ CoinGecko failed → deepest on-chain pool within guards
✔ deepest pool stale → next deepest passing pool
✔ guards: stale reserves, thin pool, deviation vs a fresh reference → null, never a constant
✔ deviation guard is not applied against a reference older than 6h
✔ manual override wins and is traced as manual
✔ nothing at all → null with an explicit reason
✔ 24h change: nearest stored point within ±30 min, else null
✔ candidates: direct vs USDC, two hops vs XLM only when XLM/USD is known, three hops never
✔ generic selection: deepest quote side wins across pools; guards unchanged; null otherwise
ℹ tests 10 · pass 10 · fail 0
```
`tsc --noEmit`: no error in the touched files (pre-existing third-party `.d.ts` debt unchanged).

## Local end-to-end (local Postgres, no CoinGecko key, 2026-09-29 16:39–16:44Z)

Local reserves are 26 days old except the pools refreshed for the hotfix proof (SDEX pools,
Soroswap XLM/USDC) and, for this run, `aquarius-ustry-usdc-pool` (`run-aquarius-pool-refresh.ts`).

```
on-chain reserve sets loaded: 74 constant-product pools
coingecko: no API key configured — not called (on-chain pricing only)
price source: AQUA onchain (onchain_sdex_aqua_xlm) => 0.0003770904210970451
price source: BTC none (none) => null
no qualifying source for BTC: skipped this run (rejected: [{"pool":"stellar-native-btc-usdc-pool","reason":"stale reserves (160272 min)"}])
price source: CETES none (none) => null
no qualifying source for CETES: skipped this run (rejected: [{"pool":"aquarius-cetes-usdc-pool","reason":"stale reserves (37469 min)"}])
price source: EURC none (none) => null
no qualifying source for EURC: skipped this run (rejected: [{"pool":"soroswap-usdc-eurc-pair","reason":"stale reserves (37469 min)"},{"pool":"soroswap-native-eurc-pair","reason":"stale reserves (37469 min)"},{"pool":"stellar-native-eurc-usdc-pool","reason":"th…
price source: native onchain (onchain_sdex_xlm_usdc) => 0.22671797748179998
price source: oUSD stable (manual_stable) => 1
price source: PYUSD stable (manual_stable) => 1
price source: SolvBTC none (none) => null
no qualifying source for SolvBTC: skipped this run (rejected: [{"pool":"aquarius-native-solvbtc-pool","reason":"stale reserves (37468 min)"}])
price source: USDC stable (manual_stable) => 1
price source: USTRY onchain (onchain_aquarius_ustry_usdc) => 1.0760153264885464
price source: xSolvBTC none (none) => null
no qualifying source for xSolvBTC: skipped this run (rejected: [])
price source: yUSDC stable (manual_stable) => 1
price source: yXLM onchain (xlm_proxy:onchain_sdex_xlm_usdc) => 0.22671797748179998
  inserted: 8, skipped: 9, coingeckoCalled: false
```
Reads: AQUA two hops through SDEX XLM/AQUA (0.000377 — Reflector Stellar DEX read 0.000377 at
16:25Z); USTRY direct vs USDC on Aquarius (1.0760 — Reflector 1.0761); every stale pool
rejected by name; xSolvBTC has no candidate (three hops); BTC's only SDEX pool is stale;
CoinGecko never called. In prod every pool is refreshed each cycle, so the `stale reserves`
rejections above become live prices for the assets that have a qualifying pool (Q2b tells
which ones are deep enough).

Step 2 (`ENTITY_SLUG=soroswap-native-usdc-pair`): both legs fresh → nothing to derive
(unchanged behaviour when both are priced).

## Phase B note — Blend already prices its pools with Reflector

Verified in our own Blend adapter, not in a doc: the pool metadata carries an `oracle` contract
(`apps/indexer/src/lib/protocols/blend/fetch-pool-state.ts:257`) and the positions adapter
calls `pool.loadOracle()` — "the pool's Reflector oracle (USD prices, on-chain parity)"
(`fetch-user-positions.ts:4-6, 56`), which is how the Blend health factor is computed today.
Proposal for phase B: for the assets Reflector covers (native, AQUA, EURC, USDGLO, CETES,
USTRY, TESOURO, SolvBTC, PYUSD, yUSDC on the Stellar DEX contract; BTC/ETH on the CEX/DEX
contract), Reflector becomes the **primary** source (consistent with the protocol's own
figures), the pool-implied price the **fallback**, and the two cross-check each other
(Reflector ↔ pool deviation guard, staleness guard on the oracle `timestamp` ≤ 2 × 300 s).

## Deploy (founder executes; indexer-only change, full sequence kept)

Right after a refresh ends (:09 / :24 / :39 / :54). The indexer runs from the working tree via
`tsx`, so the ff-merge is the indexer deploy; install + build + restart keep
`/health.version == HEAD` true. No `apt` expected (`NEEDRESTART_MODE=l` if one were needed).

```bash
export PATH=/root/.nvm/versions/node/v24.19.0/bin:$PATH
cd /root/dig-stellar
git status --short                                          # must print NOTHING
git fetch origin && git merge --ff-only origin/main && git log -1 --format='%h %ci %s'
pnpm install --frozen-lockfile
pnpm -C packages/db prisma:generate
pnpm -C apps/api build
cd /root/dig-stellar/apps/api
GIT_SHA=$(git -C /root/dig-stellar rev-parse --short HEAD) pm2 restart dig-stellar-api --update-env && pm2 save
sleep 3; curl -s http://127.0.0.1:3000/health | head -c 200; echo     # version == HEAD, db.ok true
```

Verification at the next refresh tick:
```bash
grep -n "coingecko\|price source:\|no qualifying source" /var/log/dig-stellar-refresh.log | tail -24
# Q1 again — every asset with its source and age
docker exec -i dig_stellar_postgres psql -U dig -d dig_stellar -Atc "select a.symbol, ap.source, round(ap.price_usd::numeric, 6) as price_usd, ap.observed_at, round(extract(epoch from (now() - ap.observed_at))/60) as age_min from (select distinct on (asset_id) * from asset_prices order by asset_id, observed_at desc) ap join assets a on a.id = ap.asset_id where a.chain = 'stellar-mainnet' order by age_min desc, a.symbol"
curl -s https://stellar-api.getdig.ai/v1/network/stats | jq '{xlmPriceUsd, xlmPriceChange24hPct, stellarTvlUsd, updatedAt}'
curl -s 'https://stellar-api.getdig.ai/v1/ops/status?window=24h' | jq '.upstreams[]? | select(.target=="price-sources") | {target, state24h: .availability24h, latest: .latest}' 2>/dev/null || curl -s 'https://stellar-api.getdig.ai/v1/ops/status?window=24h' | jq '.rpc // .upstreams' | head -40
```
Expected: `coingecko: no API key configured — not called`; one `price source:` line per asset;
fresh rows (age ≤ 15 min) with `onchain_*` sources for USTRY, CETES, EURC, TESOURO, AQUA, USDY,
USDGLO and — if their pools are deep enough — ETH and SolvBTC; BTC and xSolvBTC `null`
(their last row keeps serving until A2); `network/stats` unchanged; the "Price sources" tile
turns green from the first run whose only price-source calls (DefiLlama, stellar.expert)
succeed.

## Follow-ups

- **A2 (tomorrow morning):** the 45-minute max-age rule in every indexer reader and the five
  API subqueries, `tvl_usd = null` when no reserve is priced (API change, called out in its
  deploy block), env `PRICE_MAX_AGE_MINUTES`; evidence of the UI "no price" states.
- **Phase B:** Reflector as primary + reference (above); `soroban-rpc` vs `price-sources`
  classification for the tile; PYUSD/yUSDC off the peg assumption.
- Protocols list hides pools under $100 TVL — an unpriced pool disappears from the list
  until priced (documented, not changed).
