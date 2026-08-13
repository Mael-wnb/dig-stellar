# Lot E evidence — E1 (enriched /health) + E2 (RPC latency percentiles + error rates)

Captured 2026-08-13, local stack (docker Postgres + `pnpm -C apps/api start:dev` +
real `job:refresh` runs against mainnet endpoints). E3/E4 not started (E2 review gate).

## E1 — enriched `GET /health`

- `e1-health-ok.json` — steady state after a fresh refresh: `status: ok`, `db.ok` +
  latencyMs, per-venue freshness (allbridge `asOf: null → isStale: null` is honest —
  no `protocol_metrics_latest` row for the bridge venue), `lastRefreshAt` from
  `network_tvl_snapshots`. `version: "unknown"` is correct here: local dev server
  without `GIT_SHA` exported (the VPS export line is in runbooks; the GIT_SHA path
  is unit-tested in `app.controller.spec.ts`).
- `e1-health-degraded-aged-row.json` — the DoD drill: `blend`'s `as_of` aged 2h by
  SQL → `status: degraded`, `blend.isStale: true`, HTTP still 200. Restoring the
  row flipped status back to `ok` (see conversation transcript; both states also
  occurred naturally — the pre-refresh DB was ~18h stale and read `degraded`).
- 503-on-DB-unreachable is covered by unit spec (mocked reject → HttpException 503
  with `db.ok: false` payload), not exercised live.

## E2 — capture, persist, expose

Three real `job:refresh` runs, all persisted by the 71 orchestrator into
`rpc_metrics_runs` + `refresh_step_runs` (schema `stellar_v1_ops_metrics.sql`):

| run | kind | result |
|---|---|---|
| 08:43:59Z | normal | 10/10 SUCCESS — soroban-rpc 305 calls, p50 91ms / p95 20.8s / p99 28.1s |
| 08:50:35Z | normal | 10/10 SUCCESS — soroban-rpc 305 calls, p50 71ms / p95 12.9s / p99 15.1s |
| 08:54:34Z | forced failure (`STELLAR_RPC_URL` → bogus path) | blend/soroswap/aquarius/allbridge FAILED, exit 1 — soroban-rpc 81 calls / **81 errors** |

- `refresh-run{1,2,3-forced-failure}-summary.txt` — orchestrator step summaries.
- `e2-ops-metrics-2-runs.json` — `GET /v1/ops/metrics` after the two normal runs.
- `e2-ops-metrics-with-forced-failure.json` — after the forced-failure run:
  `soroban-rpc errorRate 0.1172` (81/691 over the 24h window — aggregation of error
  rate is sound), per-run percentiles kept separate (never averaged: the two normal
  runs' p95 of 20.8s vs 12.9s stay visible as distinct rows), `failures24h: 1` +
  `lastStatus: FAILED` with messages on the four failed steps. Also 3 genuine
  price-sources errors (a stale stellar.expert endpoint) counted across the runs.

The wide soroban-rpc p50↔p99 spread in normal runs is real: bulk `getLedgerEntries`
probes are fast (~70-90ms) while paged `getEvents` scans run tens of seconds. That
variance is exactly what per-run percentiles are for.

## Capture coverage + known boundaries

- Choke points wrapped (lib/ops-metrics.ts): global `fetch` (fetchJson/rpcCall,
  Horizon reads, CoinGecko/DefiLlama/stellar.expert) and the single shared axios
  copy (`Axios.prototype.request`) used by @stellar/stellar-sdk 14.6.1 + 14.4.3
  (blend-sdk internals) + @defindex/sdk — verified one axios instance in the pnpm
  store at capture-install time.
- `price-sources` covers ALL external price/stats providers (CoinGecko, DefiLlama,
  stellar.expert) to keep the target set small and stable.
- API-side Horizon calls (actions preflight) are NOT captured — stated boundary in
  the Lot E brief, echoed in the `/v1/ops/metrics` payload (`scope`).
- Unclassified hosts are not recorded; samples are `{target, ok, ms}` only — no
  URLs, so RPC API keys can never leak into the samples file or the tables.
- A SIGKILLed step loses that process's in-memory samples (exit-hook flush).

## No-secret grep

`grep -ril "validationcloud|postgresql://|DATABASE_URL|apikey|bearer|password|secret"`
over all payloads in this directory: no matches; payloads contain no URLs at all.
