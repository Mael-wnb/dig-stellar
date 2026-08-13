-- apps/api/src/db/stellar_v1_ops_metrics.sql
--
-- E2 (Lot E — T3-D3): observability tables for the refresh pipeline.
-- Additive, idempotent (create … if not exists) — apply manually like the other
-- v1/v2/v3 schema files (see docs/runbooks.md "Apply raw SQL schemas").
--
-- rpc_metrics_runs: one row per (refresh run, external target) with the run's
-- call count, error count and latency percentiles computed from the run's
-- ACTUAL samples (nearest-rank over the sorted array — never averaged).
-- Written by the 71 orchestrator at end of run; read by GET /v1/ops/metrics.
create table if not exists rpc_metrics_runs (
  run_at timestamptz not null,
  target text not null,          -- 'soroban-rpc' | 'horizon' | 'defindex-api' | 'price-sources'
  calls int not null,
  errors int not null,
  p50_ms int not null,
  p95_ms int not null,
  p99_ms int not null,
  primary key (run_at, target)
);

create index if not exists idx_rpc_metrics_runs_target_run_at
  on rpc_metrics_runs(target, run_at desc);

-- refresh_step_runs: the per-step outcome summary the orchestrator already
-- prints (T3 incident fix), made queryable — incident history becomes one SQL
-- query instead of grepping cron logs.
create table if not exists refresh_step_runs (
  run_at timestamptz not null,
  step text not null,            -- e.g. 'blend', 'soroswap', 'prices:reference'
  status text not null,          -- 'SUCCESS' | 'FAILED'
  duration_ms int not null,
  message text,                  -- failure detail, null on success
  primary key (run_at, step)
);

create index if not exists idx_refresh_step_runs_run_at
  on refresh_step_runs(run_at desc);

create index if not exists idx_refresh_step_runs_step_run_at
  on refresh_step_runs(step, run_at desc);

-- E3 (Lot E — T3-D3): adoption counters. One row per successful server-side
-- BUILD (quote / signable XDR) — on-chain submission happens client-side
-- (non-custodial), so executed-tx evidence stays the manual hash list.
-- Addresses are public on-chain data, stored to count distinct actors; quotes
-- carry no address (null). Insert is fire-and-forget — a logging failure must
-- never fail the action itself. No backfill: counters start at deploy.
create table if not exists action_events (
  id bigint generated always as identity primary key,
  kind text not null,            -- 'sdex-quote' | 'sdex-swap-build' | 'blend-deposit-build' | 'blend-withdraw-build' | 'trustline-build'
  network text not null,         -- 'testnet' | 'mainnet'
  address text,                  -- acting Stellar address; null for quotes
  created_at timestamptz not null default now()
);

create index if not exists idx_action_events_created_at
  on action_events(created_at desc);

create index if not exists idx_action_events_kind_created_at
  on action_events(kind, created_at desc);
