# perf/pools-latency — GET /v1/pools latency (2026-10-30)

Read-only recon on prod (1 vCPU / 1 GB VPS: pm2 API + Docker Postgres 16 + `*/15 job:refresh`),
then the smallest fix. Branch `perf/pools-latency` off `main` 4d171d8 (= prod that day).

## Symptom (measured from a laptop, `curl -w %{time_starttransfer}`)

| Endpoint | At rest | During `job:refresh` |
|---|---|---|
| `/v1/pools` | 3.2 s | 6.2 s |
| `/v1/protocols` | 0.36 s | — |
| `/health` | 0.18 s | — |
| `/v1/network/stats` | 0.08 s | — |

Both the dashboard and the protocols view derive their protocol list from `/v1/pools`
(`apps/web/src/composables/useProtocol.ts`), so users saw protocol cards 2–3 s after load.
`/v1/pools` is also re-fetched on every view switch (views are `v-if` siblings) and by three
other call sites (`usePoolDetail`, `useAdvertisedBlendPool` ×2).

## Root cause

`getPools` runs three statements. The second (Lot Q, 2026-08-16, "24h swaps" column)
aggregated the WHOLE `normalized_events` table on every request to get, per pool, a 24h swap
count and a coverage flag (`swap_events_ever > 0`):

| Table | Rows | Heap | Indexes |
|---|---|---|---|
| `normalized_events` | 2,869,665 (1,231,571 swap/trade; 31,741 in last 24h) | 1,718 MB | 1,001 MB |
| `reserve_snapshots` | 600,088 | 205 MB | 114 MB |
| `shared_buffers` | 128 MB (default) | | |

Plan: Parallel Seq Scan, 217,817 buffers read, **3.32 s** (`explain-before-2026-10-30.md`, B).
The two `like '%:trade'` / `'%:swap'` predicates cannot use the btree on `event_key`, and the
"ever" count has to touch every row by construction.

## What did NOT work (and why it matters)

First rewrite (B'): keep a global 24h grouped scan via `idx_normalized_events_occurred_at`
(343 ms) and replace the "ever" count with a per-entity `EXISTS (… entity_id = e.id and like …)`.
**60.5 s.** The planner's LIMIT-1 cost model assumed matches are spread evenly, so it chose a
seq scan with early stop for the EXISTS; entities with NO swap events (Blend, XOXNO, DeFindex)
never stop early → 44 × 1.37 s. Lesson for this DB: an `EXISTS` / `max()` / `limit 1` probe is
only safe when an index condition bounds the scan for the no-match case too.

The same trap is why the `/v1/protocols` latest-reserve group-by (D, 0.7 s full scan) was left
alone: a per-entity correlated `max(snapshot_at)` was tried locally and the planner picked the
time-ordered global `snapshot_at` index with an entity filter over the new composite
`(entity_id, snapshot_at desc)` even with seq/bitmap scans disabled; 12 of the 44 active prod
entities have no reserve rows and would each walk the whole index.

## Fix shipped

1. **Partial index** `apps/api/src/db/stellar_v1_perf_indexes.sql`:
   `idx_normalized_events_swaps_entity_time on normalized_events (entity_id, occurred_at desc)
   where (event_key like '%:trade' or event_key like '%:swap')` — ~43% of rows, est. ~45 MB.
2. **Statement B rewritten** (`stellar.service.ts`, `loadPoolsRaw`): driven from the active
   entities; per entity a correlated 24h `count(*)` and a coverage `exists`, both carrying the
   exact partial-index predicate text so the planner can match it. Local proof on a 252k-row
   copy: both subplans are `Index Only Scan using idx_normalized_events_swaps_entity_time`,
   **2.5 ms** (`explain-local-after-2026-10-30.md`). The no-match case is now one index probe.
3. **90 s in-process cache** of the raw rows of `/v1/pools` (key = protocol|sort|order) and
   `/v1/protocols` (`apps/api/src/common/ttl-cache.ts`); freshness fields computed per request;
   concurrent misses share one loader; failures not cached; `STELLAR_LIST_CACHE_TTL_MS=0`
   disables.
4. No web change in this lot.

## Prod validation protocol

`prod-index-and-explain.sql` (index build + size + EXPLAIN of the new statement) is run BEFORE
the api deploy; the code ships only if the plan uses the partial index and runs well under
100 ms. Paste the output into `explain-after-2026-10-30.md` (pending).

## Follow-ups (not in this lot)

- `/v1/protocols` latest reserves: either a `reserve_snapshots_latest` pointer table written by
  the refresh (indexer-owned, like `pool_metrics_latest`), or a range-bounded probe once the
  product accepts "latest within N days". Both need a decision; the cache hides it for now.
- Web: share one in-flight `/v1/pools` promise across `useProtocol` / `usePoolDetail` /
  `useAdvertisedBlendPool` (module-level, same pattern as `useView`) and stop refetching on
  view switch.
- Postgres config: `effective_cache_size = 4GB` on a 1 GB box misleads the planner;
  `shared_buffers` 128 MB is the default. Worth a deliberate pass with the VPS memory budget.
- `normalized_events` grows without retention (139,909 rows in Aug → 2.87M in Oct); the
  partial index keeps `/v1/pools` flat, but `/v1/pools/:slug/flows` and the 24h detail counts
  are bounded by `entity_id` + time and remain fine.
