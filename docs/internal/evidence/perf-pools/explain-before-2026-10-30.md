# Prod EXPLAIN — before (2026-10-30, at rest, main 4d171d8)

Run by the founder on the VPS via `docker exec -i dig_stellar_postgres psql -U dig -d dig_stellar`.
Trimmed to the decisive lines; the full statements are in the README's recon section.

## Sizes, counts, config

```
         relname         | est_rows | table_size | index_size | total_size
-------------------------+----------+------------+------------+------------
 normalized_events       |  2861929 | 1718 MB    | 1001 MB    | 2719 MB
 reserve_snapshots       |   600088 | 205 MB     | 114 MB     | 319 MB
 pool_snapshots          |   183950 | 88 MB      | 30 MB      | 118 MB
 asset_prices            |   193740 | 56 MB      | 34 MB      | 89 MB
 pool_metrics_latest     |       44 | 192 kB     | 64 kB      | 256 kB
 entities                |       44 | 144 kB     | 64 kB      | 208 kB
 entity_assets           |      103 | 64 kB      | 64 kB      | 128 kB

 normalized_events_exact | last_24h | swap_rows
-------------------------+----------+-----------
                 2869665 |    31741 |   1231571
(count itself: 2359 ms)

shared_buffers = 128MB   work_mem = 4MB   effective_cache_size = 4GB   (on a 1 GB box)
```

Indexes on `normalized_events` before: pkey(id), unique(contract_address, event_id),
entity_id, event_key, occurred_at desc, tx_hash — nothing can serve `like '%:trade'`.

## A — getPools list statement: 0.3 ms (15 buffers)

## B — getPools swap counts (Lot Q, the culprit): **3,322 ms**

```
 Finalize GroupAggregate  (actual time=3315.692..3320.622 rows=26 loops=1)
   Buffers: shared hit=2082 read=217817
   ->  Gather Merge  Workers Planned: 2  Workers Launched: 2
         ->  Partial HashAggregate (actual time=3271.809..3271.819 rows=25 loops=3)
               ->  Hash Join (actual rows=956555 loops=3)
                     ->  Parallel Seq Scan on normalized_events ne (actual time=0.111..2051.721 rows=956555 loops=3)
                           Buffers: shared hit=2026 read=217817
 JIT: Total 57.716 ms
 Execution Time: 3322.033 ms
```

## B' — first rewrite attempt (global 24h group-by + per-entity EXISTS): **60,515 ms — rejected**

```
 Hash Left Join (actual time=3392.308..60510.002 rows=44 loops=1)
   Buffers: shared hit=171886 read=3951891
   ->  HashAggregate (actual time=343.187..343.618 rows=25)             -- the 24h part is fine
         ->  Index Scan using idx_normalized_events_occurred_at (rows=12592, Rows Removed by Filter: 19149)
   SubPlan 1
     ->  Seq Scan on normalized_events x (actual time=1367.273..1367.273 rows=1 loops=44)
           Filter: ((entity_id = e.id) AND ((event_key ~~ '%:trade') OR (event_key ~~ '%:swap')))
           Rows Removed by Filter: 1217332
```
44 loops × 1.37 s: the planner's LIMIT-1 model picked a seq scan with early stop for the
EXISTS; entities with no swap events never stop early. No index covered the predicate.

## C — getPools tokens: 5 ms

## D — getProtocols latest-reserve CTE: **698 ms** (full scan of reserve_snapshots)

```
 GroupAggregate (actual time=672.004..694.655 rows=54 loops=1)
   Buffers: shared hit=186 read=26228
   ... Parallel Seq Scan on reserve_snapshots rs_1 (actual rows=207197 loops=3)
       Buffers: shared hit=7 read=26225
```

## E — latest fresh price per asset: 0.9 ms (index on observed_at, 16 rows filtered per asset)
