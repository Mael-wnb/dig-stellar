# Lot PRE — PRE2 recon: Horizon still amber after fix C

Date: 2026-11-04. Branch `fix/horizon-liquidity-pools` (from `main` 8e6dd18). Read-only recon;
**no code change made** — the brief's premise (a network-wide `/liquidity_pools` scan) does not
hold, see "Why F1 does not apply". Decision needed before any fix lands.

## Trigger (prod, `rpc_metrics_runs`, target=horizon, job=refresh, 2026-11-04 UTC, verbatim)

| run_at | calls | errors | methods |
|---|---|---|---|
| 12:45 | 80 | 2 | `{"GET /accounts": 29, "GET /fee_stats": 1, "GET /liquidity_pools": 50}` |
| 12:30 | 79 | 2 | `{"GET /accounts": 29, "GET /fee_stats": 1, "GET /liquidity_pools": 49}` |
| 12:15 | 93 | 0 | `{"GET /accounts": 29, "GET /fee_stats": 1, "GET /liquidity_pools": 63}` |
| 12:00 | 74 | 4 | `{"GET /accounts": 29, "GET /fee_stats": 1, "GET /liquidity_pools": 44}` |
| 11:45 | 73 | 5 | `{"GET /accounts": 29, "GET /fee_stats": 1, "GET /liquidity_pools": 43}` |
| 11:30 | 77 | 3 | `{"GET /accounts": 29, "GET /fee_stats": 1, "GET /liquidity_pools": 47}` |

Latency per run p50 0.5–3.8 s, p95 7–10 s, p99 ≈ 10.5 s (flat). Cumulative log: 6 axios
`timeout of 30000ms`, 0 `timeout of 10000ms`, no HTTP 429 lines. Fix C (sequence once per
process) worked: `GET /accounts` 290 → 29.

## R1 — what issues `GET /liquidity_pools`

**There is no network-wide scan.** Two callers, both in `lib/protocols/stellar-native/`:

| Caller | Request | Count per run | Paging |
|---|---|---|---|
| `fetch-pools.ts` `fetchHorizonPools` | `GET /liquidity_pools?reserves=<a>,<b>&limit=5`, one per curated pair (`LIQUID_PAIRS`, 9 pairs) | **9**, constant | none — one page per pair, no `next` follow; a failed pair warns and continues |
| `fetch-pool-trades.ts` `fetchPoolTrades` (called by `persist-pool-metrics.ts` for the 9 active pools, `Promise.all`) | `GET /liquidity_pools/{id}/trades?order=desc&limit=200` then the `_links.next` cursor until a trade older than 24 h or 25 pages | **34–54**, varies with the day's trade count (pages ≈ ⌈trades24h / 200⌉ + 1 per pool) | yes — this is the paging |

Both land under one label because `labelOpsMethod` (`lib/ops-metrics.ts`) keeps the HTTP verb +
**first path segment** only (`/liquidity_pools/{id}/trades` → `GET /liquidity_pools`). The
9 pool reads are cheap (measured 0.42 s, 2 KB); the trades pages are the slow part.

Why the 43–63 spread: trade volume. Not retries — `fetchJson` retries only 429 / network errors,
and a non-429 HTTP error on a trades page makes `fetchPoolTrades` **break and keep the partial
sum** (`volume_24h_usd` is then silently understated for that pool). Tracked pool ids never need
a scan: the pair filter returns the one classic LP per pair (single 30 bp fee tier), and the ids
are already stored in `entities.contract_address` / `pool_snapshots.pool_id`.

**Why the PRE1 local evidence showed `GET /liquidity_pools` 9, not 40–60:** locally
`HORIZON_TRADES_URL` points at Validation Cloud (`apps/indexer/.env`), so the trades pages leave
public Horizon. That host is also `STELLAR_RPC_URL`'s host, so `classifyOpsTarget` files those
pages under **`soroban-rpc`** as method `GET` (segment stripped for RPC URLs) — they are not
lost, they are mis-filed. Prod evidently has no `HORIZON_TRADES_URL` (falls back to
`HORIZON_URL` = public Horizon): the 43–63 figure cannot come from anything else. The VPS env
could not be read from this session (production read denied) — founder check below.

## R2 — what counts as an error on the fetch path

- Horizon calls all go through global `fetch` (`fetchJson`, `00-common.ts`), wrapped by
  `patchGlobalFetch`: a sample is `ok=false` when **the response is non-2xx** (any status, incl.
  the 429 that `fetchJson` then retries) **or `fetch` throws** (network error, `AbortError` — but
  nothing aborts here). Each retry attempt is its own sample, so one page that fails once and
  succeeds on retry = 1 error + 1 ok, 2 calls.
- **No client timeout** on this path: `fetchJson` passes no `signal`; Node's undici defaults
  (headers/body timeout 300 s) are the only bound. The 10.5 s p99 is **server latency**, not a
  client timeout: one deep trades page for XLM/USDC measured 8.2 s then 7.3 s (280 KB) from a
  laptop today; the same page via Validation Cloud 1.2 s / 1.1 s.
- The 6 axios `timeout of 30000ms` lines are the SDK axios copy (`rpc.Server` /
  blend-sdk / defindex) — they belong to the `soroban-rpc` / `defindex-api` rows, not Horizon.
- Errors are **not attributable per method**: `rpc_metrics_runs.methods` stores call counts per
  method and `errors` is one total per target (`summarizeOpsSamples`); the per-sample JSONL is
  unlinked after the merge (`71-refresh-all-metrics.ts:187`). Not added in this lot (brief F3).

## R3 — the 29 `GET /accounts`

Confirmed: exactly the per-pool-process sequence fetches. `getAccountSequence` is called only
from `simulateContractRead`, whose live callers are `blend/fetch-pool-state.ts`,
`soroswap/fetch-pair-state.ts`, `aquarius/fetch-pool-state.ts` (every other caller is a
`scripts/discovery/*` probe, off the `job:refresh` path). `71` spawns one tsx process per entity:
local DB perimeter blend 4 + soroswap 4 + aquarius 21 = 29. Step 80's per-wallet `GET /accounts`
runs under `job=wallet-alert`, not in these rows. `/fee_stats` 1 = `73-network-stats-refresh.ts:181`.

## Local "before" run (stellar-native step alone, public Horizon for trades)

`HORIZON_TRADES_URL=https://horizon.stellar.org OPS_METRICS_FILE=… tsx src/scripts/ingest/run-stellar-native-refresh.ts`
on the local DB, 2026-11-04 14:07–14:09 UTC+1, wall time **2 min 22 s** for this one step:

```
horizon: calls=62 errors=0 p50=4421 p95=7484 p99=9361 max=9361  (22 calls over 5 s)
methods JSON: {"GET /liquidity_pools": 62}        ← 9 pool reads + 53 trades pages
```

| Pool (id prefix) | trades24h | trades pages |
|---|---|---|
| XLM/USDC a468d41d | 3,533 | 18 |
| XLM/yUSDC 4b7890d7 | 1,751 | 9 |
| USDC/AQUA 0b8aafef | 1,078 | 6 |
| XLM/EURC 5af87fae | 856 | 5 |
| yXLM/yUSDC 92ce803d | 938 | 5 |
| XLM/AQUA 59fa1dc5 | 548 | 3 |
| AQUA/yXLM 83b12aec | 569 | 3 |
| EURC/USDC 328306d8 | 502 | 3 |
| XLM/yXLM e2a9f591 | 0 | 1 |

0 errors from a residential IP; the VPS sees 2–5 per run on the same shape of traffic (shared IP
with the wallet-alert and campaign crons; cause of the individual failures not visible from here —
founder check below). No "after" run: nothing was changed.

## Why F1 (direct reads by id) does not apply

Replacing the 9 pair-filtered reads by 9 `GET /liquidity_pools/{id}` reads keeps the count at 9,
touches none of the 53 slow pages and cannot move the error count — presenting it as "C2" would
be a no-op dressed as a fix. The amber is the **24 h trades walk on public Horizon**, which is
intrinsic to computing `volume_24h_usd` from raw trades: pages = trades / 200, whatever the
endpoint shape (`/trades?trade_type=liquidity_pool&base_asset…` pages identically).

## Options (founder decision)

| | Change | Effect on the Horizon row | Cost / caveat |
|---|---|---|---|
| **A. Config: set `HORIZON_TRADES_URL` on the VPS to the Validation Cloud Horizon URL** (what local already does) | ops only (`apps/indexer/.env`, no restart — next cron) | trades pages leave public Horizon: row ≈ 29 + 1 + 9 = 39 calls, slow pages gone, errors expected 0; pages 1.1 s instead of 7–8 s, step ≈ 25 s instead of 2 min | (1) the pages are then filed under `soroban-rpc` as method `GET` (+53 per run, documented quirk, or a 3-line classifier tweak); (2) **`fetch-pool-trades.ts` logs the full trades URL — with the VC key — on every page** (`console.log` lines 90–150; pre-existing, already true locally): must be masked with `maskRpcUrl` before A goes to `/var/log`; (3) VC quota: +~50 heavy requests per run (~200/h) on the same key as RPC (Lot RP budget). |
| B. Incremental trades: keep a cursor + 15-min volume buckets per pool in `pool_metrics_latest.metadata`, fetch only trades newer than the cursor each run (fallback to the full walk when no cursor) | indexer code, ~80 lines, no SQL | 53 pages → ~9–10 per run on whichever host; errors mostly gone | changes the output: window becomes "last 24 h at 15-min granularity" (24 h 0–15 min) instead of exact rolling 24 h; brief F1 asked for identical rows → needs an explicit ruling. The real fix long term; pairs well with A. |
| C. `GET /trade_aggregations` per pair (1 call) | indexer code | 53 → 9 | aggregates **pair** volume (SDEX orderbook + LP), not pool volume — a semantic change; not recommended. |
| D. Leave as is | — | amber stays; `volume_24h_usd` silently partial on failed pages | — |

Recommendation: **A now** (with the URL-masking fix, which is the only code in this lot), **B as
the follow-up** if the founder accepts the 15-min granularity. F3 holds in every option: no
timeout / retry / `OPS_STATUS_RULES` change.

## Founder checks (VPS, read-only — this session could not run them)

```bash
cd /root/dig-stellar
grep -n "HORIZON" apps/indexer/.env | sed -E 's#(/v1/)[^/"]+#\1<key>#'          # is HORIZON_TRADES_URL set?
L=/var/log/dig-stellar-refresh.log   # the job:refresh cron log (check crontab -l)
for p in "trades fetch failed" "liquidity_pools fetch failed" "fetchJson network error" "HTTP 50" "HTTP 40"; do printf "%-32s %s\n" "$p" "$(grep -c "$p" $L)"; done
grep "trades fetch failed" $L | tail -5 | cut -c1-220       # which pool, which status → the 2–5 errors per run
```

## Checks (baseline, no code change)

- indexer `pnpm test` (Node 24): 49 / 49 pass.
- indexer `tsc --noEmit -p tsconfig.json`: 0 errors in `src/` (36 in `node_modules` typings, same as PRE1).
- api untouched.
- Side effects of the local run: 9 new `pool_snapshots` rows + `pool_metrics_latest` upserts in the
  **local** DB only; `apps/indexer/.env` copied from the main worktree into this worktree
  (git-ignored).

---

# PRE2 build — option A (2026-11-04)

Founder decision: option A now, B to a later lot, C rejected. Indexer only, no SQL, no change to
timeouts / retry policy / `OPS_STATUS_RULES`.

| Guard | Change | File(s) |
|---|---|---|
| **A1 key masking** | Every log line of the trades walk goes through `maskRpcUrl` (host) or the new `maskHorizonUrl` (host + Horizon path from the resource onward: no `/v1/<key>` segment, no query / cursor). Grep of the live path found no other site logging a keyed URL (`62-price-reference-assets` and `73-network-stats` throw public URLs; keys travel in headers). Unit test: a keyed provider URL never appears in the masked line. | `lib/rpc-config.ts` (+`HORIZON_RESOURCE_SEGMENTS`, `horizonPathOf`, `maskHorizonUrl`), `fetch-pool-trades.ts`, `lib/rpc-config.test.ts` |
| **A2 capture by API shape** | `classifyOpsTarget` files a request as `horizon` when its path carries a Horizon resource (`liquidity_pools`, `accounts`, `fee_stats`, `trades`, `order_book`, `paths`, `ledgers`, `transactions`, `operations`, `effects`, `offers`), before the host rules; `labelOpsMethod` labels by that resource (`GET /liquidity_pools`), never by the key segment. JSON-RPC on the provider host stays `soroban-rpc`. The sample file carries no host, so none was added. Checked against the live external hosts (CoinGecko, DefiLlama, stellar.expert `/explorer/public/asset/…`, DeFindex `/vault/…`): no collision. | `lib/ops-metrics.ts`, `lib/ops-metrics.test.ts` |
| **A3 no silent partial volume** | `fetchPoolTrades` returns **null** when a page ultimately fails (one warning: pool + page + the discarded partial sum); the persister writes `volume_24h_usd` / `fees_24h_usd` = null and `metadata.trades24h` = null for that pool on that run, other pools untouched. Takes an injectable page fetcher so the walk is unit-tested (sum inside the window, stop at the first old trade, null on failure). | `fetch-pool-trades.ts`, `persist-pool-metrics.ts`, `fetch-pool-trades.test.ts` |
| **Concurrency bound** (not in the brief — added from measurement) | The 9 walks ran fully in parallel; on the provider that queues the heavy pages (same 9 deep pages: sequential 0.8–1.6 s each; 9 concurrent = 3 at 1.2–1.8 s + 6 at 6–8 s). First provider run with 9 concurrent: p95 8.9 s. Three workers instead: p95 4.1 s, no page over 5 s, wall 50 s (vs 63 s). Constant `TRADES_CONCURRENCY = 3` in the persister. | `persist-pool-metrics.ts` |
| **A4 env + docs** | `.env.example` documents `HORIZON_TRADES_URL`; `docs/runbooks.md` (refresh pipeline paragraph), `docs/deployment.md` (Lot PRE deploy sequence step 6), `docs/status-board.md` (Lot PRE note, C2). | — |

## A3 verdict: null is accepted end to end

`pool_metrics_latest.volume_24h_usd` / `fees_24h_usd` are nullable (`stellar_v1_metrics.sql`);
the protocol aggregator (`70-protocol-persist-metrics.ts:39`) sums a null row as 0; the API sorts
`nulls last` (`stellar.service.ts:480`) and maps null to 0 for the UI (`toNumber(...) ?? 0`, lines
259 / 410 / 710 / 759); the web types already allow `volume24hUsd: number | null`
(`poolDisplay.ts`, `protocol.ts`) and `formatUsd` renders N/A for null. Nothing breaks, so null
is persisted. **Follow-up (api, not this lot):** drop the `?? 0` so an unknown volume reaches the
web as N/A instead of `$0` — today the DB and ops are honest, the pool card is not.

## Local runs (stellar-native step alone, 2026-11-04, UTC+1)

| Run | Trades host | Concurrency | calls (methods JSON) | errors | p50 / p95 / p99 | > 5 s | wall |
|---|---|---|---|---|---|---|---|
| before (pre-change) | public Horizon | 9 | 62 `{"GET /liquidity_pools": 62}` | 0 | 4.4 / 7.5 / 9.4 s | 22 | 2 min 22 s |
| after, **variable unset** (dotenv file without it → fallback to `HORIZON_URL`) | public Horizon | 9 | 61 `{"GET /liquidity_pools": 61}` | **3** (HTTP 503 on pages 3–4 of three pools) | 5.4 / 10.2 / 10.5 s | 36 | 2 min 02 s |
| after, provider | Validation Cloud | 9 | 72 `{"GET /liquidity_pools": 72}` | 0 | 3.5 / 8.9 / 10.7 s | 26 | 63 s |
| **after, provider, bounded** | Validation Cloud | **3** | 72 `{"GET /liquidity_pools": 72}` | **0** | **1.2 / 4.1 / 4.4 s** | **0** | **50 s** |

Counts drift with the day (3,533 → 3,612 trades on XLM/USDC between runs). The unset run
reproduced prod's failure mode exactly (public Horizon `503` on deep pages, 2–5 per run) and the
A3 guard fired: the three pools landed with `volume_24h_usd = null`, `trades24h = null`, the six
others with their full sums. With the provider the pages now sit under `horizon` /
`GET /liquidity_pools` (A2), whereas before the change the same run filed them under
`soroban-rpc` as `GET`. The brief's "p95 well under 2 s" is **not met**: p50 is, p95 is 4.1 s
(provider-side variance on the deepest pages); no page over 5 s and 0 errors are.

Masked log line (provider run, key present in `.env`, 0 occurrences of the key in the log):

```
[stellar-native] pool=83b12aec… trades via mainnet.stellar.validationcloud.io
[stellar-native] page=0 url=mainnet.stellar.validationcloud.io/liquidity_pools/83b12aec…/trades
[stellar-native] trades page 4 failed for pool 0b8aafef…: HTTP 503 on horizon.stellar.org — volume24h unknown for this run (partial sum 1081.12 discarded)
```

## Checks

- indexer `pnpm test` (Node 24): 49 → **57 / 57** (+2 rpc-config, +4 ops-metrics, +2 fetch-pool-trades).
- indexer `tsc --noEmit -p tsconfig.json`: 0 errors in `src/` (unchanged `node_modules` typings noise).
- api: untouched.

## Timeline (for the dossier)

The Horizon amber appeared on 2026-10-30, when RP1.1 made the capture complete per job and
method; the calls (~300 per run) and the slow trades pages predate it — the capture only made
them visible. Fix C (2026-11-03) cut the calls to ~84 per run by fetching the source-account
sequence once per process; PRE2 removes the slow pages from public Horizon (provider endpoint),
masks the provider key, files Horizon traffic by path, and stops persisting a partial 24 h volume.

**Prod onset (founder capture, pasted at close-out):**

| day | runs | runs with errors | errors | calls |
|---|---|---|---|---|
| _(pending — `select date_trunc('day', run_at) d, count(*) runs, count(*) filter (where errors>0) err_runs, sum(errors) errs, sum(calls) calls from rpc_metrics_runs where target='horizon' and job='refresh' group by 1 order by 1;`)_ | | | | |

## Follow-ups (not this lot)

- api: `toNumber(volume_24h_usd) ?? 0` → keep null so the UI shows N/A (see A3 verdict).
- `MAX_PAGES = 25` (5,000 trades) still truncates silently on a very busy day (XLM/USDC is at
  ~3,600 today); option B (incremental cursor) removes the walk altogether.
- Local-only artefact seen in these runs: pools whose legs are not USDC/EURC/XLM-priced show
  `volume24hUsd = 0` with trades > 0 because the local `asset_prices` has no XLM price; prod prices
  are populated. Not a code issue.
