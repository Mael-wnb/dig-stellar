# Local EXPLAIN — after (2026-10-30, dev DB: 252,700 normalized_events rows)

Proof that the rewritten statement B matches the partial index. Prod figures follow in
`explain-after-2026-10-30.md` once the pre-deploy block has run.

```
 idx_normalized_events_swaps_entity_time | 4256 kB   (252k-row copy; prod est. ~45 MB)

 Seq Scan on entities e  (actual time=0.024..2.502 rows=95 loops=1)
   Filter: is_active
   SubPlan 1
     ->  Aggregate (actual time=0.025..0.025 rows=1 loops=95)
           ->  Index Only Scan using idx_normalized_events_swaps_entity_time on normalized_events ne
                 Index Cond: ((entity_id = e.id) AND (occurred_at >= (now() - '24:00:00'::interval)))
                 (actual rows=60 loops=95)
   SubPlan 2
     ->  Index Only Scan using idx_normalized_events_swaps_entity_time on normalized_events ne_1
           Index Cond: (entity_id = e.id)
           (actual time=0.001..0.001 rows=0 loops=95)
 Execution Time: 2.518 ms
```

Also tried and dropped: `idx_reserve_snapshots_entity_snapshot (entity_id, snapshot_at desc)`
for a per-entity `max(snapshot_at)` in `/v1/protocols`. Even with `enable_seqscan` and
`enable_bitmapscan` off, the planner kept `idx_reserve_snapshots_snapshot_at` + an entity
filter (`Rows Removed by Filter: 1328`, loops=95) — the B' trap again for entities with no
reserve rows. Index not shipped; statement left unchanged; endpoint rides the 90 s cache.
