# Price sources v2 — phase B: prod verification at the first tick after 99b9c35 (2026-10-15)

Single deployment of A2 + A2-bis + B (`main` = `99b9c35`), executed by the founder at ~14:39Z
right after the 14:30Z refresh. `/health` after the restart:
`{"status":"ok","version":"99b9c35",…,"db":{"ok":true,…}}`. First tick with the new code:
**14:45Z**. Every capture below was taken read-only by the founder; nothing was changed after.

## 1. Before / after

| Asset | Served before (since 2026-09-29) | At 14:45Z | Source | Cross-check |
|---|---|---|---|---|
| BTC | **69 846** (`coingecko_btc_proxy`, ~15 days old) | **81 216.10** | `reflector_cex_btc` | BTC/ETH two-hop 80 741.00, **+0.59 %**, ok (3 %) |
| xSolvBTC | **69 846** (same dead row) | **80 510.50** | `derived_quote_aquarius_xsolvbtc_solvbtc` (SolvBTC 80 500.43 × 1.000125) | base cross-checked (SolvBTC −0.15 %) |
| USDGLO | **0.999384** (frozen `coingecko_direct`) | **0.999916** | `reflector_sdex_usdglo` | stable-pool quote 0.999924, −0.00 %, ok (1 %) |
| PYUSD | 1 (assumed) | 0.999858 | `reflector_sdex_pyusd` | quote 0.999847, +0.00 % |
| yUSDC | 1 (assumed) | 0.999666 | `reflector_sdex_yusdc` | quote 0.999622, +0.00 % |
| SolvBTC | 81 569.95 (on-chain, 29/09) | 80 500.43 | `reflector_sdex_solvbtc` | cp pool 80 618.75, −0.15 % |

No `—` was shown at any point: the run that made A2 ignore the dead rows wrote the new ones.

## 2. Step 1 log, tick 14:45Z

```
price source: AQUA reflector (reflector_sdex_aqua) => 0.00031430027032 [cross-check onchain_aquarius_aqua_xlm 0.00031505220510309517 -0.24 % ok]
price source: BTC reflector (reflector_cex_btc) => 81216.09953640573 [cross-check onchain_aquarius_btc_eth 80741.00427769848 +0.59 % ok]
price source: CETES reflector (reflector_sdex_cetes) => 0.06428616534484 [cross-check onchain_aquarius_cetes_usdc 0.06415391878779443 +0.21 % ok]
price source: ETH reflector (reflector_cex_eth) => 2372.2846011109036 [cross-check onchain_aquarius_eth_usdc 2365.1734225297832 +0.30 % ok]
price source: EURC reflector (reflector_cex_eurc) => 1.1233208950324 [cross-check onchain_soroswap_eurc_usdc 1.1153882556681447 +0.71 % ok]
price source: native reflector (reflector_cex_xlm) => 0.18101718791209 [cross-check onchain_sdex_xlm_usdc 0.1805402509662089 +0.26 % ok]
price source: oUSD stable (manual_stable) => 1
price source: PYUSD reflector (reflector_sdex_pyusd) => 0.99985832087549 [cross-check quote_aquarius_pyusd_usdc 0.9998468584197119 +0.00 % ok]
price source: SolvBTC reflector (reflector_sdex_solvbtc) => 80500.42531767688 [cross-check onchain_aquarius_solvbtc_xlm 80618.75328743817 -0.15 % ok]
price source: TESOURO reflector (reflector_sdex_tesouro) => 0.25082705910916 [cross-check onchain_aquarius_tesouro_usdc 0.2508270591091637 +0.00 % ok]
price source: USDC stable (manual_stable) => 1
price source: USDGLO reflector (reflector_sdex_usdglo) => 0.99991601831152 [cross-check quote_aquarius_usdglo_usdc 0.9999244272422196 -0.00 % ok]
price source: USDY onchain (onchain_aquarius_usdy_usdc) => 1.133515088488666
price source: USTRY reflector (reflector_sdex_ustry) => 1.07539094604022 [cross-check onchain_aquarius_ustry_usdc 1.0753900032481072 +0.00 % ok]
price source: xSolvBTC derived (derived_quote_aquarius_xsolvbtc_solvbtc) => 80510.49858178271
price source: yUSDC reflector (reflector_sdex_yusdc) => 0.9996664427509 [cross-check quote_aquarius_yusdc_usdc 0.9996215335753389 +0.00 % ok]
price source: yXLM reflector (xlm_proxy:reflector_cex_xlm) => 0.18101718791209
reflector: { simulations: 36, retries: 0, failures: 0 }
fresh-price window: 45 min
xlm price source: reflector (reflector_cex_xlm) => 0.18101718791209; 24h change via stored_history
```

**17/17 priced, 0 disagreement, every deviation < 0.8 %** (widest: EURC +0.71 %, CEX feed vs
the Soroswap EURC/USDC pool, tolerance 3 %). Reflector is the primary for the 13 assets it
lists; USDY is on its cp pool inside the sanity band [1.00, 1.25]; USDC and oUSD stay at 1 by
convention / Blend parity. **36 simulations, 0 retries, 0 failures** (as budgeted, ≈ 5 s).
Step 9 classifies the native source as `reflector`; the 24 h change comes from stored history.

## 3. Q1 + cross-check trace (symbol | source | price | age min | sources | agrees | dev %)

```
AQUA|reflector_sdex_aqua|0.000314|9|2|true|-0.2387
BTC|reflector_cex_btc|81216.099536|9|2|true|0.5884
CETES|reflector_sdex_cetes|0.064286|9|2|true|0.2061
ETH|reflector_cex_eth|2372.284601|9|2|true|0.3007
EURC|reflector_cex_eurc|1.123321|9|2|true|0.7112
native|reflector_cex_xlm|0.181017|9|2|true|0.2642
oUSD|manual_stable|1.000000|9|1||
PYUSD|reflector_sdex_pyusd|0.999858|9|2|true|0.0011
SolvBTC|reflector_sdex_solvbtc|80500.425318|9|2|true|-0.1468
TESOURO|reflector_sdex_tesouro|0.250827|9|2|true|0
USDC|manual_stable|1.000000|9|1||
USDGLO|reflector_sdex_usdglo|0.999916|9|2|true|-0.0008
USDY|onchain_aquarius_usdy_usdc|1.133515|9|1||
USTRY|reflector_sdex_ustry|1.075391|9|2|true|0.0001
xSolvBTC|derived_quote_aquarius_xsolvbtc_solvbtc|80510.498582|9|2||
yUSDC|reflector_sdex_yusdc|0.999666|9|2|true|0.0045
yXLM|xlm_proxy:reflector_cex_xlm|0.181017|9|2||
```

Every row is 9 min old (one tick), inside the 45-min window; no dead row is the latest row of
any asset any more. `sourcesQualified = 2` for 14 assets; the three at 1 are USDC (reference
currency, 1 by convention, Reflector read traced in `metadata.reflectorUsdcUsd`), oUSD (Blend
Orbit parity peg) and USDY (no feed lists it — the founder asks Reflector).

## 4. API

```
/v1/network/stats: {"xlmPriceUsd":0.18101718791209,"xlmPriceChange24hPct":-1.3067570383210305,
"stellarTvlUsd":232626348.1148237,"stableMcapUsd":460991127.27527964,"usdcSupplyUsd":444201061.8389171,
…,"updatedAt":"2026-10-15T14:50:11.807Z"}
/v1/ops/status priceSources: {'pricedAssets': 17, 'totalAssets': 17, 'unpricedAssets': [],
'singleSourceAssets': ['USDC', 'USDY', 'oUSD'], 'disagreements': []}
```

`stellarTvlUsd` 232.6 M is consistent with XLM at −19 % since 2026-09-29 (0.2227 → 0.181):
the XLM-heavy pools fell with it while the BTC / xSolvBTC pools regained their full valuation.
`stableMcapUsd` fell from 945.7 M (29/09) to 461.0 M — **a DefiLlama-side restatement, not a
pipeline change**; diagnosed read-only in `07-stablecoin-mcap-diagnosis.md`.

Deviation from the expected block of 05 §9.3: `singleSourceAssets` also lists **USDC**
(its `manual_stable` row carries `sourcesQualified = 1`). A convention, not a weakness;
corrected in the next lot (reference currency reported apart, not in the counter).

## 5. CI status of 99b9c35 (public GitHub API, `Mael-wnb/dig-stellar`, read 2026-10-15)

`GET /repos/Mael-wnb/dig-stellar/actions/runs?head_sha=99b9c357…` and the commit's check-runs:

| Run | Branch | Event | Conclusion | Started → completed (UTC) | Duration |
|---|---|---|---|---|---|
| `ci` #74 (`build-test`) | `fix/price-max-age` | push | **success** | 14:13:23 → 14:14:05 | 42 s |
| `ci` #75 (`build-test`) | `main` | push (fast-forward) | **success** | 14:16:43 → 14:17:25 | 42 s |

(`Vercel Preview Comments` check also success at 14:13:36Z.) Both runs were green **before the
deploy of ~14:39Z**: the branch run ~25 min before, the `main` run ~22 min before.
Run links: `https://github.com/Mael-wnb/dig-stellar/actions/runs/38749464946` (#74),
`https://github.com/Mael-wnb/dig-stellar/actions/runs/38749958366` (#75).

## 6. Process gap, honestly

A first deployment was launched **before** `main` had been fast-forwarded: it deployed
`3607ea7` (two web / docs commits, no indexer or API code) while a refresh was running. No
effect on the data, but this is exactly the class of hole AD1 closes (deploy only from a
verified `main` SHA, outside a refresh window, with the pre-flight checks scripted). The
second deployment, from `99b9c35` after the 14:30Z tick, is the one verified above.

## 7. What this closes

Phase B objective met at the first tick: a real price for every asset, Reflector primary with
an agreeing on-chain cross-check for the 13 listed assets, three dollar coins never dependent
on a single feed, BTC / xSolvBTC / USDGLO off their dead rows without a visible gap. A2's null
remains the safety net and did not trigger.
