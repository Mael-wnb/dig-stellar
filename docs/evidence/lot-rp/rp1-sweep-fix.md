# Lot RP — RP1: wallet-sweep RPC fix (built 2026-10-27, deploy pending)

Scope: `job:wallet-alert` (82 → 81 → 83) only. No web change, no cadence change, no provider
change (RP2). Every run below hit the PUBLIC endpoint (`mainnet.sorobanrpc.com`) throttled to
≤ 5 req/s from a preload that also counted every outbound call by JSON-RPC method.

## 1. Change

- `lib/protocols/blend/fetch-user-positions.ts` — one builder (`buildBlendUserPositions`) shared by
  the unchanged single-user path and the new batch path: `loadBlendPoolContext` (pool + oracle once)
  + `fetchBlendUsersPositionsBatch` (one `Positions` ledger key per wallet, 100 keys per
  `getLedgerEntries`; RPC cap 200). The `PoolUser` is built with an empty emissions map — neither
  the breakdown nor `PositionsEstimate.build` reads emissions.
- `scripts/wallets/81-stellar-wallet-blend-positions.ts` — pool-major loop: load each pool once,
  batch-read every wallet, persist with the SAME SQL and metadata (extracted to
  `persistWalletPoolPositions`). A pool whose load fails is skipped for the run (its wallets keep
  their previous rows; the other pools are still persisted) and **81 exits 1, so 82 does not run
  the evaluator on partial data** — stricter than the per-wallet catch, which skipped silently and
  exited 0, because one failed load now affects a whole pool. `lib/ops-capture` is the first import.
- `scripts/82-run-wallet-alert-job.ts` — sets `OPS_METRICS_FILE`, persists the merged samples as
  `rpc_metrics_runs` rows with `job = 'wallet-alert'` + `methods` (non-fatal, runs even on failure).
- `lib/ops-metrics.ts` — samples carry the RPC method (or REST verb + first path segment);
  summaries carry `methods`. 71 writes `job = 'refresh'` + `methods`.
- `apps/api/src/scripts/ops-capture-lite.ts` — the API-side twin (patches the API's own SDK axios,
  same JSONL shape), first import of `83-evaluate-alerts.ts`. 83 already loaded each pool once per
  run (`PoolV2.load` × 4); nothing else to batch there.
- `apps/api/src/db/stellar_v1_ops_metrics_job.sql` — `job text default 'refresh'`, `methods jsonb`,
  index. `ops.service.ts` reads `job = 'refresh'` so `/v1/ops/metrics` and `#status` keep their
  refresh-only semantics. Compose mounts the file as `14b-…`.

## 2. Calls per run, by method (measured)

| Run | wallets × pools | getLedgerEntries | simulateTransaction | total | duration (throttled 5 req/s) |
|---|---|---|---|---|---|
| **before** (main 81), local | 9 × 4 | 108 | 216 | **324** (36 / wallet) | 67 s |
| **after** (RP1 81), local | 9 × 4 | 12 | 24 | **36** | ~15 s |
| **after**, synthetic prod-sized (lib call, no DB) | 2,100 × 4 (9 real + random) | 92 | 24 | **116** (84 batches) | 24 s |
| **after**, full `job:wallet-alert` (81 + 83) | 9 × 4 | 20 | 24 | 44 | persisted: `{"getLedgerEntries":20,"simulateTransaction":24}` |

Formula after: `4 × 2` (pool) + `24` (oracle: reserves 5+3+4+8, +1 each) + `4 × ceil(wallets/100)`.
The 24 simulations are now the floor per run whatever the wallet count.

### Scaled to prod and priced

Weights: documented (every RPC method 10 CU) and effective (simulateTransaction ≈ 100 CU, the only
weighting that reconciles the hourly chart — `00-rpc-cost-recon.md` §4).

| | calls/run | CU/run @10 | CU/run @sim 100 | CU/day hourly | CU/day 4×/hour |
|---|---|---|---|---|---|
| before, 92 wallets | 3,312 (1,104 gLE + 2,208 sim) | 33k | 232k | 5.6M | 22.3M |
| after, 92 wallets | 36 (12 gLE + 24 sim) | 0.4k | 2.5k | 0.06M | 0.24M |
| after, 2,100 wallets | 120 (96 gLE + 24 sim) | 1.2k | 3.4k | 0.08M | 0.33M |

92× fewer calls at today's wallet count; four sweeps an hour after RP1 cost ~1 % of one sweep before.

## 3. Same results

Old and new 81 run back to back on the same 9 local wallets (snapshots 12:50:59Z and 12:52:07Z).
`wallet_pool_health`, joined on (wallet, pool): 5 rows each side, all 5 present on both sides.

| wallet | pool | HF before → after | collateral $ before → after | debt $ | positions |
|---|---|---|---|---|---|
| 324432d0 | fixed | 0.63965967 → 0.63965977 | 0 → 0 | 0 | 2 → 2 |
| 785b3016 | fixed | 0.96894895 → 0.96894895 | 0 | 0 | 1 → 1 |
| 785b3016 | yieldblox | 9.69260612 → 9.69260612 | 0 | 0 | 2 → 2 |
| a24fa895 | fixed | 0.19044042 → 0.19044042 | 0 | 0 | 1 → 1 |
| d5e7ee36 | fixed | 1.35955307 → 1.35955307 | 44,352.96221404 → 44,352.96221410 | 32,623.1929761 → 32,623.1931085 | 2 → 2 |

`wallet_protocol_positions`: 8 rows each side, 8 matched on (wallet, pool, type, asset); 5 amounts
identical, 3 differ at the 9th significant digit with a max USD difference of **$0.000126** — the
interest-accruing wallet, read 68 s later (bRate/dRate accrual between runs), not a computation
difference: both paths run the identical builder and `PositionsEstimate.build`.

(`health_factor` is the non-null `total_collateral_usd / total_debt_usd` of the SDK estimate; the HF
values above are the effective-collateral ratios the evaluator consumes.)

## 4. 83 semantics

Code change in 83 = one import (`./ops-capture-lite`). `pnpm -C apps/api test -- alerts`: 5 suites,
68 tests green. Full local `job:wallet-alert` ran end to end (81 → 83: `fired: 3, resolved: 0` on the
local rules, as the local DB state dictates) and persisted one `wallet-alert` ops row. `pnpm -C
apps/api build` green (with the Prisma client generated).

## 5. Deploy

`docs/deployment.md` "RP1 deploy": SQL → `pnpm install` → API build + `pm2 restart` → one manual
sweep → read the `wallet-alert` row. Crontab stays on the hourly stopgap until the provider's
hourly chart shows the drop, then restore `7,22,37,52 * * * *`.

## 6. Out of scope (RP2)

Provider pool / rotation (count `sorobanrpc.com` and `lightsail.network` as ONE provider — same
infrastructure), moving `HORIZON_TRADES_URL` to `horizon.stellar.org`, wallet hygiene for the
2,016 minted rows of 2026-10-15, the ~70k requests/hour residual (`00-rpc-cost-recon.md` §4),
`job:refresh` cadence.
