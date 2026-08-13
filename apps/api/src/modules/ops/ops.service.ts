// apps/api/src/modules/ops/ops.service.ts
//
// E2 (Lot E — T3-D3): read-side of the refresh-pipeline observability.
// Serves rpc_metrics_runs + refresh_step_runs (written by the indexer's 71
// orchestrator at end of each refresh run) over a fixed 24h window.
//
// Honesty rules (Lot E brief): error rate IS aggregated over the window
// (sum(errors)/sum(calls) — that aggregation is sound); latency percentiles
// are NEVER aggregated/averaged — the payload carries the latest run's
// percentiles plus the last N per-run rows so variance stays visible.
//
// Public read-only: no env values, URLs, connection strings — targets and step
// names are fixed internal labels.
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../db/prisma.service';

const WINDOW = '24h';
const WINDOW_INTERVAL = '24 hours';
// Per-run percentile rows returned per target (newest first).
const RUNS_PER_TARGET = 20;

type RpcRunRow = {
  run_at: unknown;
  target: string;
  calls: number;
  errors: number;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
};

type StepSummaryRow = {
  step: string;
  last_run_at: unknown;
  last_status: string;
  last_duration_ms: number;
  last_message: string | null;
  failures_24h: number;
};

function toInt(value: unknown): number {
  return typeof value === 'bigint' ? Number(value) : Number(value ?? 0);
}

@Injectable()
export class OpsService {
  constructor(private readonly prisma: PrismaService) {}

  async getMetrics() {
    const rpcRows = (await this.prisma.$queryRawUnsafe(
      `
      select run_at, target, calls, errors, p50_ms, p95_ms, p99_ms
      from rpc_metrics_runs
      where run_at > now() - interval '${WINDOW_INTERVAL}'
      order by target asc, run_at desc
      `,
    )) as RpcRunRow[];

    const byTarget = new Map<string, RpcRunRow[]>();
    for (const row of rpcRows) {
      const bucket = byTarget.get(row.target);
      if (bucket) {
        bucket.push(row);
      } else {
        byTarget.set(row.target, [row]);
      }
    }

    const rpc = Array.from(byTarget.entries()).map(([target, rows]) => {
      // rows are newest-first per target; [0] is the latest run.
      const calls = rows.reduce((sum, r) => sum + toInt(r.calls), 0);
      const errors = rows.reduce((sum, r) => sum + toInt(r.errors), 0);
      const latest = rows[0];

      return {
        target,
        calls,
        errors,
        errorRate: calls > 0 ? errors / calls : 0,
        latest: {
          runAt: latest.run_at,
          p50Ms: toInt(latest.p50_ms),
          p95Ms: toInt(latest.p95_ms),
          p99Ms: toInt(latest.p99_ms),
        },
        runs: rows.slice(0, RUNS_PER_TARGET).map((r) => ({
          runAt: r.run_at,
          calls: toInt(r.calls),
          errors: toInt(r.errors),
          p50Ms: toInt(r.p50_ms),
          p95Ms: toInt(r.p95_ms),
          p99Ms: toInt(r.p99_ms),
        })),
      };
    });

    const stepRows = (await this.prisma.$queryRawUnsafe(
      `
      select distinct on (step)
        step,
        run_at as last_run_at,
        status as last_status,
        duration_ms as last_duration_ms,
        message as last_message,
        (
          select count(*)
          from refresh_step_runs f
          where f.step = r.step
            and f.status = 'FAILED'
            and f.run_at > now() - interval '${WINDOW_INTERVAL}'
        ) as failures_24h
      from refresh_step_runs r
      order by step asc, run_at desc
      `,
    )) as StepSummaryRow[];

    const steps = stepRows.map((row) => ({
      step: row.step,
      lastRunAt: row.last_run_at,
      lastStatus: row.last_status,
      lastDurationMs: toInt(row.last_duration_ms),
      lastMessage: row.last_message ?? null,
      failures24h: toInt(row.failures_24h),
    }));

    return {
      window: WINDOW,
      // Known boundary (Lot E brief): these are the INDEXER's outbound calls —
      // the API process's own Horizon calls (actions preflight) are not captured.
      scope: 'indexer refresh pipeline',
      rpc,
      steps,
    };
  }
}
