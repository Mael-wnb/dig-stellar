# Price sources v2 — phase A1 corrections and pre-deploy comparison (2026-09-29)

Founder review of the A1 diff with the prod outputs (Q1, Q2b, SDEX reserves at ~16:36Z) led to
three corrections, applied on `fix/price-sources-v2` before any commit. Prod figures below are
the founder's; Reflector prices are the read-only simulations of `00-recon.md` (16:20–16:25Z).

## Correction 1 — an unknown Aquarius pool type EXCLUDES

The first cut treated an unknown `pool_type` as constant-product. Wrong way round: a StableSwap
pool's reserve ratio is not a price (prod: `aquarius-usdglo-usdc-pool` = 201 405.62 USDC /
224 064.88 USDGLO → 0.899 for a $1 stablecoin). Rule now in `loadPoolReserveSets`:
Soroswap = constant product by design (accepted); SDEX liquidity pools = constant product by
design (accepted); Aquarius accepted **only** when `entities.metadata->'info'->>'pool_type' =
'constant_product'`; `stable`, `concentrated` and unknown are excluded (plus `*-clpool`).

Where the type comes from: the committed registry (`core-registry.json`, `metadata.info.pool_type`,
entries sourced `lot-p-p1` / `aquarius_final_registry`), copied verbatim into
`entities.metadata` by `seed-core` (verified in the local DB). The Aquarius adapter does not
read the type from the contract. Every candidate pool has an explicit type:

| Aquarius pool | Type (registry → entities.metadata) | Priced from it? |
|---|---|---|
| aquarius-aqua-usdc-pool | constant_product | yes (AQUA, direct) |
| aquarius-cetes-usdc-pool | constant_product | yes |
| aquarius-usdc-tesouro-pool | constant_product | yes |
| aquarius-usdglo-usdc-pool | **stable** | **no → USDGLO null tonight** |
| aquarius-usdy-usdc-pool | constant_product | yes |
| aquarius-ustry-usdc-pool | constant_product | yes |
| aquarius-eth-usdc-pool | constant_product | yes |
| aquarius-native-aqua-pool | constant_product | yes (AQUA, two hops — deepest) |
| aquarius-native-solvbtc-pool | constant_product | yes (SolvBTC, two hops) |
| aquarius-native-usdc-pool | constant_product | yes (XLM candidate) |
| aquarius-native-yxlm-pool | **stable** | no (yXLM is an XLM proxy anyway) |
| aquarius-xsolvbtc-solvbtc-pool | **stable** | no (and three hops) |
| aquarius-pyusd-usdc-pool, aquarius-usdc-yusdc-pool | stable | no (PYUSD / yUSDC stay `manual_stable`) |

Local check after the change: the loader returns 10 Aquarius pools (all `constant_product`),
4 Soroswap pairs, 60 SDEX pools; USDGLO gets "no candidate pool".

## Correction 2 — step 2 applies the step-1 guards and never prices a ruled asset

Chosen: **both**, because each closes a different hole. (a) Step 2 never derives an asset that
has a `pricing-config` rule — step 1 owns it, including its rejection (otherwise
`soroswap-ustry-usdc-pair`, 46 366 USDC, could re-price USTRY below the liquidity floor after
step 1 rejected it). (b) For rule-less assets (wallet tokens without a rule), step 2 builds the
same `OnchainCandidate` (`pairCandidate`: quote must be USDC or XLM, otherwise a third hop → no
candidate) and runs `judgeCandidate` — freshness ≤ 60 min, quote side ≥ 50 000 USD — before
writing, with the same source naming (`onchain_soroswap_<asset>_<usdc|xlm>`) and metadata.
Test "step 2: pair candidate is judged with the step-1 guards" (11 tests total): the prod
USTRY pair is rejected as thin, the USDC/EURC pair yields 1.12712, a non-USDC/XLM quote yields
no candidate, stale reserves yield null. Local run on `soroswap-usdc-eurc-pair`: "EURC: has a
pricing rule — step 1 owns it, not derived here", inserted 0.

## Correction 3 — BTC: the laundering path is gone

Mechanism (Q1 prod 16:36Z: BTC, SolvBTC, xSolvBTC = 69 846.000000, source `coingecko_btc_proxy`,
observed 16:30:07Z, age 6 min): the old step 1 fell back to "the latest `coingecko_btc_proxy`
row" when CoinGecko failed — a row that had itself been written from the hard-coded 69 846
constant on an earlier failure — and re-wrote it every run with a fresh timestamp and a
CoinGecko-looking label. A constant laundered into a "6-minute-old CoinGecko price".

Now (`62-price-reference-assets.ts`, `resolveRule`, `proxy BTC`): the only three writers of a
BTC-family price are CoinGecko `bitcoin` **when a key is configured and answered**
(`coingecko_btc_proxy`), the explicit `MANUAL_<ASSET>_USD` override (`manual_env`), or the
asset's **own** on-chain pool (`onchain_aquarius_solvbtc_xlm`). No DB-cached path, no constant:
`grep -n "db_cached\|69846\|getLatestPriceBySource"` on the file returns nothing.
Expected tonight: SolvBTC ≈ 83 368 via aquarius-native-solvbtc-pool (two hops); BTC and xSolvBTC
→ no row. **Known limit of tonight:** their last row (69 846, labelled CoinGecko) keeps being
served by every reader until the A2 max-age rule hides it.

## Pre-deploy comparison (prod reserves 16:30–16:33Z, XLM/USD 0.226026 for two-hop quotes)

| Asset | Candidate (pool · type · hops) | Quote side USD | New on-chain | Old (Q1 16:36Z) | Reflector (feed) | old→new | on-chain↔Reflector | Note |
|---|---|---|---|---|---|---|---|---|
| AQUA | aquarius-native-aqua-pool · constant_product (registry) · 2 | 883,937.90 | 0.000376 | 0.000378 | 0.000377 (Stellar DEX) | -0.5 % | -0.13 % |  |
| CETES | aquarius-cetes-usdc-pool · constant_product (registry) · 1 | 1,161,320.80 | 0.065567 | 0.069000 | 0.065567 (Stellar DEX) | -5.0 % | -0.00 % | old = hard-coded 0.069 |
| ETH | aquarius-eth-usdc-pool · constant_product (registry) · 1 | 71,674.64 | 2,694.54 | 2,691.21 | 2,676.55 (CEX/DEX (Other ETH)) | +0.1 % | +0.67 % |  |
| TESOURO | aquarius-usdc-tesouro-pool · constant_product (registry) · 1 | 58,083.86 | 0.241510 | 0.241075 | 0.241510 (Stellar DEX) | +0.2 % | +0.00 % | quote 58k, just above 50k |
| USDGLO | aquarius-usdglo-usdc-pool · STABLE (registry) → excluded · — | 201,405.62 | — | 0.999384 | 0.999970 (Stellar DEX) | — | — | ratio 0.899 is not a price → null tonight |
| USDY | aquarius-usdy-usdc-pool · constant_product (registry) · 1 | 1,013,577.61 | 1.134116 | 1.150000 | — (not in either feed) | -1.4 % | — |  |
| USTRY | aquarius-ustry-usdc-pool · constant_product (registry) · 1 | 1,095,927.31 | 1.076015 | 1.500000 | 1.076080 (Stellar DEX) | -28.3 % | -0.01 % | old = CoinGecko frozen; soroswap pair 46.4k USDC rejected as thin |
| EURC | soroswap-usdc-eurc-pair · constant product by design · 1 | 277,674.00 | 1.127123 | 1.160000 | 1.127137 (Stellar DEX (CEX/DEX also lists EURC)) | -2.8 % | -0.00 % | old = hard-coded 1.16; via XLM: 1.1252 |
| SolvBTC | aquarius-native-solvbtc-pool · constant_product (registry) · 2 | 4,506,861.42 | 83,367.77 | 69,846.00 | 83,368.81 (Stellar DEX (CEX/DEX BTC 83 080.65)) | +19.4 % | -0.00 % | old = laundered constant |
| BTC | (only aquarius-btc-usdc-clpool + btc-eth) · no constant-product pool vs USDC/XLM · — | — | — | 69,846.00 | 83,080.65 (CEX/DEX (Other BTC)) | — | — | null tonight; last row 69 846 keeps serving until A2 |
| xSolvBTC | aquarius-xsolvbtc-solvbtc-pool · STABLE (registry), three hops · — | — | — | 69,846.00 | — (not in either feed) | — | — | null tonight; last row 69 846 keeps serving until A2 |
| native | stellar-native-native-usdc-pool · SDEX, constant product by design · 1 | 2,825,407.91 | 0.226140 | 0.226026 | 0.226329 (Stellar DEX (CEX/DEX XLM 0.22598)) | +0.1 % | -0.08 % |  |

Reading: every on-chain ↔ Reflector deviation is ≤ 0.7 % (AQUA −0.13 %, CETES 0.00 %, ETH
+0.67 %, TESOURO 0.00 %, USTRY −0.01 %, EURC 0.00 %, SolvBTC 0.00 %, XLM −0.08 %); nothing
needs exclusion on that ground. USDY has no Reflector feed (1.134 on a 1.01 M USDC
constant-product pool, plausible for a yield-bearing dollar; no cross-check available tonight).
USDGLO is excluded by Correction 1 (stable pool). Two old→new moves exceed 10 % and are
**corrections**, not market moves:

- **USTRY 1.500 → 1.076 (−28.3 %)**: CoinGecko's frozen row overvalued USTRY by ~39 %
  (1.500 / 1.076). USTRY sits in the four Blend pools; their supplied/borrowed USD and the
  network TVL will step down at the first refresh after the deploy.
- **SolvBTC 69 846 → 83 368 (+19.4 %)**: the laundered constant is replaced by the live
  pool-implied price (Reflector agrees to 0.00 %).

Smaller corrections: CETES −5.0 % (hard-coded 0.069 → 0.0656), EURC −2.8 % (hard-coded 1.16 →
1.127), USDY −1.4 %.

**Published TVL figures that may depend on the old prices** (listed, nothing modified tonight):
`docs/status-board.md` (network-TVL lines around 279–280, 348, 363: $230.06M / $186.49M net,
$249M, $190M, $192M / $166M / $22.7M), `docs/final-report.md`, `docs/grant-roadmap.md`,
`docs/current-state.md`, `docs/TECHNICAL_ARCHITECTURE.md` (TVL mentions), the hotfix note
`hotfix-xlm-price-fallback/02-prod-verification.md` (262.10 M vs 260.66 M). The SCF 43 grant is
closed; these are historical statements dated at their capture and stay as they are. The SCF 46
material must use post-deploy figures.

## Files changed by the corrections

`shared/xlm-price-db.ts` (Aquarius explicit-type filter), `shared/xlm-price.ts`
(`pairCandidate`), `63-price-soroswap-derived.ts` (rule check + guards + source/metadata),
`xlm-price.test.ts` (+1 test), `62-price-reference-assets.ts` (clearer "no candidate pool"
log), `docs/runbooks.md`.
