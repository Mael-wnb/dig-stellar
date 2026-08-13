# Lot E evidence — E1 (/health) + E2 (RPC metrics) + E3 (adoption) + E4 (reference)

Captured 2026-08-13, local stack (docker Postgres + `pnpm -C apps/api start:dev` +
real `job:refresh` runs against mainnet endpoints).

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

## E3 — adoption counters

- Baseline `GET /v1/ops/adoption`: real wallet counts (8 tracked / 2 signers /
  6 watch-only / 3 distinct users from `user_wallets`), zero actions (no backfill
  by design — counters start at deploy).
- DoD round-trip on testnet, all server-side (a fresh friendbot-funded account;
  only the PUBLIC key ever existed in the session):
  1. `POST /v1/actions/sdex/quote` XLM→USDC 10 → quote returned →
     `sdex-quote` counted (address null by design — quotes carry no actor).
  2. `POST /v1/actions/sdex/swap` same pair → 348-char signable XDR
     (`change_trust:USDC` + `path_payment_strict_send`) → `sdex-swap-build`
     counted with the acting address; distinctAddresses.total → 1.
  3. `POST /v1/actions/blend/deposit` USDC on the trustline-less account →
     2-step gate returned ONLY the ChangeTrust XDR → `trustline-build` counted.
- `e3-adoption-after-roundtrip.json` / `e3-adoption-final.json` — payloads.
- `blend-deposit-build` not exercised live: it requires an account with an
  on-chain USDC trustline, and submitting that trustline is client-side signing
  (non-custodial). Its recording branch is the same code path as the other two
  (see `actions.controller.ts` blendDeposit).
- Boundary stated IN the payload: counts are server-side BUILDS, not executions.

## E4 — reference packaging (fresh-clone proof)

Proven 2026-08-13 from a fresh working-tree copy (rsync minus node_modules/.git/.env —
Lot E changes were not yet committed, so a pure `git clone` was not possible; contents
identical to what lands in the Lot E commit) in a temp directory, side-by-side with the
live local stack (`COMPOSE_PROJECT_NAME=dig_ref`, ports 15432/16379/13000/web). No
secrets used anywhere — public SDF Soroban RPC throughout.

End state: `e4-ref-health.json` (status ok, all venues fresh), `e4-ref-protocols.json`
(blend ≈$185.5M / aquarius ≈$20.1M / stellar-native ≈$5.1M / soroswap ≈$525k — matches
production), `e4-ref-ops-metrics.json` (E2 rows from the clone's own runs, incl. real
public-RPC 429 errors), `e4-ref-dashboard-index.html` (Vite serving the dashboard app;
"rendering" proven at the served-app + API-data level — no browser screenshot in this
evidence). Run summaries: `e4-ref-refresh-run{1..4}-summary.txt`.

Deviations found by the proof → fixed:
1. **Compose project-name collision**: a second checkout with the same directory name
   silently REPLACES the running containers and mounts the existing data volumes.
   Fixed: ports/container-prefix parameterized + mandatory `COMPOSE_PROJECT_NAME` in
   the side-by-side procedure (compose header + reference-deployment.md).
2. **Bootstraps un-runnable**: blend/soroswap/aquarius `*-upsert-core.ts` read
   `*-final-registry.json` from gitignored tmp/discovery — those artifacts no longer
   existed anywhere. Fixed: `bootstrap:export` snapshots the live DB perimeter into
   COMMITTED `registries/core-registry.json`; `bootstrap:core` replays it (6 venues,
   13 entities, 12 assets, 40 links, 14 reserve-snapshot rows), idempotent.
3. **`STELLAR_SOURCE_ACCOUNT` required**: the aquarius refresh hard-throws without it
   (blend has a code default). Fixed: shipped as an active default in
   `apps/indexer/.env.example` (read-only simulation source; never signs).
4. **pnpm/vite port flag**: `pnpm dev -- --port N` is ignored by vite (auto-picks
   another port). Fixed in the doc: `pnpm -C apps/web exec vite --port N`.

**KNOWN ISSUE flagged for follow-up (pre-existing in production, exposed by the
proof): Soroswap + Aquarius reserve TVL is frozen.** Their metrics steps READ
`reserve_snapshots`, but nothing on the live refresh path writes those rows — they were
inserted once by legacy `*-insert-snapshots.ts` (inputs gone). Production has been
computing Soroswap/Aquarius reserve TVL from 2026-03-19 reserve amounts (× current
prices) ever since. The seed reproduces this behavior on a fresh clone; a live
reserve-snapshot writer for these two venues is the actual fix and is deliberately NOT
part of Lot E (refresh-path surgery deserves its own reviewed change).

First-run expectations (documented in reference-deployment.md): only `defindex` fails
without `DEFINDEX_API_KEY` (non-fatal, recorded); everything else green from run 1 once
`bootstrap:core` has run.

## No-secret grep

`grep -ril "validationcloud|postgresql://|DATABASE_URL|apikey|bearer|password|secret"`
over all payloads in this directory: no matches; payloads contain no URLs at all.
