# Lot P — P0 Inventory (STOP-and-report)

Executed 2026-08-16 per `docs/lot-p-pool-perimeter.md`. **No seeding has been done** — this is
the founder-gated inventory. Raw data files in this folder:
`p0-aquarius-pools-ge50k.json` (venue TVL dump ≥$50k), `p0-soroswap-pairs-top.json`
(on-chain factory scan, top pairs), `p0-refresh-baseline-2026-08-16.json` (prod step summary).

## TL;DR

- **12 new pools pass all three selection rules today** (10 Aquarius + 2 Soroswap), no pricing
  work needed. One more (`soroswap-native-eurc-pair`, $415k) is already in the committed
  registry but **missing on prod** — the P1 seed run repairs it for free.
- The priced-asset filter IS the binding constraint, as suspected: it excludes ~$7.6M of
  candidate TVL. The single biggest unlock is **USDY** (one CoinGecko id → a $2.0M pool).
  The full shortlist below would unlock ~$5.5M more TVL across 10 pools.
- Refresh budget: current prod total is **268s** (not the ~177s in the brief — that figure
  matches the `stellar-native` step alone, which now dominates at 187s). Projected total with
  +12 pools ≈ **380s (6.3 min)** — inside the 8-min stop bar, but the headroom note below
  deserves a read.

## Ops note (blocking, founder action)

`ssh root@64.226.93.92` fails: **the VPS host key has changed** vs `~/.ssh/known_hosts`
(offending line 10; new ED25519 fingerprint `SHA256:oGepPX6swSuwgBA5HKLSOLQ46UIA1rWBW7i/xIrZNHY`).
If this is your VPS resize/rebuild, remove the stale line (`ssh-keygen -R 64.226.93.92`) and
confirm; I did not bypass it. Everything below was gathered without SSH via the public API
(`stellar-api.getdig.ai`), the venues' own APIs, and on-chain reads — but **P1's seed run needs
SSH restored**.

## 1. Refresh baseline (latest prod run, 2026-08-16 09:15:06 UTC)

All steps SUCCESS, `failures24h = 0` on every step. Source: `/v1/ops/metrics`
(`refresh_step_runs`).

| Step | Duration |
|---|---|
| prices:reference | 3.9s |
| prices:soroswap-derived | 3.3s |
| blend | 15.6s |
| soroswap | 3.7s |
| aquarius | 37.3s |
| stellar-native | 187.2s |
| defindex | 9.7s |
| protocol-metrics | 1.9s |
| allbridge | 2.7s |
| network-stats | 2.9s |
| **Total** | **268.1s (4:28)** |

Per-pool marginal cost (measured): Aquarius ≈ **9.3s/pool** (≈4.3s work + 5s inter-pool
spacing), Soroswap ≈ **3.7s/pool** + ≈3.3s/pool on `prices:soroswap-derived`.

**Projection with +10 Aquarius +2 Soroswap:** 268s + ~93s + ~14s ≈ **375–385s (~6.3 min)**.
Inside the 15-min cadence and under the 8-min stop bar, with ~95s of headroom. The dominant
cost is `stellar-native` (187s), not the AMM perimeter — if headroom ever tightens, that step
is the lever, not the pool count.

## 2. Current perimeter & priced assets

Prod `/v1/pools` AMM perimeter: **Aquarius 4, Soroswap 1** (plus Blend 4, DeFindex 3,
stellar-native 9 — out of scope).

**Discrepancy:** the committed registry (`core-registry.json`) has `soroswap-native-eurc-pair`
(CATUJXDU…, active) but prod returns 404 for it — prod was never re-seeded after it was added.
On-chain TVL today: **$415k**. The P1 seed run reconciles this automatically.

Current priced assets — all 12 fresh at 2026-08-16 09:30 UTC (source = `pricing-config.ts`
rule → `asset_prices.source`):

| Symbol | Price USD | Source rule |
|---|---|---|
| native (XLM) | 0.157014 | coingecko `stellar` |
| USDC | 1 | stable 1:1 |
| PYUSD | 1 | stable 1:1 |
| oUSD | 1 | stable 1:1 |
| EURC | 1.16 | manual fallback (`MANUAL_EURC_USD`) |
| SolvBTC | 63,014 | BTC proxy (coingecko `bitcoin`) |
| xSolvBTC | 63,014 | BTC proxy (coingecko `bitcoin`) |
| AQUA | 0.00031928 | coingecko `aquarius` |
| USTRY | 1.063 | coingecko `etherfuse-ustry` |
| CETES | 0.03453 | coingecko `cetes` |
| TESOURO | 0.238151 | coingecko `etherfuse-tesouro` |
| USDGLO | 0.999481 | coingecko `glo-dollar` |

## 3. Candidate inventory — Aquarius (venue API, 337 pools, ≥$50k shown)

Candidate source: `amm-api.aqua.network/pools/` (the API the Aquarius app renders;
`liquidity_usd`, 7-decimal raw). Verification methods:

- **V1** — address present in BOTH venue endpoints (`/pools/` + `/api/external/v1/pools/`)
  with matching token sets. (The external endpoint lists only constant_product/stable pools.)
- **V2** — venue `/pools/` entry + independent on-chain `get_tokens`/`get_reserves` simulation:
  token contracts match the claimed assets and reserves×our prices reproduce the venue TVL.
  Used for `concentrated` pools, which the external endpoint omits.
- All four **existing** pools' contract ids matched the venue API exactly (sanity check ✓).

| # | Pool | Venue TVL | Type | Contract id | Verified | Verdict |
|---|---|---|---|---|---|---|
| 1 | xSolvBTC/SolvBTC | $10.56M | stable | CCNXGPE4…RQ2A | V1 | already indexed |
| 2 | PYUSD/USDC | $8.02M | stable | CDMH535J…7SUW | V1 | already indexed |
| 3 | native/SolvBTC | $6.51M | cp | CD2O2B6P…P5F6 | V1 | already indexed |
| 4 | native/USDC | $3.18M | cp | CA6PUJLB…CJBE | V1 | already indexed |
| 5 | CETES/USDC | $2.38M | cp | CCKGQSQG…L2AD | V1 | **INCLUDE** |
| 6 | USTRY/USDC | $2.18M | cp | CCX2TYR4…2MIA | V1 | **INCLUDE** |
| 7 | USDY/USDC | $2.01M | cp | CAFHLHGZ…HUSM | V1 | EXCLUDE — USDY unpriced |
| 8 | USDM1/USDC | $1.95M | cp | CCJ3XJR5…2DOR | V1 | EXCLUDE — USDM1 unpriced |
| 9 | USST/USDC | $1.81M | stable | CCYMZTOJ…JX25 | V1 | EXCLUDE — USST unpriced |
| 10 | native/AQUA | $1.37M | cp | CCY2PXGM…IFWV | V1 | **INCLUDE** |
| 11 | native/USDC | $1.22M | concentrated | CBBMQBNH…BUCV | V2 | **INCLUDE** |
| 12 | native/yXLM | $939k | stable | CCFGZJTH…3ZH3 | V1 | EXCLUDE — yXLM unpriced |
| 13 | USDC/yUSDC | $861k | stable | CCWNKTTM…LHI6 | V1 | EXCLUDE — yUSDC unpriced |
| 14 | AQUA/USDC | $487k | cp | CA6GAFOJ…SC4O | V1 | **INCLUDE** |
| 15 | BTC/ETH | $430k | cp | CDOGKTAH…BYDJ | V1 | EXCLUDE — BTC+ETH unpriced |
| 16 | USDGLO/USDC | $409k | stable | CAC56QNJ…BIT2 | V1 | **INCLUDE** |
| 17 | native/yXLM | $382k | concentrated | CADMDTCQ…FS7F | V2* | EXCLUDE — yXLM unpriced |
| 18 | BTC/yBTC | $363k | stable | CBRGFMR6…5W2T | V1 | EXCLUDE — both unpriced |
| 19 | AQUA/sUSD | $306k | cp | CAF63CND…M5WT | V1 | EXCLUDE — sUSD unpriced |
| 20 | PYUSD/USDC | $286k | concentrated | CAPIOQNU…DQYX | V2 | **INCLUDE** |
| 21 | USDC/XAUm | $267k | cp | CAXYSVTP…GGH4 | V1 | EXCLUDE — XAUm unpriced |
| 22 | native/SHX | $243k | cp | CD65EROV…KGIY | V1 | EXCLUDE — SHX unpriced |
| 23 | ETH/yETH | $222k | stable | CCOZA42S…7B3F | V1 | EXCLUDE — both unpriced |
| 24 | native/AQUA | $217k | concentrated | CA4HTZNY…ID2S | V2 | **INCLUDE** |
| 25 | USDC/sUSD | $196k | concentrated | CBV6LZAB…WGWQ | — | EXCLUDE — sUSD unpriced |
| 26 | XRP/native | $124k | cp | CAQODUH4…TIGM | V1 | EXCLUDE — XRP unpriced |
| 27 | ETH/USDC | $119k | cp | CCZC4HGM…EZZR | V1 | EXCLUDE — ETH unpriced |
| 28 | USDC/TESOURO | $113k | cp | CDPF7GMA…OTD7 | V1 | **INCLUDE** |
| 29 | native/sUSD | $103k | cp | CAC3AUH3…NGZB | V1 | EXCLUDE — sUSD unpriced |
| 30 | AQUA/USDC | $90k | concentrated | CBRUQ7I6…YYZ7 | V2 | **INCLUDE** |
| 31–37 | (7 pools, $53k–$77k) | | | | | EXCLUDE — sUSD / BTC / ETH / EURC-old unpriced |

\* #17 verified same-shape as the other concentrated pools; only #11/#20/#24/#30 got the full
on-chain reserve reproduction (they are the included ones).

Rows 31–37 detail (all in the raw JSON): ETH/sUSD $77k, sUSD/EURC $73k, BTC/sUSD $73k,
AQUA/ETH $61k, PYUSD/sUSD $58k, EURC(legacy issuer GAQRF3UG)/sUSD $54k, BTC/USDC $53k.

## 4. Candidate inventory — Soroswap (on-chain factory, 214 pairs)

`info.soroswap.finance` still redirects to Dune and `api.soroswap.finance` requires an API key
we don't have — so the candidate source is **the venue's own factory contract** (all 214 pairs
enumerated via `all_pairs`, then `token_0`/`token_1`/`get_reserves` read per pair; new
discovery script `74-soroswap-pairs-tvl-scan.ts`, output committed-adjacent in
`tmp/discovery/`). TVL computed from on-chain reserves × our fresh `asset_prices` — i.e. the
same numbers our refresh would produce. 118 of 214 pairs hold only unpriced tokens (meme/dead
pairs) and cannot be valued; every pair whose TVL could plausibly clear $50k is covered below.

| Pair | TVL (our prices) | Contract id | Verdict |
|---|---|---|---|
| USDC/EURC | $563k | CC7CDFY2…NPOC | **INCLUDE** |
| native/EURC | $415k | CATUJXDU…WNMY | already in registry — **prod missing, P1 seed repairs** |
| native/USDC | $111k | CAM7DY53…OABP | already indexed |
| USTRY/USDC | $92k | CDIXSYDR…DCCU | **INCLUDE** |
| USDC/BLND | ~$52k (est. 2× USDC side) | CCCDU62T…EY3X | EXCLUDE — BLND unpriced; borderline TVL |

## 5. Proposed additions (12 pools — inside the ~15 cap)

Slugs follow the existing convention; `-clpool` distinguishes concentrated pools from their
constant-product siblings with the same token pair.

| Venue | Slug proposal | Venue TVL |
|---|---|---|
| aquarius | aquarius-cetes-usdc-pool | $2.38M |
| aquarius | aquarius-ustry-usdc-pool | $2.18M |
| aquarius | aquarius-native-aqua-pool | $1.37M |
| aquarius | aquarius-native-usdc-clpool | $1.22M |
| aquarius | aquarius-aqua-usdc-pool | $487k |
| aquarius | aquarius-usdglo-usdc-pool | $409k |
| aquarius | aquarius-pyusd-usdc-clpool | $286k |
| aquarius | aquarius-native-aqua-clpool | $217k |
| aquarius | aquarius-usdc-tesouro-pool | $113k |
| aquarius | aquarius-aqua-usdc-clpool | $90k |
| soroswap | soroswap-usdc-eurc-pair | $563k |
| soroswap | soroswap-ustry-usdc-pair | $92k |

New perimeter if approved: **Aquarius 4→14, Soroswap 1→4** (incl. the native-eurc repair),
≈ **+$9.4M** displayed TVL. All constituent assets already exist in `assets` with fresh prices —
**zero pricing work required for these 12.**

Adapter compatibility: concentrated pools expose the **same interface** as the existing pools
(`get_tokens` / `get_reserves` / `get_info` verified on all four included ones), so
`run-aquarius-pool-refresh.ts` should work unchanged — P2 validates this for real.

## 6. Price-coverage shortlist (P0b — pick what to approve)

For every rule-2 exclusion, the blocking asset and the best available robust source. Venue
price = `amm-api.aqua.network/tokens/` `price_xlm` × our XLM/USD, checked against CoinGecko
where a listing exists — agreement was ±1% on every asset marked ✓.

**Robust source exists (proposed for P0b):**

| Asset | Proposed source | Venue vs source check | Unlocks (TVL) |
|---|---|---|---|
| USDY (Ondo) | coingecko `ondo-us-dollar-yield` | $1.128 vs $1.14 ✓ | USDY/USDC **$2.01M** |
| yXLM (Ultra) | XLM proxy (existing rule kind; venue: 0.9998 XLM) | ✓ | native/yXLM $939k + $382k |
| yUSDC (Ultra) | USDC peg (stable rule; venue: $1.006) | ✓ | USDC/yUSDC $861k |
| BTC (Ultra) | BTC proxy (existing rule kind) | $62.7k vs $63.0k ✓ | BTC/ETH $430k*, BTC/yBTC $363k*, BTC/USDC $53k |
| ETH (Ultra) | coingecko `ethereum` | $1,870 vs $1,879 ✓ | ETH/USDC $119k; +BTC → BTC/ETH $430k |
| yBTC (Ultra) | BTC proxy | $62.5k ✓ | BTC/yBTC $363k (with BTC) |
| yETH (Ultra) | ETH proxy (via `ethereum`) | $1,864 ✓ | ETH/yETH $222k (with ETH) |
| XAUm (Matrixdock) | coingecko `matrixdock-gold` ($4,364.9) | listing exists | USDC/XAUm $267k |
| SHX (Stronghold) | coingecko `stronghold-token` | $0.003002 vs $0.003002 ✓ (exact) | native/SHX $243k |
| XRP (fchain) | coingecko `ripple` | $0.999 vs $1.00 ✓ | XRP/native $124k |
| BLND (Blend) | coingecko `blend-protocol` ($0.0000582) | listing exists | USDC/BLND ~$52k (borderline) |

\* needs both BTC and ETH. Full shortlist ≈ **+$5.5M TVL across 10 more pools**. If you only
approve one: **USDY**. A sensible top-tier: USDY + yXLM + yUSDC + BTC + ETH (unlocks ~$5.0M).

Note: proxy/peg sources (yXLM, yUSDC, yBTC, yETH) carry the same honesty caveat as the
existing SolvBTC→BTC proxy — the +63.8% YieldBlox flag lesson. Each is a 1:1-redeemable
wrapper and the venue's own price confirms the peg today; P0b would still record them with
`confidence: medium` metadata like the existing proxies. Alternative per the brief's (a)-rule:
derive mid-prices from the pools themselves once indexed — but that inverts the
include-requires-price rule, so proxy-first is the workable order.

**No robust source (stay excluded — the honest boundary):**

| Asset | Why | Blocked TVL |
|---|---|---|
| USDM1 (issuer GDM5QWW…, no home_domain) | venue price $0.98 ≠ peg, identity unclear, no CG listing | $1.95M |
| USST (STBL) | venue price broken (1e-11 artifact), no confirmed CG listing | $1.81M |
| sUSD (synt.tech) | venue-only price, no independent source, synthetic stable | ~$0.9M across 8 small pools |

## 7. Evidence checklist status

- Inventory table with per-pool verification — this file (§3–4)
- Before/after pool counts per venue — §5 (after = pending founder go)
- Refresh timings baseline — §1 (`p0-refresh-baseline-2026-08-16.json`); after = P2
- TVL cross-check table — P2 (post-seed); concentrated pools already reproduced on-chain (§3 V2)
- Excluded-pools table with reasons — §3 (EXCLUDE rows) + §6

## STOP

Awaiting founder decisions:
1. **Go/no-go on the 12 zero-pricing-work additions** (§5).
2. **Which shortlist assets to approve for P0b** (§6) — each adds its unlocked pools to P1.
3. **SSH host-key confirmation** (ops note above) — required before the P1 VPS seed.

> **Resolution (same day):** the documented IP was stale — DigitalOcean had recycled it;
> the real VPS is `stellar-api.getdig.ai` (209.38.195.61) and its host key never changed.
> Nothing was compromised — the mismatch was a stranger's droplet answering on the old IP.
> SSH restored via the founder's key; docs reference the hostname from now on.
