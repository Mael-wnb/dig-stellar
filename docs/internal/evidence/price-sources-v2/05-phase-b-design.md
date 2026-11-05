# Price sources v2 — phase B: recon + design (read-only, 2026-10-14)

**Nothing coded, nothing deployed.** Branch `fix/price-max-age` (A2 committed, A2-bis in the
working tree). Every on-chain figure below was read with `simulateTransaction` only (no key,
no signing) against `https://mainnet.sorobanrpc.com` at 13:31–13:33Z; prod numbers come from
the founder's read-only Q1 at ~13:10Z.

## 0. Decisions this design serves (founder, 2026-10-14)

1. No "frozen since X" badge, no stale price on screen. `null` stays the last resort (A2) but
   must be a safety net that practically never triggers: **a real price for every asset,
   ≥ 2 independent sources wherever the asset carries weight**.
2. A2 does not ship alone: **A2 + A2-bis + phase B ship in one deployment**, so BTC goes from
   69 846 straight to its real price without ever showing `—`.

## 1. Where prod stands (Q1, 2026-10-14 ~13:10Z)

| Asset | Served price | Source | Age |
|---|---|---|---|
| BTC, xSolvBTC | 69 846 | `coingecko_btc_proxy` (dead) | ~21 371 min |
| USDGLO | 0.999384 | `coingecko_direct` (dead) | ~22 001 min |
| native | 0.187632 | `onchain_sdex_xlm_usdc` | 11 min |
| SolvBTC | 81 569.95 | `onchain_aquarius_solvbtc_xlm` | 11 min |
| USTRY | 1.075507 | `onchain_aquarius_ustry_usdc` | 11 min |
| every other asset | fresh on-chain or `manual_stable` | | 11 min |

Reference reads at 13:31Z (same minute, for comparison): Reflector CEX BTC **82 481.46**,
ETH 2 465.76, XLM 0.18604, USDC 1.00084; Reflector Stellar DEX SolvBTC **81 119.64**, USDGLO
**0.99992**, PYUSD 0.99985, yUSDC 0.99962 (all `timestamp = 13:30:00Z`, age 75 s).

## 2. Reflector — read-only integration in step 1 (§a)

**Contracts** (verified again today, same ids as `00-recon.md` §c, official Stellar docs list):

| Contract | Kind | `base()` | `decimals()` | `resolution()` | Assets we need |
|---|---|---|---|---|---|
| `CAFJZQWSED6YAWZU3GWRTOCNPPCGBN32L7QV43XX5LZLFTK6JLN34DLN` | "External CEXs & DEXs" | `Other("USD")` | 14 | 300 s | `Other`: BTC, ETH, XLM, USDC, EURC |
| `CALI2BYU2JE6WVRUFYTS6MSBNEHGJ35P4AVCZYF3B6QOE3QKOB2PLE6M` | "Stellar Mainnet DEX" | `Stellar(USDC)` | 14 | 300 s | `Stellar`: native, AQUA, EURC, USDGLO, CETES, USTRY, TESOURO, SolvBTC, PYUSD, yUSDC (52 listed) |

Not in either feed: BTC/ETH *as Stellar assets* (CEX `Other` is the proxy), xSolvBTC, USDY,
yXLM, oUSD.

**Interface** (official repo `reflector-network/reflector-contract`, README read today):
- The public mainnet feeds are **ReflectorPulse** contracts: "free access to published price
  feeds", `lastprice(asset: Asset) -> Option<PriceData>`; no caller address, no `track`
  prepayment (that is the ReflectorBeam variant, `lastprice(caller, asset)`, not these ids).
  Today's simulations succeed without any subscription, as the recon's did on 2026-09-29.
- `PriceData { price: i128, timestamp: u64 }` — **timestamp in seconds**, aligned to
  `floor(now / resolution) * resolution`; price = `price / 10^decimals`.
- **No batch call**: `lastprice`, `price(asset, ts)`, `prices(asset, records)` take one asset.
  `x_last_price` / `twap` are not in the published interface — not needed.
- `Asset` is an enum ScVal: `Vec[Symbol("Other"), Symbol("BTC")]` or
  `Vec[Symbol("Stellar"), Address]`. The indexer's `simulateContractRead` (`00-common.ts`)
  only encodes address / u32 / i128 / u128 / primitives, so phase B adds one escape hatch
  `{ type: 'scval', value: xdr.ScVal }` to `ContractArg` (5 lines, no behaviour change).

**Freshness guard on the oracle timestamp.** Step 1 runs at :00 / :15 / :30 / :45 + a few
seconds; a Reflector tick lands every 300 s, so a healthy read is 0–5 min old (75 s today).
Proposal: **fresh ≤ 900 s** (three missed ticks — Reflector's own cluster would have to be
down for 15 min); older → the candidate is **absent** (never "stale but used"). The 45-min
product rule then applies to the row we write, as for every source. Rationale for 900 s
rather than 2 × resolution (600 s): a single missed tick plus our run offset (up to ~8 min
when step 1 waits on the XLM resolution) must not flip the primary source every other run.

**Base conversion for the Stellar DEX feed** (quoted in USDC): multiply by **1** — the
product's own USDC rule is `stable 1`, and every pool-implied price already treats USDC as
$1, so this keeps all sources on the same unit. The CEX `USDC/USD` read (1.00084 today) is
logged as a sanity value and raises a `#status` warning if it leaves ±1 %; it is not applied.

**RPC budget per run** (15-min cadence): 2 CEX reads (BTC, ETH) + 3 CEX sanity reads (XLM,
USDC, EURC) + 10 Stellar DEX reads = **15 `simulateTransaction` calls**, sequential with
~100 ms spacing, one `getAccount` for the whole step (not one per call — today's probe hit
HTTP 429 on the public endpoint after ~40 unspaced calls that each refetched the account).
Prod uses the operator endpoint (`STELLAR_RPC_URL`), and step 1 already issues reserve reads
of the same kind. Source strings: `reflector_cex_<sym>`, `reflector_sdex_<sym>`.

Blend's own oracle for its pools is Reflector (`fetch-user-positions.ts`, `pool.loadOracle()`):
using the same feed as primary keeps our USD figures on Blend's parity, which is the point.

## 3. Simulated quote on a pool — new source `pool_quote` (§b)

All three Aquarius pool types expose the same read-only estimator (WASM spec read on-chain
today, 80–104 functions per contract):

```
estimate_swap(in_idx: u32, out_idx: u32, in_amount: u128) -> u128          // fee included
estimate_swap_strict_receive(in_idx: u32, out_idx: u32, out_amount: u128) -> u128
get_tokens() -> Vec<Address>, get_reserves() -> Vec<u128>, get_fee_fraction() -> u32 (bps)
stable only:       get_decimals() -> Vec<u32>, get_virtual_price() -> u128
concentrated only: get_slot0() -> { sqrt_price_x96: u256, tick: i32 }, get_active_liquidity() -> u128
```

**Method per pool type (honest verdict):**

| Pool type | Method | Verdict |
|---|---|---|
| **StableSwap** (`pool_type = 'stable'`: xSolvBTC/SolvBTC, USDGLO/USDC, PYUSD/USDC, USDC/yUSDC, native/yXLM) | `estimate_swap` in **both directions** at a small size; mid = geometric mean `sqrt(out01/in × in/out10)` — the symmetric fee cancels, the curve is flat at that size, no rounding at ≥ 0.1 token (7–8 dec). Depth guard: the USDC (or quote) reserve ≥ 50 000 USD, same as the cp guard. | **Fits.** The reserve *ratio* is not a price on these pools (USDGLO/USDC ratio 1.12 for a $1 coin); the quote is. |
| **Concentrated** (`*-clpool`: BTC/USDC, native/USDC, native/AQUA, …) | **`get_slot0().sqrt_price_x96`** → `price = (sqrtP / 2^96)^2 × 10^(dec0 − dec1)` = the exact marginal price without any swap or rounding; `estimate_swap` of a sell of ≥ 0.001 token as a consistency check only (buy-side estimates round to 0 below ~0.1 USDC). Depth guard: `get_active_liquidity()` converted to the quote-side value inside the current tick ≥ 50 000 USD **and** the quote reserve ≥ 50 000 USD. | **Fits for the price, fails depth for BTC today** (see §1 of the comparison). |
| **Constant product** (Aquarius cp, Soroswap, SDEX LP) | the A1 reserve ratio already *is* the marginal price; `estimate_swap` adds nothing but the fee. | No new source — the cp ratio stays `onchain_*`. |

**Swap size**: 0.1 token for stables (1 000 000 units at 7 dec; 10 000 000 at 8 dec), i.e.
≈ $0.10 for dollar coins and ≈ $8 000 for xSolvBTC — both far below the ~$7.5 M-per-side depth
of that pool, so the quote is the marginal price. Verified today (both directions, three
sizes): the stable quotes are size-invariant to the 7th digit.

**Live numbers (13:32Z):**

| Pool | Reserves | Fee | Quote mid | Reflector | Δ |
|---|---|---|---|---|---|
| xSolvBTC/SolvBTC (stable) | 77.08 / 92.77 (8 dec) | 10 bps | xSolvBTC = **1.000125** SolvBTC | — (xSolvBTC not listed) | — |
| USDGLO/USDC (stable) | 224.7 k / 200.7 k | 10 bps | **0.999924** | 0.999919 | 0.0005 % |
| PYUSD/USDC (stable) | 4.34 M / 3.69 M | 10 bps | **0.999890** | 0.999847 | 0.004 % |
| USDC/yUSDC (stable) | 243.6 k / 427.7 k | 1 bp | yUSDC = **0.999573** | 0.999622 | 0.005 % |
| BTC/USDC (concentrated) | 0.3479 BTC / 38 685 USDC, L = 7.84e9, tick 113 229 | 30 bps | slot0 **82 648.2** (tick 82 647.0; sell-side estimate 82 645 fee-adjusted) | CEX 82 481.5 | 0.20 % |

The concentrated BTC pool is **thin**: $38.7 k of USDC and $28.7 k of BTC in range — below the
50 000 USD quote guard. Its slot0 price is excellent (0.2 % from Reflector) but it stays a
**cross-check**, not a primary, until the pool grows.

## 4. Target coverage table (§c)

Sources: **R-CEX** Reflector CEX/DEX (`Other`), **R-SDEX** Reflector Stellar DEX, **CP** pool
reserve ratio (A1, ≥ 50 k USD quote side), **Q** simulated/slot0 quote (§3), **S** stable
assumed (1). Weight = order of magnitude from `03-*` Q2 / Lot P (upper bound: whole pools).

| Asset | Weight | Sources | # | Primary → fallback | Note |
|---|---|---|---|---|---|
| native (XLM) | all pools | R-CEX XLM, R-SDEX native, CP (SDEX XLM/USDC, Soroswap, Aquarius) | 3 | R-CEX → CP → R-SDEX | resolved first; everything XLM-quoted depends on it |
| USDC | ~all | S (=1); R-CEX USDC as sanity | 1 (+1) | S | by convention — the unit of every other price |
| SolvBTC | ~20 M | R-SDEX, CP (native/SolvBTC $6.5 M), R-CEX BTC as sanity (wrapper peg) | 2 (+1) | R-SDEX → CP | |
| xSolvBTC | ~10 M | SolvBTC price × Q (stable pool, $7.5 M/side) | 2 (derived) | SolvBTC × Q | ratio has one source; the base has two. Reflector lists neither xSolvBTC nor a second pool |
| BTC | ~0.8 M (clpool + BTC/ETH) | R-CEX BTC (proxy: the Stellar wrapper assumed at parity), Q slot0 (thin, cross-check only) | **1 strong + 1 weak** | R-CEX → Q only if depth ≥ guard | **option**: BTC/ETH cp pool ($430 k) gives BTC = ETH × ratio with ETH from R-CEX → a second qualifying source |
| ETH | ~0.9 M | R-CEX ETH, CP (aquarius-eth-usdc, depth to confirm in prod Q2b) | 2 | R-CEX → CP | |
| USDGLO | 0.4 M | R-SDEX, Q (stable pool, $200 k USDC side) | 2 | R-SDEX → Q | |
| PYUSD | 8 M | R-SDEX, Q ($3.7 M USDC side) | 2 | R-SDEX → Q | leaves the `stable 1` assumption |
| yUSDC | 0.9 M | R-SDEX, Q ($2.4 M USDC side) | 2 | R-SDEX → Q | leaves the `stable 1` assumption |
| USTRY | Blend pools | R-SDEX, CP (Aquarius, Soroswap) | 2 | R-SDEX → CP | |
| CETES | Blend pools | R-SDEX, CP | 2 | R-SDEX → CP | |
| TESOURO | Blend | R-SDEX, CP | 2 | R-SDEX → CP | |
| EURC | Blend + pools | R-SDEX, R-CEX EURC, CP (Soroswap, SDEX) | 3 | R-SDEX → CP → R-CEX | |
| AQUA | 1.9 M | R-SDEX, CP (aqua/usdc, native/aqua, SDEX) | 2 | R-SDEX → CP | |
| yXLM | 0.9–1.3 M | XLM × Q (native/yXLM stable pool $939 k) | 2 (derived) | XLM × Q | today a bare `proxy XLM` (×1); Q gives the real ratio |
| **USDY** | 2 M | CP (aquarius-usdy-usdc) only | **1** | CP | Reflector does not list it. **Options**: (a) accept single-source with a sanity band [0.95, 1.40] (NAV token, 1.1338 today); (b) ask Reflector to list it (they add assets on request); (c) a second pool if one exists on Soroswap/SDEX — none known |
| **oUSD** | small (YieldBlox) | S only | **1** | S | no pool, no feed. **Options**: keep `stable 1` with a `#status` "assumed" counter, or ask Reflector |

Result: every asset with material weight has ≥ 2 sources except **USDY** (single pool) and
**oUSD** (assumed). BTC reaches 2 only with the BTC/ETH option.

## 5. Selection and cross-check (§d)

Per asset, step 1 builds the candidate list in the order of §4 and applies:

1. **Freshness**: Reflector `timestamp` ≤ 900 s; pool reserves / quote ≤ 60 min (existing);
   anything older is absent.
2. **Depth** (pools only): quote side ≥ 50 000 USD (existing cp guard, reused for Q).
3. **Primary** = the first fresh candidate in the order of §4 — Reflector wherever it lists
   the asset (consistency with Blend's oracle), otherwise the deepest pool.
4. **Cross-check** = the next fresh, qualifying candidate. Deviation
   `|primary − secondary| / secondary`, tolerance **1 %** for dollar-pegged / NAV coins (USDC
   pairs, USDGLO, PYUSD, yUSDC, USTRY, CETES, TESOURO, USDY) and **3 %** for XLM, BTC, ETH,
   SolvBTC, xSolvBTC, EURC, AQUA (the 10 % CoinGecko guard of A1 becomes this).
5. **On disagreement**: the primary is **kept** (Reflector aggregates several nodes and
   exchanges; a pool can be thin or nudged), the row is written with
   `metadata.crossCheck = { secondary, secondarySource, deviationPct, agrees: false }` and
   the run logs `price source: BTC reflector (reflector_cex_btc) => 82481 — DISAGREES with
   pool_quote_aquarius_btc_usdc 90000 (+9.1 %)`. If the primary is a pool (no Reflector) and
   the only cross-check disagrees, same rule: keep, flag. Nothing is silently averaged.
6. **No primary** (every candidate absent or too thin) → no row (A2's null), logged with the
   rejected list, exactly as A1 does today.

Trace: `asset_prices.source` = the primary's source string; `metadata` carries every
candidate evaluated (`{ source, priceUsd, observedAt, qualified, rejected }`) plus the
cross-check block. One row per asset per run — the readers' "latest row" logic is untouched.
The `manual` env overrides stay first and are traced as today.

**`#status`** (the page must show the health of the price sources actually used):
- `/v1/ops/status` gains one component **"Price coverage"** computed at read time from the
  latest fresh `asset_prices` row per active asset: `priced / total`, `singleSource` count,
  `disagreements` count (from `metadata.crossCheck.agrees = false`), `assumed` count
  (`manual_stable`). State: operational when every asset is priced and no disagreement;
  degraded on any disagreement or single-source asset with weight; failed when an asset is
  unpriced. Message e.g. `17/17 priced · 2 single-source · 0 disagree`.
- Reflector reads are RPC calls, so `ops-metrics.ts` would count them under `soroban-rpc`.
  Phase B records them under a new `OpsTarget` **`price-oracle`** (explicit
  `recordOpsSample` around each Reflector read; `rpc_metrics_runs.target` is free text, and
  the status rows are built per distinct target, so the "Reflector oracle" row appears by
  itself; `RPC_LABELS` gets the label). Error rate ≥ 25 % → the row turns degraded as for
  the other targets.

## 6. SQL (§e)

**Zero SQL.** New `asset_prices.source` strings (text), richer `metadata` (jsonb, already
`not null default '{}'`), a new `rpc_metrics_runs.target` value (text, no check constraint),
and the coverage component is computed at read time. Nothing needs a migration runner (AD2).
Note `asset_prices.price_usd` is `not null`: "no price" is an absent row, as today.

## 7. Plan, commits, estimate, single deployment (§f)

Commits on `fix/price-max-age` (after the three A2 commits), in this order:

| # | Commit | Scope | Estimate |
|---|---|---|---|
| 1 | `fix(api): fresh-price rule in the alert evaluator (price + TVL-drop)` | A2-bis alerts — done, in the working tree | — |
| 2 | `fix(api): rank NULL-TVL pools last in /v1/pools sorts` | A2-bis API — done, in the working tree | — |
| 3 | `feat(indexer): Reflector oracle reader (Pulse lastprice, fresh ≤ 900 s)` | `shared/reflector.ts` (+ `ContractArg` scval escape hatch), unit tests on decoding / freshness with fixtures, no wiring yet | 2 h |
| 4 | `feat(indexer): pool quote source (stable mid, concentrated slot0)` | `shared/pool-quote.ts`, depth guard, tests (fixtures from today's probe) | 2 h 30 |
| 5 | `feat(indexer): multi-source price selection with cross-check trace` | `shared/price-select.ts` (candidates → primary/secondary/deviation, metadata), `pricing-config.ts` rule kinds (`reflector`, `quote`, `derived`), step 1 wiring, tests; `discovery/qa-price-sources.ts` (read-only comparison table) | 2 h 30 |
| 6 | `feat(ops): price coverage component and price-oracle target on #status` | api `ops.service.ts` + `status.ts`, indexer `ops-metrics.ts` target, web `StatusView` label, spec | 1 h 30 |
| 7 | `docs(prices): phase B evidence, runbook and status board` | `06-phase-b-implementation.md` (incl. the pre-deploy comparison), `runbooks.md`, `status-board.md` | 1 h |

Honest total: **~10 h of work → two working days** with the local validation runs, before
the founder's review. Everything stays on one branch, rebased on `origin/main` just before
the push, and ships in **one deployment** (indexer + API change → the A2 deploy block of
`04-phase-a2.md`: install, prisma generate, API build, pm2 restart with `GIT_SHA`, `/health`
version == HEAD, right after a refresh tick).

**Pre-deploy comparison table** (produced by `qa-price-sources.ts` against mainnet RPC +
the founder's Q1, read-only, like A1's `03-*`): one row per asset —
`served today (Q1) | R-CEX | R-SDEX | CP | Q | selected | source | cross-check Δ`. Today's
partial version, from this recon:

| Asset | Served (Q1 13:10Z) | R-CEX | R-SDEX | CP (A1) | Q | Would select | Δ vs served |
|---|---|---|---|---|---|---|---|
| BTC | 69 846 (dead) | **82 481.5** | — | — | 82 648 (thin) | 82 481.5 `reflector_cex_btc` | **+18.1 %** |
| xSolvBTC | 69 846 (dead) | — | — | — | SolvBTC × 1.000125 | ≈ 81 130 `derived_solvbtc_quote` | **+16.2 %** |
| USDGLO | 0.999384 (dead) | — | **0.999919** | — | 0.999924 | 0.999919 `reflector_sdex_usdglo` | +0.05 % |
| SolvBTC | 81 569.95 | (BTC 82 481 sanity) | **81 119.6** | 81 570 | — | 81 119.6 `reflector_sdex_solvbtc` | −0.55 % (Δ CP 0.55 %, agrees) |
| native | 0.187632 | **0.18604** | (to read) | 0.18763 | — | 0.18604 `reflector_cex_xlm` | −0.85 % (agrees, 3 % band) |
| PYUSD | 1 (assumed) | — | **0.999847** | — | 0.999890 | 0.999847 | −0.02 % |
| yUSDC | 1 (assumed) | — | **0.999622** | — | 0.999573 | 0.999622 | −0.04 % |

Expected effect on the network TVL: the BTC/xSolvBTC pools regain their full valuation at
the real price (instead of the −14 % stale BTC today, or the A2-alone removal), SolvBTC moves
−0.5 %, stables by < 0.1 %: a net change of a few hundred thousand USD on ~$230 M. The dead
rows never show as `—`: the first refresh after the deploy writes `reflector_*` rows for BTC,
xSolvBTC and USDGLO in the same run that A2's rule starts ignoring the old ones.

## 8. Founder arbitrations (2026-10-14) and tranche 1 — modules + read-only comparison

Arbitrations: BTC primary = Reflector CEX, second source = BTC/ETH cp pool via Reflector ETH
if its ETH side ≥ 50 000 USD, clpool slot0 = control only; the Blend pool oracles are checked
as a source before any sanity band; tolerances 1 % / 3 %, Reflector window 900 s; PYUSD and
yUSDC leave `stable 1` (Reflector SDEX primary, stable-pool quote as control); USDC stays 1
with the Reflector USDC/USD read as sanity; every read goes through the configured RPC,
sequentially, and a 429 / timeout makes the source absent for the run, never the refresh fail.

### 8.1 Blend pool oracles — verdict (read-only, 13:55Z and 14:03Z)

Every Blend pool points at its **own** oracle adapter contract (`pool.metadata.oracle`),
SEP-40 surface (`lastprice`, `decimals`, `base`, `assets`; **no** `resolution()` /
`last_timestamp()`), decimals 7 or 14:

| Pool | Oracle | `base()` | dec | Reserves priced | Values (14:03Z) |
|---|---|---|---|---|---|
| blend-fixed-pool | `CCVTVW2C…POATS` | Other(USD) | 7 | native, USDC, EURC | = Reflector **CEX** (XLM 0.184921, EURC 1.113208, USDC 1.000835) |
| blend-etherfuse-pool | `CAVRP26C…2HALS` | Other(USD) | 14 | native, USDC, CETES, USTRY, TESOURO | = Reflector **CEX** for XLM/USDC; CETES 0.064478, USTRY 1.077035, TESOURO 0.251925 |
| blend-yieldblox-pool | `CD74A3C5…MXXR` | Stellar(USDC) | 7 | native, USDC, EURC, AQUA, USDGLO, USTRY, CETES, PYUSD | = Reflector **SDEX** (XLM 0.185355, EURC 1.107339, AQUA 0.000325, USTRY 1.075506, CETES 0.064030); USDC, USDGLO, PYUSD = **1, pegged** |
| blend-orbit-pool | `CAD2MCFU…OTUU` | (none) | 14 | native, USTRY, CETES, oUSD | = Reflector **SDEX**; oUSD = **1, pegged** |

Two facts decide the design:
- The market entries carry 300 s-aligned timestamps and **equal the public Reflector feeds**
  to the digit: the adapters are proxies of the two Reflector contracts, not independent
  observations. They give **parity with Blend** (the figure Blend's health factors use), not a
  second source. Source label `blend_oracle_<pool>_<sym>`, role = control.
- The pegs (USDC, PYUSD, USDGLO in yieldblox; oUSD in orbit) are hard-coded at 1 and stamped
  with the **current ledger time** (age 1–9 s, off the 300 s grid). `isPeggedTimestamp`
  flags them `pegged`: a peg assumption, never counted as a market source. **oUSD therefore
  stays single-source** (Blend values it at 1 by assumption, so do we — parity holds), and
  **USDY is not held by any Blend pool**, so the Blend oracle does not cover it either.

USDY stays single-source (the aquarius-usdy-usdc cp pool): tranche 2 applies a sanity band
**[1.00, 1.25]** (NAV token, 1.1338 on 2026-09-29) and a bounded daily move (|Δ 24 h| ≤ 2 %,
checked against our own previous row), and the `#status` "single-source assets" counter
lists it with oUSD. The founder will ask Reflector to list USDY.

### 8.2 Tranche 1 — what was built (uncommitted, tests green)

| File | Role |
|---|---|
| `shared/soroban-read.ts` (+ test) | `SorobanReader`: sequential simulations through `resolveRpcUrl()`, one account fetch per reader, 120 ms spacing, 15 s timeout, one retry after 2 s on 429 / timeout / network, never throws (`ReadResult`), call stats. `scU32` / `scU128` builders |
| `discovery/00-common.ts` | `ContractArg` gains `{ type: 'scval', value }` so `simulateContractRead` can pass an enum / struct argument |
| `shared/reflector.ts` (+ test) | contract ids, `oracleAssetScVal` (enum encoding), `scalePrice` (exact i128 → float), `decodeOraclePrice`, `judgeOraclePrice` (≤ 900 s), `isPeggedTimestamp`, `readOracleDecimals` (cached), `readOraclePrice` |
| `shared/blend-oracle.ts` | `discoverBlendOracles` (SDK `PoolV2.load`, per-pool failure isolated), `readBlendOraclePrice` on the same SEP-40 reader |
| `shared/pool-quote.ts` (+ test) | `stableMidPrice` (geometric mean of both directions), `slot0Price`, `readStablePoolQuote` (4 reads), `readConcentratedPoolPrice` (slot0 + sell-side consistency), depth guard at 50 000 USD |
| `discovery/qa-price-sources.ts` | read-only comparison table: served (DB) vs R-CEX, R-SDEX, Blend oracles, CP (DB batches), Q, BTC two-hop; reader stats |

Tests: `pnpm -C apps/indexer test` → **29 pass** (14 before + 15 new: enum encoding, exact
scaling with the 13:30Z BTC row, freshness, peg detection, stable mids reproducing the probe
to 2e-6, slot0 → 82 648, error classification, u128 round-trip). `tsc --noEmit`: no error in
the new files.

### 8.3 Comparison table — local run, 2026-10-14 14:03Z (RPC: operator endpoint)

"Served" and "CP" come from the **local** DB (batches of 2026-09-29 → CP rejected as stale
here; in prod both columns are live — the founder runs the same script on the VPS). Oracle
reads are live mainnet.

| Asset | Served (local) | R-CEX | R-SDEX | Blend oracle | Q (pool, quote side) | two-hop | Δ R→pool |
|---|---|---|---|---|---|---|---|
| BTC | 80 986 (dead proxy) | **82 541.65** | — | — | 82 637 (clpool slot0, **38 670 USD THIN**, sell-est 82 607) | **81 822.76** (BTC/ETH, ETH side 282 436 USD ✓) | +0.12 % (clpool), −0.87 % (two-hop) |
| xSolvBTC | 80 986 (dead proxy) | — | — | — | **81 093.26** (= SolvBTC 81 083.11 × 1.000125, quote side 7.52 M USD) | — | — |
| SolvBTC | 80 986 | — | **81 083.11** | — | — | — | — |
| USDGLO | 0.999339 (dead) | — | **0.999918** | yieldblox 1 (peg) | 0.999924 (200 731 USD) | — | 0.00 % |
| PYUSD | 1 (assumed) | — | **0.999857** | yieldblox 1 (peg) | 0.999890 (3.69 M USD) | — | 0.00 % |
| yUSDC | 1 (assumed) | — | **0.999608** | — | 0.999576 (243 998 USD) | — | −0.00 % |
| yXLM | XLM × 1 | — | — | — | **0.185181** (native/yXLM stable, 302 003 USD; XLM 0.184921 × 1.0014) | — | — |
| native | — | **0.184921** | 0.185355 | fixed/etherfuse = CEX, orbit/yieldblox = SDEX | — | — | — |
| ETH | — | **2 459.78** | — | — | — | — | — |
| EURC | — | 1.113208 | **1.107339** | fixed = CEX, yieldblox = SDEX | — | — | CEX vs SDEX 0.53 % |
| USTRY | — | — | **1.075506** | etherfuse 1.077035, orbit/yieldblox 1.075506 | — | — | — |
| CETES | — | — | **0.064030** | etherfuse 0.064478, orbit/yieldblox 0.064030 | — | — | — |
| TESOURO | — | — | **0.251045** | etherfuse 0.251925 | — | — | — |
| AQUA | — | — | **0.000325** | yieldblox 0.000325 | — | — | — |
| USDC | 1 | 1.000835 (sanity) | — | 1.000835 / 1 (peg) | — | — | — |
| oUSD | 1 (assumed) | — | — | orbit **1 (peg)** | — | — | single-source |
| USDY | — | — | — | — (not in Blend) | — | — | single-source (cp pool only) |

Run: **74 simulations, 0 retries, 0 failures, 10 s** end to end. Step 1 in prod will do
fewer (token orders and fees cached, Blend oracle reads limited to the parity controls):
≈ 50 sequential simulations ≈ 7 s per 15-min run, sequential with 120 ms spacing.

## 9. Tranche 2 — the lightweight production rule (2026-10-14, code + tests, uncommitted)

Founder decision after tranche 1: the simplest robust fix, not a machine. Production (step 1):

1. **Reflector primary** for every asset it lists — CEX feed for XLM / BTC / ETH / EURC
   (USDC read as sanity only), Stellar DEX feed for AQUA, USDGLO, CETES, USTRY, TESOURO,
   SolvBTC, PYUSD, yUSDC — fresh ≤ 900 s. The feed's `assets()` is read once per run; the
   tokens it lists are read by contract id, so a newly listed asset (USDY, one day) is picked
   up with no code change.
2. **Fallback = the A1 rule**, which is also the **cross-check** of the primary (1 % / 3 %,
   primary kept, `metadata.crossCheck`, never averaged). New cp quote kind `eth`:
   `aquarius-btc-eth-pool` prices BTC through this run's Reflector ETH (`onchain_aquarius_btc_eth`).
3. **Stable-pool quote** where it is the only source — xSolvBTC = SolvBTC × the
   xSolvBTC/SolvBTC mid (`derived_quote_aquarius_xsolvbtc_solvbtc`, pool ≥ 50 000 USD) — and,
   **founder decision 2026-10-15**, for the three dollar coins whose only pool is StableSwap
   (USDGLO, PYUSD, yUSDC): the pool's mid quote vs USDC (`quote_aquarius_<asset>_usdc`,
   `estimate_swap` both ways, geometric mean, ≥ 50 000 USD) is the **fallback when Reflector is
   absent and the cross-check when it is primary** (1 %, primary kept, traced). Three
   stablecoins must never go to "no price" because one feed is down.
4. **Not in production**: the BTC/USDC clpool slot0 (thin) and the Blend pool oracles
   (Reflector proxies + hard-coded pegs, §8.1). Both remain in `discovery/qa-price-sources.ts`
   only (`shared/blend-oracle.ts`, `readConcentratedPoolPrice` are discovery-only code).
5. **USDY**: sanity band [1.00, 1.25] + |Δ 24 h| ≤ 2 % vs our previous row (≤ 36 h old), else
   no row with the reason logged. **oUSD**: `manual_stable` 1 (Blend Orbit parity), documented
   single-source. **USDC**: 1 by convention; `metadata.reflectorUsdcUsd` traces the oracle read
   and flags beyond ±1 %.
6. **PYUSD / yUSDC / USDGLO** leave `stable 1` / the dead CoinGecko id: Reflector Stellar DEX
   primary + their stable-pool quote as fallback / cross-check (point 3) → `sourcesQualified
   = 2`. **Only USDY and oUSD stay single-source**, by nature (USDY listed by no feed, oUSD
   fixed at 1 like Blend).
7. **`#status`, minimal**: the `price-oracle` target ("Reflector oracle" row, recorded by the
   reader hook around every simulation — also counted once more by the Soroban RPC row) and a
   `priceSources` field in `/v1/ops/status` (assets priced / unpriced / single-source /
   cross-check disagreements, from the latest FRESH row per asset — `summarizePriceSources`,
   pure, tested) rendered as one line under the groups of the status page. No new component.

### 9.1 Files

| File | Change |
|---|---|
| `shared/xlm-price.ts`, `xlm-price-db.ts` | `QuoteKind` gains `eth`; `candidatesFromPools(symbol, sets, xlmUsd, ethUsd)`; `resolveAssetPrice({ ethUsd })`; method label `pool_implied_vs_<kind>` |
| `shared/price-select.ts` (+ test, 12 cases) | `crossCheckTolerancePct`, `crossCheck`, `applySanityBand`, `combineSources`, `describeCrossCheck`, `stableQuoteResolution`, `mergeFallbacks` |
| `shared/pricing-config.ts` | rule kinds `oracle` (BTC, SolvBTC; USDGLO, PYUSD, yUSDC with `stableQuotePool`) and `derived` (xSolvBTC), `sanity` on USDY, `REFLECTOR_CEX_TICKERS` |
| `ingest/62-price-reference-assets.ts` | `SorobanReader` once per run (hook → `price-oracle`), `readReflector` (CEX first, then the Stellar DEX listing), order native → ETH → others → derived, `readPoolQuote` (shared by the three stable quotes and xSolvBTC), `combineSources`, sanity band, `resolveDerived`; summary line gains `reflector: { simulations, retries, failures }` |
| `ingest/73-network-stats-refresh.ts` | `kindOfSource`: `reflector_*` → `reflector` (was falling to `none`) |
| `shared/soroban-read.ts` | `onSample` hook |
| `lib/ops-metrics.ts` | `OpsTarget` + `price-oracle` |
| api `ops/status.ts` (+ spec) | `RPC_LABELS['price-oracle']`, `summarizePriceSources`, `priceSources?` on the payload |
| api `ops/ops.service.ts` | one lateral query on `assets` × latest fresh `asset_prices` row (A2 `freshPriceSql`) |
| web `api/ops.ts`, `views/StatusView.vue` | type + one "Price sources ·" line (warning tone when unpriced / disagreement) |

Tests: indexer **41 pass** (`pnpm -C apps/indexer test` — the four stable-quote cases: Reflector
fresh + quote agrees → two sources; Reflector absent → the quote is the price; deviation > 1 % →
primary kept and traced; thin pool → no fallback, no cross-check), API **17 suites / 159 tests**,
`nest build` OK, `vue-tsc -b && vite build` OK, indexer `tsc --noEmit` clean on the touched files.

### 9.2 Local run of step 1 (local DB of 2026-09-29, live RPC, 17:20Z and 17:28Z)

```
price source: native reflector (reflector_cex_xlm) => 0.18463347398544
price source: BTC reflector (reflector_cex_btc) => 81900.77363397487
price source: ETH reflector (reflector_cex_eth) => 2444.5212125351118
price source: EURC reflector (reflector_cex_eurc) => 1.11384820274003
price source: SolvBTC reflector (reflector_sdex_solvbtc) => 81218.1666535692
price source: xSolvBTC derived (derived_quote_aquarius_xsolvbtc_solvbtc) => 81235.46835834222
price source: oUSD stable (manual_stable) => 1
price source: USDY none (none) => null      # local reserves are 15 days old → no cp candidate; live in prod
reflector: { simulations: 21, retries: 0, failures: 0 }   inserted: 16, skipped: 1   (3.3 s)
```
Re-run on 2026-10-15 after the stable-quote decision (same local DB, live RPC):
```
price source: PYUSD reflector (reflector_sdex_pyusd) => 0.99985813243762 [cross-check quote_aquarius_pyusd_usdc 0.9998468584197119 +0.00 % ok]
price source: USDGLO reflector (reflector_sdex_usdglo) => 0.99991359514166 [cross-check quote_aquarius_usdglo_usdc 0.9999244272422196 -0.00 % ok]
price source: yUSDC reflector (reflector_sdex_yusdc) => 0.99966200844351 [cross-check quote_aquarius_yusdc_usdc 0.9996585239787336 +0.00 % ok]
reflector: { simulations: 36, retries: 0, failures: 0 }   inserted: 16   (5.1 s wall time)
asset_prices: PYUSD / USDGLO / yUSDC → sourcesQualified 2, crossCheck.agrees true, secondarySource quote_aquarius_<asset>_usdc
```
Written metadata (BTC): `method: reflector_primary`, `reflector: { priceUsd, observedAt, ageSec: 300 }`,
`crossCheck: null` here (stale local reserves) — in prod the BTC/ETH pool fills it —,
`fallback.rejected: [...]`, `sourcesQualified`. USDC row: `reflectorUsdcUsd: { priceUsd: 1.00041,
deviationPct: 0.04, withinBand: true }`. xSolvBTC: `ratio 1.000125, quoteReserveUsd 7.53 M`.

**RPC budget per run (recounted, 2026-10-15):** 1 `assets()` + 2 `decimals()` (cached per
contract) + 5 CEX `lastprice` (XLM, BTC, ETH, EURC, USDC sanity) + 10 Stellar DEX `lastprice`
+ 4 stable-pool quotes × 5 (`get_tokens`, `get_reserves`, `get_fee_fraction`, 2 × `estimate_swap`:
xSolvBTC, USDGLO, PYUSD, yUSDC) = **36 sequential simulations, ≈ 5 s** at 120 ms spacing
(measured 5.1 s wall time locally, 0 retries). Blend oracle: 0. Concentrated pool: 0. Against a
7–8 min refresh this is noise; a 429 / timeout costs one 2 s backoff per failed read, then the
source is absent for the run.

### 9.3 Single deployment — A2 + A2-bis + B (commandes pour Maël)

Rebase first (two web-only commits on `origin/main`, no overlap):
```bash
git fetch origin
git rebase origin/main
git log --oneline origin/main..HEAD        # A2 (3) + A2-bis (3) + B tranche 1 (5) + B tranche 2 (4) commits
git diff --stat origin/main..HEAD | tail -1
# then push (branch + PR, or fast-forward main) — the deploy block expects origin/main to carry it
```

Deploy right after a refresh ends (:09 / :24 / :39 / :54). **The API changes** → build + restart:
```bash
export PATH=/root/.nvm/versions/node/v24.19.0/bin:$PATH
cd /root/dig-stellar
git status --short                                          # must print NOTHING
git fetch origin && git merge --ff-only origin/main && git log -1 --format='%h %ci %s'
pnpm install --frozen-lockfile
pnpm -C packages/db prisma:generate
pnpm -C apps/api build                                      # REQUIRED: stellar.service / alerts / ops changed
cd /root/dig-stellar/apps/api
GIT_SHA=$(git -C /root/dig-stellar rev-parse --short HEAD) pm2 restart dig-stellar-api --update-env && pm2 save
sleep 3; curl -s http://127.0.0.1:3000/health | head -c 200; echo     # version == HEAD, db.ok true
```
(`STELLAR_SOURCE_ACCOUNT` verified present in `apps/indexer/.env` on 2026-10-15; the API does not
read it — it only reads `asset_prices` and the ops tables.)

Verification at the next refresh tick (:09 / :24 / :39 / :54 + 1 min):
```bash
# step 1: one line per asset, the reflector summary, no DISAGREES / no "no qualifying source"
grep -n "price source:\|reflector:\|no qualifying source\|DISAGREES\|fresh-price window" /var/log/dig-stellar-refresh.log | tail -24
# Q1: source + age per asset — every age < 45, BTC/xSolvBTC/USDGLO/PYUSD/yUSDC on reflector_* / derived_*, oUSD manual_stable, USDY onchain_aquarius_usdy_usdc
docker exec -i dig_stellar_postgres psql -U dig -d dig_stellar -Atc "select a.symbol, ap.source, round(ap.price_usd::numeric, 6) as price_usd, ap.observed_at, round(extract(epoch from (now() - ap.observed_at))/60) as age_min from (select distinct on (asset_id) * from asset_prices order by asset_id, observed_at desc) ap join assets a on a.id = ap.asset_id where a.chain = 'stellar-mainnet' order by age_min desc, a.symbol"
# cross-check trace per asset (sources, agreement, deviation)
docker exec -i dig_stellar_postgres psql -U dig -d dig_stellar -Atc "select a.symbol, ap.source, ap.metadata->>'sourcesQualified' as sources, ap.metadata->'crossCheck'->>'agrees' as agrees, ap.metadata->'crossCheck'->>'deviationPct' as dev_pct, ap.metadata->'crossCheck'->>'secondarySource' as secondary from (select distinct on (asset_id) * from asset_prices order by asset_id, observed_at desc) ap join assets a on a.id = ap.asset_id where a.chain = 'stellar-mainnet' order by a.symbol"
# network TVL and the BTC pools
curl -s https://stellar-api.getdig.ai/v1/network/stats | head -c 400; echo
curl -s https://stellar-api.getdig.ai/v1/pools/aquarius-btc-usdc-clpool | head -c 700; echo
curl -s "https://stellar-api.getdig.ai/v1/pools?protocol=aquarius&sort=tvlUsd&order=desc" | head -c 600; echo
# #status: the Reflector oracle row + the priceSources field
curl -s "https://stellar-api.getdig.ai/v1/ops/status?window=24h" | python3 -c "import sys,json; d=json.load(sys.stdin); print([c['label'] for c in d['components'] if c['kind']=='rpc']); print(d.get('priceSources'))"
```
Expected: `/health` version == HEAD; Q1 every age < 45 min; BTC ≈ Reflector CEX (≈ 82 k, not
69 846) with `crossCheck.secondarySource = onchain_aquarius_btc_eth` and `agrees = true`;
xSolvBTC ≈ SolvBTC × 1.000125; USDGLO / PYUSD / yUSDC ≈ 0.9996–0.9999 on `reflector_sdex_*`
with `crossCheck.secondarySource = quote_aquarius_<asset>_usdc`, `agrees = true`,
`sourcesQualified = 2`; `network/stats` TVL moves by the BTC / xSolvBTC revaluation (≈ +16 % on
their pools) and the SolvBTC −0.5 %; the BTC/USDC clpool shows a numeric TVL again;
`/v1/ops/status.priceSources` = `{ pricedAssets: 17, totalAssets: 17, unpricedAssets: [],
singleSourceAssets: [USDY, oUSD], disagreements: [] }`; the "Reflector oracle" row appears on
#status at the first persisted run.

## 10. Closed points (all arbitrated 2026-10-14: BTC second source, USDY/oUSD, tolerances, PYUSD/yUSDC, lightweight scope)

1. BTC second source: accept the BTC/ETH cp option (ETH from Reflector) or stay at 1 strong +
   1 weak until the clpool deepens?
2. USDY / oUSD single-source: sanity band + `#status` counter, or ask Reflector to list them?
3. Tolerances 1 % / 3 % and the 900 s Reflector window — confirm or adjust.
4. PYUSD / yUSDC leaving `stable 1`: confirm (they move by < 0.05 % today, so no visible change).
