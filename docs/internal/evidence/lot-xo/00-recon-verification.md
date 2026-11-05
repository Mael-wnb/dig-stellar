# Lot XO — step 0 recon verification (2026-10-26, read-only)

Everything below came from read-only Soroban RPC reads (ledger entries, `simulateTransaction`)
and the contracts' own WASM spec; the XOXNO lending repository (PolyForm Noncommercial) was not
read, and no XOXNO HTTP API is called by the pipeline.

## Contracts

| role | contract | how it was established |
|---|---|---|
| Controller | `CAUCMIN5KSXEVZ7NMXR3LZATGD5EFIEUI5XWTFLYRO2R5OTXI22WE5JX` | Position-NFT instance storage key `Controller`; confirmed by the pool's `Owner` and the controller's `PositionNft` |
| Pool (custody + per-market accounting) | `CBXRNDQMAJFG4VUKMKFEMFS75UUXE2SPSNV4LEEFCSNBCN66PYRWBKXO` | `controller.get_pool_address()` |
| Position NFT (one NFT = one account) | `CAWCSG77AY2W24QZ6ZXLHZU4UXEFHZBM6EI4A4IF7JB5CTY4XND3TI6C` | controller storage `PositionNft` (XO-2 material) |
| Price aggregator | `CBGUF2G2Q7HCVCWYISDXBHPVBGMYNXA7PG2VET66YBZX6IKOOV27NSMV` | `controller.price_aggregator()` |

The account stellar.expert reports as "creator" is the deployer, not the controller.
`controller.get_app_version()` = 1 at recon; all four contracts expose `upgrade`, hence the
app-version smoke check at the start of every refresh.

## Market list (25 = 25, 0 diff)

There is no on-chain list view. The markets are the pool's `("Params" | "State", HubAssetKey)`
ledger entries (contract-data enumeration, decoded with the SDK: exactly 25 + 25 keys),
cross-checked against the `market|batch_params_update` pool events of the creation window
(ledger ≈ 64141162+) and against the registry XOXNO publishes for DefiLlama: 25 = 25, 0 diff.
Hub names (Core / RWA / AMM) are not on-chain and are hand-seeded. Token symbol / name /
decimals come from SEP-41 `symbol()` / `name()` / `decimals()`; the 10 Aquarius LP tokens all
answer "POOL" and are labelled by pair. Existing asset rows (`native`, USDC, EURC, …) are never
renamed (pricing rules key on symbol).

## Encoding / units (verified by simulation)

- `HubAssetKey` is a Soroban struct = `ScMap` with SORTED symbol keys (`asset` before `hub_id`),
  `hub_id` as `u32`. Returned structs are decoded by XDR map entries, never `scValToNative`
  (struct-keyed maps collapse to `[object Object]`).
- Rates are RAY (1e27) **APR** (`get_deposit_rate`, `get_borrow_rate`); the APY XOXNO publishes
  is `exp(apr) − 1` (USDC borrow 2.6702 % APR → 2.706 % APY at recon). Utilisation RAY; USD and
  health WAD (1e18); amounts raw with `MarketParamsRaw.asset_decimals` — 7 (most), 8 (SolvBTC,
  xSolvBTC), 9 (XAUM), 18 (USST, deJTRSY, deJAAA). Never hardcoded; i128 kept as BigInt.
- The raw `State` ledger entry only moves on interaction and lags accrual (`last_timestamp` in
  ms; `supplied` / `borrowed` are RAY-scaled shares). The adapter reads the accrued VIEWS.
  2026-10-30 check: `get_sync_data.state.cash` equals `get_reserves` byte-for-byte (USDC
  `65107671113`, XLM `3628376352607`), and `get_utilisation` is NOT borrowed/supplied (differs
  by up to 1e-6 on SolvBTC / xSolvBTC across the 25 markets), so neither can replace a view.
- `controller.get_market_indexes_detailed(Vec<HubAssetKey>)` exceeds the simulation budget above
  a few keys (25 → `Budget ExceededLimit`); 3 keys per call works (~120 ms). The view returns
  `price_wad`, `primary_price_wad`, `anchor_price_wad`, `price_timestamp`, `stale`, `valid`,
  `deviation`, `error_code` and the accrued `supply_index` / `borrow_index`.
- `getEvents` on the paid provider returned 0 events over a 60-day window but worked on narrow
  windows — page in small ledger ranges if an event path is ever needed.

## Byte-for-byte match vs XOXNO's own export

Raw `get_reserves` for 25/25 markets is byte-identical to the snapshot XOXNO publishes for
DefiLlama at the same ledger (recon 2026-10-26, re-confirmed at gate 1b). DefiLlama's Stellar
TVL for XOXNO (148.2k at recon) sits below XOXNO's own 150.7k because DefiLlama cannot price
USTRY, USST and the LP tokens (≈ $2.2k); our aggregator fallback covers the latter two groups.

## Reflector coverage of the 25 tokens (2026-10-26)

SDEX feed lists CETES, native, AQUA, SolvBTC, USTRY, USDT0, PYUSD, EURC; the CEX feed has
USDT / EURC / XLM / USDC tickers. NOT listed: XAUM, USDY, USST, deJTRSY, deJAAA, xSolvBTC
(derived rule), all 10 LP tokens → the `external` markers (XAUM, USST, deJTRSY, deJAAA, LP
tokens) and USDY's existing Aquarius-pool rule. USDT0 is priced through Reflector's SDEX listing
of its contract id (`reflector_sdex_usdt0` = 0.99991508, −0.0085 % vs 1) and carries an
`oracle` rule so it never falls back.

## Overlap

Hub 3 (AMM) holds Aquarius LP tokens also counted inside the Aquarius pools we track
(≈ $730 at recon, ≈ $2k on 2026-10-30). Kept, documented
(`docs/decisions/2026-10-27-xoxno-tvl-and-pricing.md`).
