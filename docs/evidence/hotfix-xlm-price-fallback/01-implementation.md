# XLM price fallback — implementation and local proof (2026-09-29)

Keyless CoinGecko access is blocked from datacenter IPs; an on-chain fallback is added.
Recon: `00-recon.md`. Branch `fix/xlm-price-fallback` from `main` (`0e3acb9`). Zero SQL.

## What changed

| File | Change |
|---|---|
| `apps/indexer/src/scripts/shared/xlm-price.ts` (new) | Pure selection rule: manual override > CoinGecko > deepest on-chain XLM/USDC pool within guards > `null`. Guards: reserves ≤ 60 min, ≥ 50 000 USDC, ≤ 10 % deviation vs a CoinGecko reference younger than 6 h. 24h change from stored history (nearest point to now − 24 h within ± 30 min). No I/O. |
| `apps/indexer/src/scripts/shared/xlm-price.test.ts` (new) | 8 `node:test` cases (below). |
| `apps/indexer/src/scripts/shared/xlm-price-db.ts` (new) | DB reads of data the refresh already stores: Soroswap + Aquarius constant-product reserves (`reserve_snapshots`), SDEX reserves (`pool_snapshots.metadata.reserves`), the latest CoinGecko native row (reference), the same-run native row (step 9), the 24 h history. The Aquarius concentrated pool is excluded (its reserve ratio is not a spot price). |
| `apps/indexer/src/scripts/shared/env.ts` (new) | `getOptionalNumberEnv`, shared. |
| `apps/indexer/src/scripts/ingest/62-price-reference-assets.ts` | CoinGecko call gets a 5 s timeout; XLM goes through the shared selection; the `native` rule and the XLM proxies (yXLM) take that same price; the former DB fallback (looked for `coingecko_xlm_usd`, a source name never written for `native`) and the hard-coded `0.165416` are gone — no qualifying source → row skipped + explicit warning. BTC (proxies only, best effort): CoinGecko, else the latest stored `coingecko_btc_proxy` row, else env, else `null` — the hard-coded `69846` is gone too. One log line per run: `xlm price source: <kind> (<source>) => <price>`. |
| `apps/indexer/src/scripts/ingest/73-network-stats-refresh.ts` | Reads the native row step 1 wrote in the same run (≤ 20 min, any source) and derives the 24 h change from history; calls CoinGecko (5 s) only when no such row exists; never a constant. `network_stats_latest.metadata` gains `xlmPriceSource`, `xlmPriceSourceDetail`, `xlmPriceChangeMethod`, `xlmPriceChangeBasis`. |
| `apps/indexer/package.json` | `test` → `node --import tsx --test 'src/**/*.test.ts'` (no new dependency; CI wiring is AD1). |
| `apps/indexer/.env.example`, `docs/runbooks.md` | `MANUAL_XLM_USD` documented as an explicit override; runbook section "XLM/USD price sources". |

Source strings (existing `asset_prices.source` text column, no consumer filters on them —
verified by grep over api/web/indexer): `coingecko_direct`, `onchain_sdex_xlm_usdc`,
`onchain_aquarius_xlm_usdc`, `onchain_soroswap_xlm_usdc`, `manual_env`; XLM proxies:
`coingecko_xlm_proxy` or `xlm_proxy:<upstream source>`.

Where the price is used: display (`/v1/network/stats` → dashboard tile) and USD valuation
(pool TVL, network TVL, wallet snapshots). The only action-side reader is the faucet witness
(`witness.service.ts`, `asset_prices` with a 24 h max age) for the reward's notional threshold —
a post-execution check, not a transaction build. No builder, validator, flag or whitelist reads
a price (grep over `apps/api/src/modules/actions` and `faucet`).

Guard note, written as agreed: the deviation guard only applies while a CoinGecko reference
younger than 6 h exists. After 6 h of block, liquidity (≥ 50 000 USDC, deepest pool first) and
freshness (≤ 60 min) are the only protections.

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
ℹ tests 8 · pass 8 · fail 0
```
`tsc --noEmit` in `apps/indexer`: no error in the touched files (the pre-existing third-party
`.d.ts` debt is unchanged, see `docs/evidence/lot-ac/ac0-compat.md`).

## Local end-to-end (local Postgres, real network calls, 2026-09-29 15:41–15:46Z)

CoinGecko is blocked from this machine too (residential connection):

```
$ pnpm tsx src/scripts/ingest/62-price-reference-assets.ts        # local reserves 26 days old
coingecko unavailable: HTTP 403 on https://api.coingecko.com/api/v3/simple/price?ids=stellar%2Cbitcoin%2C…
xlm price: NO qualifying source (coingecko failed, on-chain guards: [{"pool":"stellar-native-native-usdc-pool","reason":"stale reserves (37408 min)"},{"pool":"aquarius-native-usdc-pool","reason":"stale reserves (37410 min)"},{"pool":"soroswap-native-usdc-pair","reason":"stale reserves (37411 min)"}]) — native and XLM proxies skipped this run
xlm price source: none (none) => null
{ completedAt: '2026-09-29T15:41:56.736Z', inserted: 9, nativeUsd: null, nativeSource: 'none', btcUsd: 80986, btcSource: 'db_cached_btc_usd' }
```
→ failure path: honest `null`, every rejection named, no constant.

After refreshing the Soroswap pair and the SDEX pools locally (`run-soroswap-pair-refresh.ts`,
`run-stellar-native-refresh.ts`):
```
$ pnpm tsx src/scripts/ingest/62-price-reference-assets.ts
coingecko unavailable: HTTP 403 on …
native => 0.22671797748179998 onchain_sdex_xlm_usdc
yXLM => 0.22671797748179998 xlm_proxy:onchain_sdex_xlm_usdc
xlm price source: onchain (onchain_sdex_xlm_usdc) => 0.22671797748179998
$ pnpm tsx src/scripts/ingest/73-network-stats-refresh.ts
xlm price source: onchain (onchain_sdex_xlm_usdc) => 0.22671797748179998; 24h change via none
  xlmPriceUsd: 0.22671797748179998, xlmPriceChange24hPct: null, xlmPriceSource: 'onchain'
```
```
-- asset_prices (native, yXLM), latest 4 rows
native|onchain_sdex_xlm_usdc|0.22671797748179998|2026-09-29 15:45:40.754+00|stellar-native-native-usdc-pool|[{"pool": "aquarius-native-usdc-pool", "reason": "stale reserves (37413 min)"}]
yXLM|xlm_proxy:onchain_sdex_xlm_usdc|0.22671797748179998|2026-09-29 15:45:40.754+00||
native|coingecko_direct|0.185566|2026-09-03 16:10:34.36+00||
yXLM|coingecko_xlm_proxy|0.185566|2026-09-03 16:10:34.36+00||
-- network_stats_latest
2026-09-29 15:45:48.969+00|0.22671797748179998||{"source": "73-network-stats-refresh", "xlmPriceSource": "onchain", "xlmPriceChangeBasis": null, "xlmPriceChangeMethod": null, "xlmPriceSourceDetail": "onchain_sdex_xlm_usdc"}
-- SDEX reserves used (pool_snapshots.metadata.reserves)
2026-09-29 15:42:35.626+00|[{"asset": "native", "amount": "12478024.1494462"}, {"asset": "USDC:GA5Z…", "amount": "2828992.3981315"}]
```
→ deepest pool wins (SDEX, 2.83 M USDC, over Soroswap's ~67 k), Aquarius rejected as stale,
the proxy follows native, the 24 h change is `null` because the local history has no point
24 h ago (prod has CoinGecko rows until 06:30Z, so the first prod runs will derive a change
against those points, then against on-chain points). The 26-day-old CoinGecko reference is
older than 6 h, so the deviation guard did not apply — by design.

## Deploy (founder executes; manual form of the AD1 script)

Right after a refresh ends (:09 / :24 / :39 / :54). The indexer runs from the working tree via
`tsx`, so the ff-merge is the indexer deploy; install + build + restart keep `/health.version ==
HEAD` true. No `apt` expected (if one were needed: `NEEDRESTART_MODE=l`).

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
grep -n "xlm price source\|coingecko unavailable\|NO qualifying source" /var/log/dig-stellar-refresh.log | tail -4
docker exec -i dig_stellar_postgres psql -U dig -d dig_stellar -Atc "select a.symbol, ap.source, ap.price_usd, ap.observed_at, ap.metadata->>'pool' from asset_prices ap join assets a on a.id = ap.asset_id where a.symbol in ('native','yXLM') order by ap.observed_at desc limit 4"
docker exec -i dig_stellar_postgres psql -U dig -d dig_stellar -Atc "select as_of, xlm_price_usd, xlm_price_change_24h_pct, metadata->>'xlmPriceSource', metadata->>'xlmPriceChangeMethod' from network_stats_latest"
curl -s https://stellar-api.getdig.ai/v1/network/stats | jq '{xlmPriceUsd, xlmPriceChange24hPct, updatedAt}'
```
Expected: `xlm price source: onchain (onchain_sdex_xlm_usdc) => 0.2…` in both steps (SDEX is
the deepest XLM/USDC pool captured), fresh `native` + `yXLM` rows with that source,
`xlmPriceUsd` non-null on the API, and `#status` "Price sources" still failed (CoinGecko still
called once per run and still 403 — the tile stays true).

## Known limits

- **Step 9's 20-minute window.** `network-stats` reads the `native` row step 1 wrote in the same
  run only if it is at most 20 min old (`SAME_RUN_MAX_AGE_MS`). A refresh that takes longer than
  20 min between step 1 and step 9 makes step 9 retry CoinGecko itself and, while the block
  lasts, fall back to `null` for that run (refreshes take 7–8 min today; the 15-min cron
  cadence bounds it in practice).
- **Readers with no max age.** The API pool/TVL queries, the indexer metric writers and the
  wallet snapshots still take "the latest `asset_prices` row, any source, no max age". When
  CoinGecko AND every on-chain candidate fail, this hotfix writes no `native` row and logs it,
  and those readers keep serving the last known row — the silent-freeze class stays until the
  dedicated follow-up below lands.

## Follow-ups (outside this hotfix)

- Readers of `asset_prices` take "latest row, any source, no max age" (API pool/TVL queries,
  indexer metric writers, wallet snapshots): a dead feed freezes prices silently. Dedicated
  small lot: max age + explicit `null`.
- Multi-source median for XLM/USD (SDEX + Aquarius + Soroswap) instead of deepest-wins.
- `#status` "Price sources" wording: distinguish "upstream down" from "price published via fallback".
- BTC and the other CoinGecko ids of step 1 stay best effort (no on-chain fallback).
- `COINGECKO_API_KEY` support in step 1 stays as is, unused (no free tier usable).
