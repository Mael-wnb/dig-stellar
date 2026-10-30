-- perf/pools-latency — prod pre-deploy block (read-mostly: adds ONE index, nothing else).
-- Run between two job:refresh ticks. Plain psql autocommit: `create index concurrently`
-- refuses to run inside a transaction, so never add -1 / begin.
--
--   docker exec -i dig_stellar_postgres psql -U dig -d dig_stellar < docs/evidence/perf-pools/prod-index-and-explain.sql
\timing on

-- (a) the index (same statement as apps/api/src/db/stellar_v1_perf_indexes.sql)
create index concurrently if not exists idx_normalized_events_swaps_entity_time
  on normalized_events (entity_id, occurred_at desc)
  where (event_key like '%:trade' or event_key like '%:swap');

-- (b) validity + size (indisvalid must be t; if f the build was interrupted → drop index concurrently … and re-run)
select indexrelid::regclass as index, indisvalid, indisready,
       pg_size_pretty(pg_relation_size(indexrelid)) as size
from pg_index
where indexrelid = 'idx_normalized_events_swaps_entity_time'::regclass;

-- (c) the new /v1/pools swap statement, exactly as the API sends it — run twice
--     (the first run pays cold reads of the fresh index pages; the second is the steady state)
explain (analyze, buffers)
select
  e.slug as entity_slug,
  (
    select count(*)::int
    from normalized_events ne
    where ne.entity_id = e.id
      and (ne.event_key like '%:trade' or ne.event_key like '%:swap')
      and ne.occurred_at >= now() - interval '24 hours'
  ) as swaps_24h,
  exists (
    select 1
    from normalized_events ne
    where ne.entity_id = e.id
      and (ne.event_key like '%:trade' or ne.event_key like '%:swap')
  ) as swap_events_ever
from entities e
where e.is_active = true;

explain (analyze, buffers)
select
  e.slug as entity_slug,
  (
    select count(*)::int
    from normalized_events ne
    where ne.entity_id = e.id
      and (ne.event_key like '%:trade' or ne.event_key like '%:swap')
      and ne.occurred_at >= now() - interval '24 hours'
  ) as swaps_24h,
  exists (
    select 1
    from normalized_events ne
    where ne.entity_id = e.id
      and (ne.event_key like '%:trade' or ne.event_key like '%:swap')
  ) as swap_events_ever
from entities e
where e.is_active = true;

-- (d) sanity: the result itself (26 covered AMM pools expected to show true; lending/vault false)
select e.slug,
  exists (select 1 from normalized_events ne where ne.entity_id = e.id
          and (ne.event_key like '%:trade' or ne.event_key like '%:swap')) as covered
from entities e where e.is_active = true order by 2 desc, 1;
