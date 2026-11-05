# Lot PRE — PRE3 recon: the native step exited 0 before the trades walk

Date: 2026-11-04. Branch `fix/capture-trades-pages` (from `origin/main` 438971f). Indexer only;
no SQL, no change to retries, timeouts or `OPS_STATUS_RULES` (brief F3).

## Trigger (prod `rpc_metrics_runs`, run 2026-11-04 18:30 UTC, after PRE2 + `HORIZON_TRADES_URL`)

`horizon = {"GET /accounts": 29, "GET /fee_stats": 1, "GET /liquidity_pools": 9}`, 0 errors —
the 30–60 trades pages of the 24 h walk appear under no target.

## R1 — the capture path

Three candidate causes on the capture path, each excluded by the code and by a local run:

| Candidate | Finding |
|---|---|
| Prefixed path (`/v1/<key>/liquidity_pools/…`) misses the PRE2 classifier | No. `classifyOpsTarget` checks `horizonPathOf(url)` **before** any host rule; the resource is found at any index. Probe with the real local `HORIZON_TRADES_URL` (key masked): segments `[v1, <len43>, liquidity_pools, <id>, trades]` → target `horizon`, label `GET /liquidity_pools`. Unit-tested since PRE2 (`ops-metrics.test.ts`). |
| Request dropped because the host matches no target | No. The path rule runs first, so the host is never consulted for a Horizon-shaped URL; an unknown host with no Horizon resource is the only drop, and the trades URL always carries `liquidity_pools`. |
| Only one of the two fetch paths is wrapped | No. The walk uses `fetchJson` → global `fetch` (`00-common.ts:124`, resolved at call time), the same path as the 9 pair reads that **do** appear. The axios copy is wrapped too. |

Local run of the step with the provider URL (`run-stellar-native-refresh.ts`, before any change,
18:50 UTC): 62 `page=N url=…` log lines + 9 pair reads = **71 samples under `horizon`**, label
`GET /liquidity_pools` — the PRE2 local evidence (72) again. The capture counts every page it sees.

### What the production signals actually say (public API, read-only, 18:47 UTC)

| Signal (`/v1/ops/metrics`, `/v1/pools`) | Until the 17:15 run | From the 17:30 run on |
|---|---|---|
| `horizon` calls per refresh | 61–102, p50 1–4 s, 1–6 errors (public Horizon, pre-PRE2) | **39** = 29 + 1 + 9, p50 0.45 s, 0 errors |
| `stellar-native` step | ≈ 5 min after `runAt` (last native metrics `as_of` 17:20:18 — the 17:15 run) | **3.7 s, status SUCCESS** |
| `pool_metrics_latest.as_of` of the 9 native pools (`updatedAt`) | 17:20:18 | **still 17:20:18** at 18:47, `isStale: true` on all 9 |
| `soroban-rpc` methods | JSON-RPC only | unchanged — no `GET` row |

Since the deploy (between 17:20 and 17:30 UTC) the native step makes its 9 pair reads, then
**exits before the first trades page and before the metrics upsert**, in ≈ 3.7 s, and the
orchestrator records SUCCESS. No trades request is made. The native pools
have had no TVL / volume update for 1.5 h while `#status` shows every step green.

Two mechanisms, both confirmed by local reproduction (VPS log: founder check below):

1. **`run-stellar-native-refresh.ts` ended with `main().catch(console.error)`** — the only step on
   the `job:refresh` path to do so (every other step does `console.error(err); process.exit(1)`).
   A rejected `main()` printed the error and exited **0** → `runTsxWithRetry` resolved → step
   SUCCESS, no retry, cron log not red, `refresh_step_runs` green.
2. **The only code before the first fetch that changed in PRE2 and can throw is the base-URL
   construction** in `fetchPoolTrades` (`new URL(\`${base}/liquidity_pools/${id}/trades\`)`), fed by
   `getEnv("HORIZON_TRADES_URL", …)`. A value that is not an absolute URL (no `https://`, a stray
   character) throws `TypeError: Invalid URL` **outside** the walk's try/catch; an empty value
   (`HORIZON_TRADES_URL=` with nothing after it) makes `getEnv` throw `Missing env var` because its
   fallback applies only to an *unset* variable. Either throw rejects `Promise.all`, skips the
   upsert loop, and Node's `ERR_INVALID_URL` prints the **raw input URL — provider key included**
   — into the cron log.

Local reproduction with `HORIZON_TRADES_URL` set without a scheme, code as deployed (18:51 UTC):
exit **0**, wall **2 s**, 0 pages, capture `{"GET /liquidity_pools": 9}`, `pool_snapshots`
written, `pool_metrics_latest.as_of` **not** moved, log ends with
`TypeError: Invalid URL … input: 'mainnet…/v1/<key>/liquidity_pools/…/trades'`. That is the prod
signature to the call (prod 3.7 s on the VPS network).

The exact prod exception is inferred from the reproduction, not read from the VPS log; mechanism 1
hid it and mechanism 2 is the only PRE2 change on that path. Prod `/health` reported version
`8e6dd18` (PRE1) at 18:47: the API was not restarted after the pull; the indexer runs from the
checkout (founder check below).

### Founder checks (VPS, read-only)

```bash
cd /root/dig-stellar && git rev-parse --short HEAD                      # expect 438971f (PRE2 code in the checkout)
grep -c '^HORIZON_TRADES_URL=https://' apps/indexer/.env               # expect 1 — the value must be an absolute URL
grep -n 'HORIZON_TRADES_URL' apps/indexer/.env | sed -E 's#=.*#=<hidden>#'   # one line, no duplicate, nothing after it on the line
grep -n 'Invalid URL\|Missing env var: HORIZON_TRADES_URL' /var/log/dig-stellar-refresh.log | tail -3   # the hidden error, if it is this one
grep -c 'ERR_INVALID_URL' /var/log/dig-stellar-refresh.log             # > 0 ⇒ the key was printed in the log: rotate the key
```

If the second line prints 0, fix the value (`https://…/v1/<key>`, no trailing text) — the next
`*/15` tick heals the native pools. If it prints 1 and the error is something else, paste the
last `stellar-native` error from the log: with F2 below it is now non-zero and attributed.

## R2 — the walk runs in prod-equivalent conditions (local, provider URL)

| Run (local DB, `run-stellar-native-refresh.ts` alone) | exit | wall | pages logged by the fetcher | captured under `horizon` | errors | `volume_24h_usd` |
|---|---|---|---|---|---|---|
| before (code as deployed), provider URL, 18:50 UTC | 0 | 54 s | **62** (9 pools: 18/9/6/5/5/3/3/3/1-ish, `page=N url=` lines) | **71** = 62 + 9, `{"GET /liquidity_pools": 71}`, p50 2.1 s, p95 4.1 s, max 4.5 s | 0 | non-null for all 60 venue rows; the 9 active pools carry `trades24h` 591–3,675 |
| after (this branch), provider URL, 18:54 UTC | 0 | 47 s | **62** | **71**, `{"GET /liquidity_pools": 9, "GET /liquidity_pools/{id}/trades": 62}`; pages p50 2.2 s / p95 3.5 s / max 3.9 s; pool reads p50 0.12 s | 0 | same; XLM/USDC 3,673 trades = $288.6k |

Fetched pages = captured pages in both runs: the capture is complete. 0 occurrences of the key in
either log. (The `$0` volume on AQUA/yXLM-type pools with hundreds of trades is pricing scope —
only XLM, USDC and EURC legs are valued — pre-existing, not this lot.)

## R3 — `price-oracle {"unknown": 37}`

The 37 samples are the Reflector `lastprice` simulations of step 1 (`62-price-reference-assets.ts`,
one `simulateTransaction` per asset read, retries included), recorded explicitly by the
`SorobanReader.onSample` hook — which passed no `method`, so `summarizeOpsSamples` filed them as
`unknown`. One-liner applied: the sample now carries `method: 'simulateTransaction'`
(`{"simulateTransaction": 37}`). The contract function name would need the hook signature to grow;
not done.

## Fixes (indexer only)

| | Change | Files |
|---|---|---|
| **F1** label by Horizon path template, host-agnostic | `labelOpsMethod` labels a Horizon call by verb + path template with ids replaced (`GET /liquidity_pools/{id}/trades`, `GET /accounts/{id}`, `GET /fee_stats`; the 9 pair reads stay `GET /liquidity_pools` — the filter is in the query). Same label on the provider host and on public Horizon. Never the key, an address or a pool id. Classification was already path-first (PRE2); it is unchanged. Tests: prefixed provider URL, the same path on public Horizon, `GET /accounts/{id}`, a JSON-RPC call on the provider host still `soroban-rpc`. **Label change visible in `rpc_metrics_runs.methods`** from the first run on this code: `GET /accounts` → `GET /accounts/{id}`; nothing consumes the labels (`OPS_STATUS_RULES` are per target). | `lib/rpc-config.ts` (`horizonPathTemplateOf`), `lib/ops-metrics.ts`, `lib/rpc-config.test.ts`, `lib/ops-metrics.test.ts` |
| **F2** a failure cannot be a SUCCESS | `run-stellar-native-refresh.ts` exits 1 on a rejected `main()` like every other step (retry ×3, then step FAILED, job exit 1, red cron log, `refresh_step_runs` FAILED). Verified: bad `DATABASE_URL` → exit 1. | `scripts/ingest/run-stellar-native-refresh.ts` |
| **F2'** a bad trades base URL degrades, loudly, without the key | `fetchPoolTrades` resolves `HORIZON_TRADES_URL` → `HORIZON_URL` → public Horizon with a blank value counting as unset, and builds the first URL inside a guard: not an absolute URL → one warning per pool naming the variable (host masked) and **null** (volume unknown, PRE2 A3 semantics); the step continues, TVL and snapshots are written. Verified locally: exit 0, 2 s, 9 warnings, `as_of` moved, 9 null volumes, 0 key occurrences. Tests: non-absolute base → null without a fetch and no key in the warning; blank value falls back to `HORIZON_URL`. | `lib/protocols/stellar-native/fetch-pool-trades.ts`, `fetch-pool-trades.test.ts` |
| **R3** | `method: 'simulateTransaction'` on the price-oracle samples. | `scripts/ingest/62-price-reference-assets.ts` |

Not changed: `OPS_STATUS_RULES`, retries, timeouts, `TRADES_CONCURRENCY`, the SQL.

## Checks

- indexer `pnpm test` (Node 24): 57 → **61 / 61** (+1 rpc-config, +1 ops-metrics, +2 fetch-pool-trades).
- indexer `tsc --noEmit -p tsconfig.json`: 0 errors in `src/`.
- api, web: untouched.
- Side effects of the local runs: `pool_snapshots` rows + `pool_metrics_latest` upserts in the
  **local** DB only; the last local run (malformed-URL reproduction) left the 9 native pools with
  `volume_24h_usd = null` locally until the next local refresh.

## Expected in prod after deploy (one `*/15` tick, provider URL valid)

`horizon ≈ {"GET /accounts/{id}": 29, "GET /fee_stats": 1, "GET /liquidity_pools": 9,
"GET /liquidity_pools/{id}/trades": 30–60}`, errors 0, p95 ≈ 4 s; `stellar-native` step ≈ 45–60 s;
the 9 native pools' `updatedAt` moving every tick; `price-oracle {"simulateTransaction": N}`.

## Production, 2026-11-04 19:30/19:45 UTC (14c8bb8)

`rpc_metrics_runs`, target `horizon`, the two first ticks on this code:

```
 2026-11-04 19:45:06.571+00 |   104 |      0 | {"GET /fee_stats": 1, "GET /accounts/{id}": 29, "GET /liquidity_pools": 9, "GET /liquidity_pools/{id}/trades": 65}
 2026-11-04 19:30:06.163+00 |   102 |      0 | {"GET /fee_stats": 1, "GET /accounts/{id}": 29, "GET /liquidity_pools": 9, "GET /liquidity_pools/{id}/trades": 63}
```

The 9 stellar-native pools answered `isStale=false` on `/v1/pools` at 19:54 UTC; `#status` shows
Horizon green on every segment since 19:30 UTC (founder check 2026-11-05 10:30 local).
