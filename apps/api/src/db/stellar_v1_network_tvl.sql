-- Network TVL history (Lot G / T3-D3, G0).
--
-- History cannot be built after the fact — it accumulates. One row is written
-- per refresh cycle by the indexer at the end of step 7 (protocol metrics,
-- 70-protocol-persist-metrics.ts): the sum over protocol_metrics_latest.tvl_usd
-- (the exact figure the dashboard hero shows) plus the count of protocols folded
-- into that sum. The write is idempotent per run — as_of is truncated to the
-- minute and upserted — so re-running a cycle overwrites rather than duplicates.
--
-- Read (later, G4) by GET /v1/network/tvl-series to draw the hero's 7-day curve.
-- Additive v1-pipeline migration; Prisma is untouched. Apply with:
--   psql "$DATABASE_URL" -f apps/api/src/db/stellar_v1_network_tvl.sql
create table if not exists network_tvl_snapshots (
  as_of timestamptz not null,
  tvl_usd numeric not null,
  protocol_count integer not null,
  created_at timestamptz not null default now(),
  primary key (as_of)
);

create index if not exists idx_network_tvl_snapshots_as_of
  on network_tvl_snapshots(as_of desc);
