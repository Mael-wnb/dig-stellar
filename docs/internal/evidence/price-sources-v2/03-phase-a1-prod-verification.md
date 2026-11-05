# Price sources v2 — phase A1 prod verification (2026-09-29)

Deployed commit: `fdd370b`. CI on the public GitHub API: run on `main` created 16:59:16Z,
completed 16:59:56Z, `success` — **green before the deploy** (~17:10Z, right after the 17:00Z
refresh). Verified at the 17:15Z tick. Captures are the founder's; the 17:00Z run still ran the
previous code (its log shows `BTC => 69846 coingecko_btc_proxy`, same for SolvBTC and xSolvBTC —
the last re-write of the laundered constant).

## Deploy

```
Updating e982fb2..fdd370b  Fast-forward  13 files changed
pnpm install --frozen-lockfile: Already up to date
prisma generate: OK
nest build: BUILD OK
pm2 restart dig-stellar-api --update-env (restarts 8) + pm2 save
/health: {"status":"ok","version":"fdd370b","uptimeSeconds":3,"db":{"ok":true,"latencyMs":10},...}
```

## 17:15Z refresh — step 1 log (extract)

```
coingecko: no API key configured — not called (on-chain pricing only)
price source: AQUA onchain (onchain_aquarius_aqua_xlm) => 0.0003734964410773872
price source: BTC none (none) => null
no qualifying source for BTC: skipped this run (no candidate pool (no constant-product pool quotes it vs USDC or XLM))
price source: CETES onchain (onchain_aquarius_cetes_usdc) => 0.06536162987756483
price source: ETH onchain (onchain_aquarius_eth_usdc) => 2684.1721558611102
price source: EURC onchain (onchain_soroswap_eurc_usdc) => 1.1271225969511807
price source: native onchain (onchain_sdex_xlm_usdc) => 0.2227141594272588
price source: oUSD stable (manual_stable) => 1
price source: PYUSD stable (manual_stable) => 1
price source: SolvBTC onchain (onchain_aquarius_solvbtc_xlm) => 83063.40685448439
price source: TESOURO onchain (onchain_aquarius_tesouro_usdc) => 0.24150991974138064
price source: USDC stable (manual_stable) => 1
price source: USDGLO none (none) => null
no qualifying source for USDGLO: skipped this run (no candidate pool (no constant-product pool quotes it vs USDC or XLM))
price source: USDY onchain (onchain_aquarius_usdy_usdc) => 1.1337979886793272
price source: USTRY onchain (onchain_aquarius_ustry_usdc) => 1.0760055336628087
price source: xSolvBTC none (none) => null
no qualifying source for xSolvBTC: skipped this run (no candidate pool (no constant-product pool quotes it vs USDC or XLM))
price source: yUSDC stable (manual_stable) => 1
price source: yXLM onchain (xlm_proxy:onchain_sdex_xlm_usdc) => 0.2227141594272588
coingeckoCalled: false
```

## Latest row per asset after the tick (Q1, age in minutes)

```
USDGLO|coingecko_direct|0.999384|2026-09-29 06:30:07.105+00|655
BTC|coingecko_btc_proxy|69846.000000|2026-09-29 17:00:07.963+00|25
xSolvBTC|coingecko_btc_proxy|69846.000000|2026-09-29 17:00:07.963+00|25
AQUA|onchain_aquarius_aqua_xlm|0.000373|2026-09-29 17:15:06.934+00|10
CETES|onchain_aquarius_cetes_usdc|0.065362|2026-09-29 17:15:06.934+00|10
ETH|onchain_aquarius_eth_usdc|2684.172156|2026-09-29 17:15:06.934+00|10
EURC|onchain_soroswap_eurc_usdc|1.127123|2026-09-29 17:15:06.934+00|10
native|onchain_sdex_xlm_usdc|0.222714|2026-09-29 17:15:06.934+00|10
oUSD|manual_stable|1.000000|2026-09-29 17:15:06.934+00|10
PYUSD|manual_stable|1.000000|2026-09-29 17:15:06.934+00|10
SolvBTC|onchain_aquarius_solvbtc_xlm|83063.406854|2026-09-29 17:15:06.934+00|10
TESOURO|onchain_aquarius_tesouro_usdc|0.241510|2026-09-29 17:15:06.934+00|10
USDC|manual_stable|1.000000|2026-09-29 17:15:06.934+00|10
USDY|onchain_aquarius_usdy_usdc|1.133798|2026-09-29 17:15:06.934+00|10
USTRY|onchain_aquarius_ustry_usdc|1.076006|2026-09-29 17:15:06.934+00|10
yUSDC|manual_stable|1.000000|2026-09-29 17:15:06.934+00|10
yXLM|xlm_proxy:onchain_sdex_xlm_usdc|0.222714|2026-09-29 17:15:06.934+00|10
```

Against the pre-deploy comparison (`02-phase-a1-corrections.md`): every asset with a
qualifying pool got a fresh on-chain row with the predicted source; the sources match the
plan (AQUA via the deepest XLM pool, EURC via the USDC pair, SolvBTC two hops); the values sit
within the same ≤ 1 % band of the Reflector reads of the recon (USTRY 1.07601 vs 1.07608,
CETES 0.06536 vs 0.06557, SolvBTC 83 063 vs 83 369 / CEX 83 081, with 45 min of market between
the two readings). CoinGecko was not called.

## Public API

```
/v1/network/stats: {"xlmPriceUsd":0.2227141594272588,"xlmPriceChange24hPct":-1.5997705051102133,
"stellarTvlUsd":260232096.810201,...,"updatedAt":"2026-09-29T17:22:13.709Z"}
```

`stellarTvlUsd` is **our own valuation**, not DefiLlama: step 9 copies the latest
`network_tvl_snapshots.tvl_usd`, the canonical tracked sum written by step 7 from our
`pool_metrics_latest` (DeFindex excluded, founder ruling 2026-08-17;
`73-network-stats-refresh.ts:263-269`). It moved 262.10 M → 260.23 M (−0.7 %), in line with the
XLM move over the window (0.2260 → 0.2227, −1.5 %) net of the SolvBTC step-up; the USTRY
correction is inside that figure.

## Effect on the pools that hold the corrected assets (Q2 filtered, ~16:36Z → ~17:26Z)

| Asset | TVL of the pools containing it, before | after | Δ |
|---|---|---|---|
| USTRY | 208 486 203 | 205 707 373 | −2.78 M (−1.3 %) |
| CETES | 208 134 936 | 205 741 780 | −2.39 M (−1.1 %) |
| SolvBTC | 20 141 223 | 22 014 876 | +1.87 M (+9.3 %) |

Written as is:
- The USTRY price was wrong by about 39 %, but USTRY is a small share of the Blend pools:
  the impact on those pools is ≈ 1 %. These deltas mix the price correction with the XLM
  decline between the two measurements (≈ −1.5 to −2 %); the attribution is approximate.
- Consequence for the published figures: an over-valuation of the order of 1–2 % on the pools
  concerned, not massive. A dated correction note is to be added tomorrow to the documents
  listed in `02-phase-a1-corrections.md`; nothing was modified tonight.
- The "TVL of the pools containing the asset" column is an upper bound (the whole pool), not
  the asset's share.

## Known limits until phase A2 (max-age rule)

- BTC and xSolvBTC: no new row; the last row **69 846** (17:00:07Z, labelled `coingecko_btc_proxy`)
  keeps being served by every reader.
- USDGLO: no candidate (its only pool is a StableSwap pool); the last row 0.999384 (06:30:07Z,
  CoinGecko) keeps being served.
- The "Price sources" tile now reflects DefiLlama + stellar.expert only; its 24 h availability
  figure still carries the CoinGecko failures of the day until they age out of the window.
