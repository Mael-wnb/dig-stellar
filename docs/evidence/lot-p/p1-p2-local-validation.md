# Lot P — P1 (registry + seed) & P2 (local refresh validation)

Executed 2026-08-16 on founder ratification of the P0 inventory (scope: the 12 §5 additions +
the P0b top tier USDY/yXLM/yUSDC/BTC/ETH and their unlocked pools; XAUm/SHX/XRP/yBTC/yETH/BLND
deferred to a fast-follow; USDM1/USST/sUSD stay excluded per the §6 honest boundary).
**STOPPED after P2 — no VPS touched** (SSH host-key confirmation pending founder-side).

## What landed (all local)

- **19 new entities** in `core-registry.json`: 17 Aquarius (11 constant_product/stable + 6
  concentrated) + 2 Soroswap pairs. Perimeter: Aquarius 4→21, Soroswap 2→4 registry-active.
  Slugs use `-clpool` to distinguish concentrated pools from same-pair siblings; token order,
  fee, pool_type, and (for concentrated) tick_spacing come from the venue's own data, with
  fee/type cross-checked against on-chain `get_info` for every concentrated pool.
- **5 new assets** (USDY, yXLM, yUSDC, BTC, ETH — SAC ids cross-checked between the venue token
  registry and the pools' own `tokens_addresses`; no symbol collisions in `assets`).
- **5 pricing rules** in `pricing-config.ts` (P0b top tier): USDY → coingecko
  `ondo-us-dollar-yield`, ETH → coingecko `ethereum`, yXLM → XLM proxy, BTC → BTC proxy,
  yUSDC → stable 1:1. Verified in `asset_prices` after the run: proxies carry
  `confidence: medium` (like SolvBTC), coingecko-direct `high`.
- **Fix in `63-price-soroswap-derived.ts`**: the derived-price step runs BEFORE the soroswap
  reserve writer, so the FIRST cycle after seeding a new pair found no reserve snapshots and
  went red (3 retries + backoff, 59.4s wasted, exit 1). It now logs and skips — the pair prices
  on the second cycle. Verified: run 1 failed exactly this way pre-fix, run 2 green (1.9s).
  `Missing entity` (a real config error) is still fatal.
- **`74-soroswap-pairs-tvl-scan.ts`** (new discovery script, committed per founder): enumerates
  all 214 Soroswap pairs from the venue's factory contract with token/reserve reads;
  incremental re-runs re-probe only unresolved pairs.
- `bootstrap:core` (idempotent) seeded everything; `bootstrap:logos` matched 4 asset logos;
  `bootstrap:export` round-trip is clean — the committed registry regenerates from the DB with
  only `generatedAt` differing.
- Docs updated: `current-state.md` (§5 coverage table + Lot P block + native/EURC revival
  note), `status-board.md` (T3-D1 addendum), `runbooks.md` (perimeter-widening procedure).

## Native/EURC correction vs P0

P0 read the missing `soroswap-native-eurc-pair` as "prod never re-seeded". The real story
(per `current-state.md`): the pair was **archived on-chain** (all reads 404) and deliberately
soft-disabled in June. It has since been **restored on-chain with real liquidity** — the factory
scan and both local refresh runs read it cleanly at ≈$415k. `bootstrap:core` re-enables it
(`is_active` is part of the upsert), which is now the correct state. Net Soroswap on prod after
deploy: 1 → 4 active pairs.

## Refresh timings (local, same machine, Postgres in Docker)

| Step | BEFORE (4+2 pools) | AFTER run 1 (first post-seed) | AFTER run 2 (steady state) |
|---|---:|---:|---:|
| prices:reference | 0.7s | 0.9s | 0.8s |
| prices:soroswap-derived | 1.1s | 59.4s FAILED¹ | 1.9s |
| blend | 8.9s | 9.2s | 8.5s |
| soroswap | 4.6s | 9.1s | 8.2s |
| aquarius | 41.4s | 168.7s | 166.5s |
| stellar-native | 186.9s | 379.6s² | 188.0s |
| defindex | 4.4s | 3.7s | 4.7s |
| others (metrics/allbridge/network) | 2.6s | 2.6s | 2.4s |
| **Total** | **250.8s (4:11)** | 633.2s² | **381.1s (6:21)** |

¹ The first-cycle ordering issue described above — fixed, run 2 green.
² `stellar-native` doubled in run 1 only (its code path is a static Horizon pair list — nothing
Lot P touches). Run 2 restored the ~187s norm on the wider perimeter: transient Horizon
slowness, plausibly residual rate-limiting from the P0 factory scans.

**Steady state: 381.1s — under the founder's 7.5-min lever threshold; the Aquarius spacing
lever was NOT needed.** Marginal cost per Aquarius pool ≈ 7.4s (≈2.4s work + 5s inter-pool
spacing; the spacing alone now accounts for 100s of the total — it remains the first lever if
the VPS runs hotter). Projected VPS total from the prod baseline (268s) + measured deltas
≈ **400s (6:40)**, comfortably inside the 15-min cadence. Memory: nothing unusual locally;
the new writers are the same light HTTP + inserts (VPS 1 vCPU / 1 GB note stands).

## TVL cross-check (ours vs venue / stellar.expert, same hour)

Full table in `p2-tvl-crosscheck.txt`. Aquarius reference = `amm-api.aqua.network` fresh fetch;
Soroswap reference = stellar.expert independent contract valuation (hotfix method).
**24 of 25 pools within ±3.1%** (most within ±0.6%); every concentrated pool ≤0.5%.

| Outlier | Ours | Venue | Diff |
|---|---:|---:|---:|
| aquarius-cetes-usdc-pool | $1.787M | $2.383M | **−25.0%** |

### Known issue (pre-existing, NOT introduced by Lot P): stale CoinGecko `cetes` feed

The −25% is entirely the CETES price input: CoinGecko `cetes` returns **$0.0345** while the
pool's own balance ratio ($1.192M USDC against 17.26M CETES in an arbitraged constant-product
pool) implies **$0.069**, and the venue's oracle agrees ($0.0694). CoinGecko is ~½ the on-chain
market price — consistent with a long-stale feed for a yield-accruing stablebond (USTRY and
TESOURO, same issuer via their own CG ids, cross-check fine at −0.5% / +2.0%). CoinGecko has no
alternative CETES listing.

**Impact beyond Lot P:** CETES has been priced this way since YieldBlox onboarding — the CETES
reserves in 3 Blend pools (etherfuse, fixed, orbit) were understated by the same ×2.

### Founder ruling (2026-08-16) — RESOLVED

CoinGecko feed confirmed dead founder-side ($6/day volume, orderbook price). The
`fallbackEnvVar` mechanism cannot help — CG *succeeds* with a wrong price — so the CETES rule
switched from `coingecko` to `manual`: committed fallback **$0.069** (the pool-implied /
Aqua-oracle agreement, both within 0.6% of each other), `MANUAL_CETES_USD` overridable,
**`confidence: low`** and a dated provenance note carried into `asset_prices.metadata`
(the manual rule kind gained optional `confidence`/`note` overrides for exactly this; the
existing EURC manual rule keeps its `medium` default). Verified in `asset_prices`:
`0.069 | manual_fallback | low | vetted 2026-08-16: aquarius-cetes-usdc-pool implied price
+ Aqua oracle agreement; CG feed dead`.

**Watch-items (unchanged, per the same ruling):** USTRY and TESOURO — same issuer, priced via
their own CG ids (`etherfuse-ustry` / `etherfuse-tesouro`) — cross-checked at −0.45% / +2.04%
in P2, so they stay CG-priced; if either drifts past the ~5% tolerance in a future
cross-check, suspect the same dead-feed failure mode before anything else.

### CETES revaluation (run 3, after the rule switch)

| Pool | Before (CG $0.0345) | After (manual $0.069) | Delta |
|---|---:|---:|---:|
| aquarius-cetes-usdc-pool | $1,787,076 | $2,382,570 | **−25.0% → +0.06%** vs venue ($2,381,133 fresh) |
| blend-etherfuse-pool | $135,826 | $163,774 | +20.6% (its CETES reserve revalued ×2) |
| blend-fixed-pool | $178,069,223 | $178,036,228 | ≈0 (negligible CETES; market drift) |
| blend-orbit-pool | $190,729 | $190,750 | ≈0 (negligible CETES) |
| blend-yieldblox-pool | $3,077,354 | $3,077,695 | ≈0 (negligible CETES) |

The understatement was material in aquarius-cetes-usdc-pool and blend-etherfuse only — fixed /
orbit / yieldblox hold negligible CETES today. Any protocol-TVL step-change on 2026-08-16 from
these rows is this correction, not an outage (same precedent as the frozen-reserves hotfix).

Run 3 (`p2-refresh-run3-cetes-fix-local.txt`): all 10 steps green, total 443.4s. Timing note:
steady-state totals ranged **381–443s** across runs 2–3; the variance is `stellar-native`
Horizon latency (188s → 245s), not the AMM perimeter (aquarius stable at 166–170s). 443s sits
close to the 7.5-min lever bar — if the VPS shows the same on a hot cycle, the 100s of Aquarius
inter-pool spacing remains the designated first lever.

## Fast-follow list (deferred by founder ruling, post-deadline)

- **Aquarius-derived mid-price step** (the robust CETES fix; 63 is soroswap-only today) —
  source pool `aquarius-cetes-usdc-pool` ($2.4M ≥ the $100k liquidity bar).
- Deferred shortlist assets: XAUm (`matrixdock-gold`), SHX (`stronghold-token`), XRP
  (`ripple`), yBTC (BTC proxy), yETH (ETH proxy), BLND (`blend-protocol`) — would unlock the
  remaining ≥$50k pools from the P0 §6 table.
- USDM1 / USST / sUSD stay excluded — the honest boundary (P0 §6 record stands).

## Invariants & tests

- Dead-reserves invariant: all 19 new pools produce atomic `(entity, snapshot_at)` batches —
  2 runs → exactly 2 batches each, always 2 assets per batch (query in evidence history).
- `tsc --noEmit` (indexer): only the pre-existing `qa-reconcile.ts` + `@stellar/stellar-sdk`
  typing errors (unchanged since Lot E); nothing new in touched files.
- `pnpm -C apps/api test`: **85/85 pass** (no API code changes needed — the perimeter flows
  through existing contracts).
- `/v1/alert-rules/tvl-pools` will include the new pools only after **12–36h of snapshot
  batches** — expected, do not wait for it at deploy time.

## Deploy procedure (pending founder SSH confirmation — NOT executed)

Indexer-only. On the VPS: `git pull`, then
`pnpm -C apps/indexer bootstrap:core && pnpm -C apps/indexer bootstrap:logos`
(documented in `runbooks.md`). The cron picks up the perimeter on the next 15-min cycle; the
first cycle writes reserves+metrics, the second adds soroswap derived prices (by design, see
the 63 fix). No API restart (no API changes); Vercel untouched.
Post-deploy checks: `/v1/pools` count = 25 AMM pools (21 aquarius + 4 soroswap) the same
evening; `/v1/ops/metrics` total expected ≈6–7 min; tvl-pools count + first charts next morning.
