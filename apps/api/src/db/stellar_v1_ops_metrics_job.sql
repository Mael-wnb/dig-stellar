-- stellar_v1_ops_metrics_job.sql — Lot RP (RP1): per-job, per-method RPC observability.
--
-- Extends rpc_metrics_runs (stellar_v1_ops_metrics.sql) so the wallet-alert sweep
-- (82 → 81 + 83) can land its RPC samples next to the refresh job's without
-- polluting the refresh metrics served by GET /v1/ops/metrics:
--
--   job      which job produced the row: 'refresh' (71) or 'wallet-alert' (82).
--            Existing rows are refresh rows → default 'refresh'.
--   methods  calls per RPC method / REST verb for the run, e.g.
--            {"getLedgerEntries": 12, "simulateTransaction": 37} — the per-method
--            mix is what the provider bills on, so it is the number to budget.
--
-- Primary key stays (run_at, target): the two jobs never share a run_at to the
-- millisecond, and widening the key is a migration RP2 can do if it ever matters.
-- Idempotent; apply BEFORE deploying the RP1 indexer + API (both write/read it).

alter table rpc_metrics_runs
  add column if not exists job text not null default 'refresh';

alter table rpc_metrics_runs
  add column if not exists methods jsonb;

create index if not exists idx_rpc_metrics_runs_job_run_at
  on rpc_metrics_runs(job, run_at desc);
