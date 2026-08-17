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

// E3: the closed set of recorded build kinds (one row per successful build).
export type ActionEventKind =
  | 'sdex-quote'
  | 'sdex-swap-build'
  | 'blend-deposit-build'
  | 'blend-withdraw-build'
  | 'trustline-build';

type WalletsRow = {
  total: unknown;
  signers: unknown;
  distinct_users: unknown;
};

type ActionKindRow = {
  kind: string;
  network: string;
  count_24h: unknown;
  count_7d: unknown;
  total: unknown;
};

type DistinctAddressesRow = {
  d24h: unknown;
  d7d: unknown;
  total: unknown;
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

  // E3: fire-and-forget adoption event. A logging failure must NEVER fail the
  // action build itself — swallow and warn. Callers do not await this.
  // R1 (Lot R): optional build-time metadata (asset pair / asset, amounts,
  // venue/pool slug) — requires the `metadata` column from
  // stellar_v1_ops_metrics.sql to be applied BEFORE this ships.
  async recordActionEvent(
    kind: ActionEventKind,
    network: string,
    address: string | null,
    metadata?: Record<string, unknown> | null,
  ): Promise<void> {
    try {
      await this.prisma.$executeRawUnsafe(
        `insert into action_events (kind, network, address, metadata) values ($1, $2, $3, $4::jsonb)`,
        kind,
        network,
        address,
        metadata == null ? null : JSON.stringify(metadata),
      );
    } catch (err) {
      console.warn(
        `[ops] action_events insert failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // E3: adoption counters for the final tranche report / T3-D2 KPIs.
  async getAdoption() {
    const walletRows = (await this.prisma.$queryRawUnsafe(`
      select
        count(*)::int as total,
        count(*) filter (where is_active_signer)::int as signers,
        count(distinct user_id)::int as distinct_users
      from user_wallets
    `)) as WalletsRow[];
    const wallets = walletRows[0];

    const kindRows = (await this.prisma.$queryRawUnsafe(`
      select
        kind,
        network,
        count(*) filter (where created_at > now() - interval '24 hours')::int as count_24h,
        count(*) filter (where created_at > now() - interval '7 days')::int as count_7d,
        count(*)::int as total
      from action_events
      group by kind, network
      order by kind asc, network asc
    `)) as ActionKindRow[];

    const addrRows = (await this.prisma.$queryRawUnsafe(`
      select
        count(distinct address) filter (where created_at > now() - interval '24 hours')::int as d24h,
        count(distinct address) filter (where created_at > now() - interval '7 days')::int as d7d,
        count(distinct address)::int as total
      from action_events
      where address is not null
    `)) as DistinctAddressesRow[];
    const addrs = addrRows[0];

    return {
      // Stated honest boundary (Lot E brief): builds, not executions.
      boundary:
        'Counts successful server-side BUILDS (quotes + signable XDRs). ' +
        'On-chain submission happens client-side (non-custodial); executed-tx ' +
        'evidence remains the manually kept transaction-hash list. Counters ' +
        'start at deploy — no historical backfill exists.',
      wallets: {
        total: toInt(wallets?.total),
        signers: toInt(wallets?.signers),
        watchOnly: toInt(wallets?.total) - toInt(wallets?.signers),
        distinctUsers: toInt(wallets?.distinct_users),
      },
      actions: {
        total: kindRows.reduce((sum, r) => sum + toInt(r.total), 0),
        byKind: kindRows.map((r) => ({
          kind: r.kind,
          network: r.network,
          count24h: toInt(r.count_24h),
          count7d: toInt(r.count_7d),
          total: toInt(r.total),
        })),
        distinctAddresses: {
          count24h: toInt(addrs?.d24h),
          count7d: toInt(addrs?.d7d),
          total: toInt(addrs?.total),
        },
      },
    };
  }
}
