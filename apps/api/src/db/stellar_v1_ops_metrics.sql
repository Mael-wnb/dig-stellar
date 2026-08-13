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
