# XLM price fallback — recon (read-only, 2026-09-29)

Trigger: keyless CoinGecko access is blocked from datacenter IPs (CloudFront 403 "Request
blocked" since ~06:30Z, same from the VPS and from a residential connection). Branch
`fix/xlm-price-fallback` from `main` (`0e3acb9`). Every statement below traces to a file at
that commit; prod-side facts still to confirm are marked **[prod query]**.

## a) Where the XLM price is produced, stored, consumed

**Two producers call CoinGecko keyless on every refresh, not one:**

| Step (order in `71-refresh-all-metrics.ts`) | Script | CoinGecko call | On failure |
|---|---|---|---|
| 1 `prices:reference` | `62-price-reference-assets.ts` | `simple/price?ids=stellar,bitcoin,<configured ids>` (`fetchCoinGeckoPrices`, already sends `x-cg-demo-api-key` when `COINGECKO_API_KEY` is set) | Base XLM/BTC prices fall back to the **last `coingecko_xlm_usd` row in `asset_prices`** (source `db_cached_xlm_usd`, confidence medium), else `MANUAL_XLM_USD` / `XLM_USD_FALLBACK` env, else a hard-coded `0.165416`. That covers `proxy XLM` assets (yXLM). The **`native` asset itself** has rule `{kind: 'coingecko', id: 'stellar', fallbackEnvVar: 'MANUAL_XLM_USD'}` (`pricing-config.ts`): with an empty CoinGecko map and no env var, `resolvePriceFromRule` returns `null` and **no `native` row is inserted**. The step still reports SUCCESS (the error is absorbed into metadata). |
| 9 `network-stats` | `73-network-stats-refresh.ts` | `simple/price?ids=stellar&vs_currencies=usd&include_24hr_change=true` (`safeGetXlmPrice`) | `{priceUsd: null, change24hPct: null}` + `console.warn('safeGetXlmPrice failed: HTTP 403 …')` — this is the log line observed. Written as NULL into `network_stats_latest`. |

**Storage (existing, no schema change needed):**
- `network_stats_latest` (single row, `scope='global'`): `xlm_price_usd`, `xlm_price_change_24h_pct`, `metadata jsonb` (`stellar_v1_metrics.sql:55-72`). Written only by step 9.
- `asset_prices` (`asset_id, price_usd, source text, observed_at, metadata jsonb`, unique on `(asset_id, source, observed_at)`, `stellar_v1.sql:142-151`). `native` rows written by step 1 (source `coingecko_xlm_usd` via rule `coingecko_direct` — see note below), USDC rows as `manual_stable` = 1.

**Consumers, and what is wrong today:**

| Consumer | Read rule | Effect of the outage |
|---|---|---|
| `GET /v1/network/stats` (`network.service.ts`) → web `useNetworkStats` → `DashboardView` XLM tile | `network_stats_latest` row as is | **Visible**: XLM price shows `—`, 24h change shows `—` (`formatPct(null)`), colour defaults to green. No crash. |
| Pool TVL / top assets / pool series / flows USD (`stellar.service.ts:269, 555, 802-810, 937, 1015`) | **latest `asset_prices` row by `observed_at`, any source, no max age** | **Silent**: every XLM-denominated USD figure (XLM pools TVL, network TVL sum, top assets) uses the last CoinGecko price before ~06:30Z — frozen, drifting with the market for as long as the block lasts. Not empty, wrong by drift. |
| Indexer pool metrics writers (`persist-pair-metrics.ts`, `compute-pool-metrics.ts`, `persist-pool-metrics.ts`, `persist-vault-metrics.ts`, `shared/prices.ts`) | same "latest, any source" (`getLatestAssetPricesMap`) | same frozen price baked into `pool_metrics_latest.tvl_usd` and `network_tvl_snapshots`. |
| Wallet balance snapshots (`80-stellar-wallet-balance-snapshots.ts:128-133`) → portfolio USD of XLM holdings | same | **Silent**: portfolio XLM valuation frozen at the pre-outage price. |
| Faucet witness pricing (`witness.service.ts:307-311`, `PRICE_MAX_AGE = '24 hours'`, `computeNotionalXlm`) | latest row **within 24h** | Native-direct legs unaffected; USD-cross legs become `unpriceable` once the last `native` row is > 24h old (≈ 06:30Z tomorrow). No campaign live today. |
| `#status` "Price sources" tile | see c) | **Correct**: shows the upstream failing. |

Note on sources: at `0e3acb9` a healthy run writes `native` as `coingecko_direct` (rule kind
`coingecko`), while `getLatestPriceBySource(client, 'coingecko_xlm_usd')` — the step-1 DB
fallback — looks for the source name of the *base* resolution. Whether any `coingecko_xlm_usd`
row exists for `native` is a **[prod query]** (see §e); if none, the step-1 fallback for
proxies is the env/hard-coded value, confidence low.

## b) Step order and where a fallback can get the derived price

Order: step 1 `prices:reference` → step 2 `prices:soroswap-derived` (one run of
`63-price-soroswap-derived.ts` per Soroswap pool) → … → step 9 `network-stats`.

What step 2 really does (`63`, lines 88-160): for a pair it derives a price **only for the
reserve asset that has no price at all** (`price1 === null` or `price0 === null`), from the
other asset's latest price. For `soroswap-native-usdc-pair` (XLM/USDC): USDC always has a
price (`manual_stable`), and `native` has *some* row (the stale CoinGecko one — "latest, any
source"), so **step 2 derives nothing for XLM today**. The claim "soroswap-derived already
computes a price for native" holds only if `native` has no `asset_prices` row at all —
**[prod query]** to settle.

Options for the fallback:
1. **Read a stored derived value** — nothing to read today (see above).
2. **Reorder** (step 2 before step 1) — step 2 needs a priced counter-asset, and every
   XLM-derived asset would then depend on the previous cycle's XLM; more moving parts.
3. **Compute inside step 1** from data already in the DB: the latest `reserve_snapshots` of
   `soroswap-native-usdc-pair` (`symbol`, `d_supply_scaled`, `snapshot_at`; written by step 4
   of the *previous* cycle, ≤ 15 min old in steady state). XLM/USD = USDC reserve ÷ XLM
   reserve × 1.0. No reordering, no new fetch, one query. Step 9 then reads the `native` row
   step 1 wrote **in the same run** (steps 1 → 9) instead of calling CoinGecko a second time
   when it fails.

**Proposal: option 3.** Simplest and least risky: the derivation is a pure function over
numbers already stored; step 1 gains one DB query; step 9 gains one DB read on the failure
path. A shared pure module (`scripts/shared/xlm-price.ts`) holds the selection + guard logic
so both steps use one rule and the unit test targets it.

Guard rails (all → `null`, i.e. today's behaviour, when they fail):
- reserve snapshot age ≤ 60 min (stale pool = no price);
- pool liquidity: USDC reserve ≥ 50 000 USDC (the XLM/USDC pool is the deepest Soroswap
  pair; a thin pool is not a price);
- bounded deviation: if a CoinGecko `native` row exists and is ≤ 6 h old, |derived − ref| /
  ref ≤ 10 %; older references do not bound (the block has already outlasted that).

Source tracing: `asset_prices.source = 'soroswap_derived_native_usdc'` (new *value* of the
existing text column) + `metadata` (pair, reserves, reference used); `network_stats_latest.metadata`
gains `xlmPriceSource: 'coingecko' | 'soroswap-derived' | 'none'` (existing jsonb column); one log
line per run naming the source.

24h change: derivable from `asset_prices` history for `native` — latest price vs the row
nearest to now − 24 h (within ± 30 min, any source); otherwise `null`. The comparison may mix
sources (CoinGecko 24 h ago vs derived now); it is recorded as such in metadata. Not invented.

## c) What the "Price sources" tile measures

`apps/indexer/src/lib/ops-metrics.ts:50-93`: every outbound HTTP call whose host is
`coingecko.com`, `llama.fi` or `stellar.expert` (or a subdomain) is sampled into the
`price-sources` target of `rpc_metrics_runs`. `apps/api/src/modules/ops/status.ts:51-72`:
per run, error rate 0 → ok; 0 < rate < 25 % → degraded; ≥ 25 % → failed; the 24h
availability counts failed segments. A refresh makes ~4 price-source calls (CoinGecko ×2 —
steps 1 and 9 —, DefiLlama stablecoins, stellar.expert USDC supply); two 403s ≈ 50 % → failed
every run, hence ~74 % failed over 24 h since 06:30Z. **The fallback does not change this**:
CoinGecko is still called first and still fails, so the tile keeps telling the truth. The
tile measures the upstream, not whether we managed to publish a price.

## d) Schema

**Zero SQL.** New source *values* in `asset_prices.source` (text), a key in
`network_stats_latest.metadata` (jsonb). No column, no table, no index.

## e) Prod facts to confirm before implementation (read-only, founder runs)

```bash
# native price rows by source, last 2 days (is there any coingecko_xlm_usd row? when did coingecko_direct stop?)
docker exec -i dig_stellar_postgres psql -U dig -d dig_stellar -Atc "select ap.source, max(ap.observed_at), count(*) from asset_prices ap join assets a on a.id = ap.asset_id where a.symbol = 'native' and ap.observed_at > now() - interval '2 days' group by 1 order by 2 desc"
# latest XLM/USDC reserves (the fallback's input) and their age
docker exec -i dig_stellar_postgres psql -U dig -d dig_stellar -Atc "select rs.symbol, rs.d_supply_scaled, rs.snapshot_at from reserve_snapshots rs join entities e on e.id = rs.entity_id where e.slug = 'soroswap-native-usdc-pair' order by rs.snapshot_at desc limit 4"
# did step 2 ever derive native? (last lines mentioning a derivation)
grep -n "derived from" /var/log/dig-stellar-refresh.log | tail -5
# is MANUAL_XLM_USD / COINGECKO_API_KEY defined for the indexer? (names only)
grep -cE '^(MANUAL_XLM_USD|XLM_USD_FALLBACK|COINGECKO_API_KEY)=' /root/dig-stellar/apps/indexer/.env
```

## f) Optional Demo key — probe from the VPS (founder creates the key)

Step 1 already reads `COINGECKO_API_KEY` and sends `x-cg-demo-api-key`; the hotfix makes
step 9 do the same (one env name, the existing one). Whether a Demo key passes the CloudFront
block is unknown — the WAF may key on IP. Probe without putting the key in argv/history:
```bash
set +o history; read -rs CG_KEY; echo
curl -s -o /dev/null -w 'keyless=%{http_code}\n' 'https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=usd'
curl -s -o /dev/null -w 'demo-key=%{http_code}\n' -H "x-cg-demo-api-key: $CG_KEY" 'https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=usd'
unset CG_KEY; set -o history
```
`200` on the second line = the key passes; it then goes into `apps/indexer/.env` only.

## g) Test plan (no new dependency)

`apps/indexer` has no test runner. Node's built-in runner with the existing `tsx` loader works
(verified locally on Node 24: `node --import tsx --test <file>.test.ts` → pass). The hotfix
replaces the placeholder `"test": "echo … exit 1"` with `node --import tsx --test
'src/**/*.test.ts'` and adds `scripts/shared/xlm-price.test.ts` covering: CoinGecko ok →
`coingecko`; CoinGecko failed + derived within guards → `soroswap-derived`; guard failures
(stale reserves / thin pool / deviation) → `none`. CI wiring is AD1's job, not this hotfix.

## h) Follow-ups outside this hotfix

- Consumers read "latest `asset_prices` row, any source, no max age" (API + indexer writers
  + wallet snapshots): a dead feed freezes prices silently. A max-age rule (like the witness's
  24 h) is a separate change.
- Step-1 base-price fallback looks for source `coingecko_xlm_usd` while `native` is written as
  `coingecko_direct` — to reconcile after the [prod query].
