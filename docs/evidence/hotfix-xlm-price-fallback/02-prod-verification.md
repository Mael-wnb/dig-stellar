# XLM price fallback — prod verification (2026-09-29)

Deployed commit: `e982fb2` (`fix(indexer): on-chain XLM/USD fallback when keyless CoinGecko is
blocked`), VPS deploy at ~15:54Z with the block in `01-implementation.md` §Deploy (ff-merge,
install, prisma generate, api build, pm2 restart, `/health` version = HEAD). Figures below are
the founder's prod captures at the first refresh tick after the deploy.

## CI status of the deployed SHA

Checked on the public GitHub API (no token): `GET /repos/Mael-wnb/dig-stellar/actions/runs?head_sha=e982fb2…`

| Run | Branch | Created | Completed | Result |
|---|---|---|---|---|
| ci 36593611588 | `fix/xlm-price-fallback` | 15:53:17Z | 15:54:07Z | success |
| ci 36593634412 | `main` | 15:53:28Z | 15:54:04Z | success |

Honest note: the VPS deploy was started about one minute after the push, without explicitly
waiting for CI. Both runs happened to be green by the time the API restarted, but nothing
enforced it — that is the gap the Lot AD deploy script closes ("deploys are gated on green CI
for the exact SHA").

## First refresh tick after the deploy (16:00Z run)

- Step 1 `prices:reference`: `native` → `onchain_sdex_xlm_usdc` **0.22695317494105094**, pool
  `stellar-native-native-usdc-pool` (the deepest XLM/USDC pool captured); `yXLM` aligned at the
  same value with source `xlm_proxy:onchain_sdex_xlm_usdc` — it was **0.170797** before (the
  stale pre-block value).
- Step 9 `network-stats`: `network_stats_latest` at **16:07:53Z**, `xlm_price_usd` 0.22695,
  `xlm_price_change_24h_pct` **+1.758 %** via `stored_history` (basis: the CoinGecko point from
  24 h earlier), `metadata.xlmPriceSource` = `onchain`.
- Public API `GET /v1/network/stats`: `xlmPriceUsd` 0.22695; `stellarTvlUsd` **262 100 161.92**
  vs **260 663 197.11** on the previous run (XLM-denominated TVL re-priced at the live XLM/USD).
- `#status` "Price sources" tile: unchanged, still failed — CoinGecko is still called once per
  run for the non-XLM ids and still returns 403. Expected; addressed by the price-sources v2 work.

## What this proves

The dashboard XLM tile and 24 h change are live again, the XLM-denominated valuations (pool
TVL, network TVL, wallet snapshots) follow the on-chain XLM/USD instead of the frozen
pre-outage value, and the source is traced end to end (log line, `asset_prices.source`,
`network_stats_latest.metadata`).

Still frozen after this hotfix (by design of its scope): every non-XLM asset priced by
CoinGecko in step 1 (BTC/ETH proxies, USTRY, TESOURO, AQUA, USDGLO, USDY, ETH) keeps its last
pre-block row because the readers take the latest row with no max age. That is the
price-sources v2 scope (`docs/evidence/price-sources-v2/`).
