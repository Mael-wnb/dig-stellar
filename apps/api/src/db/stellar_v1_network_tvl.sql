-- Network TVL history (Lot G / T3-D3, G0).
--
-- History cannot be built after the fact — it accumulates. One row is written
-- per refresh cycle by the indexer at the end of step 7 (protocol metrics,
-- 70-protocol-persist-metrics.ts). Definition (founder ruling, 2026-08-17 — see
-- docs/decisions/2026-08-17-network-tvl-definition.md):
--   tvl_usd      = Σ pool_metrics_latest.tvl_usd over active entities of tracked
--                  venues, EXCLUDING defindex (its funds sit inside Blend pools —
--                  counting both double-counts). Lending pools contribute GROSS
--                  (total supplied); DEX pools contribute pool liquidity.
--                  Surfaced as "Total value tracked" — hero and chart both read
--                  this table, so they can never disagree.
--   tvl_net_usd  = tvl_usd − Σ total_borrowed_usd over the same rows
--                  ("Net TVL (supplied − borrowed)", the hero's secondary line).
--                  NULL on rows written before the 2026-08-17 methodology change
--                  — that NULL is the honest changeover marker; history is never
--                  rewritten. protocol_count counts the venues folded in.
-- The write is idempotent per run — as_of is truncated to the minute and
-- upserted — so re-running a cycle overwrites rather than duplicates.
--
-- Read by GET /v1/network/tvl-series (chart series + hero latest point).
-- Additive v1-pipeline migration; Prisma is untouched. Apply with:
--   psql "$DATABASE_URL" -f apps/api/src/db/stellar_v1_network_tvl.sql
create table if not exists network_tvl_snapshots (
  as_of timestamptz not null,
  tvl_usd numeric not null,
  protocol_count integer not null,
  created_at timestamptz not null default now(),
  primary key (as_of)
);

-- 2026-08-17 methodology change: net TVL alongside the gross sum. Nullable —
-- pre-change rows stay NULL and mark the changeover date.
alter table network_tvl_snapshots
  add column if not exists tvl_net_usd numeric;

create index if not exists idx_network_tvl_snapshots_as_of
  on network_tvl_snapshots(as_of desc);
