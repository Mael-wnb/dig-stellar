// apps/api/src/modules/bridge/bridge.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../db/prisma.service';

// Allbridge Core bridges only USDC on Stellar (T2-D3). The contract is
// mono-token; surfacing it as such keeps the UI copy honest.
const TOKEN = 'USDC';

// Whitelisted summary windows -> fixed Postgres intervals. The interval string
// is a server-side constant (never raw user input) and is passed as a bound
// `$1::interval` parameter, so the enum is the only thing the caller controls.
const WINDOW_INTERVALS: Record<string, string> = {
  '24h': '24 hours',
  '7d': '7 days',
  '30d': '30 days',
};
const DEFAULT_WINDOW = '7d';

// Recent-flows feed: default page size + hard cap.
const DEFAULT_FLOW_LIMIT = 50;
const MAX_FLOW_LIMIT = 200;

// Daily net-flow series: default span + clamp. Small by design — this feeds a
// compact chart, not historical analytics. `days` is clamped to an integer and
// never string-concatenated into SQL.
const DEFAULT_SERIES_DAYS = 7;
const MIN_SERIES_DAYS = 1;
const MAX_SERIES_DAYS = 30;

// numeric columns come back from $queryRawUnsafe as Prisma.Decimal; unwrap to a
// plain number so the API never emits Decimal objects. Mirrors the helper in
// stellar.service.ts / network.service.ts.
function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof value === 'object') {
    if ('toNumber' in value && typeof (value as { toNumber: unknown }).toNumber === 'function') {
      try {
        return (value as { toNumber: () => number }).toNumber();
      } catch {
        return null;
      }
    }
    if ('toString' in value && typeof (value as { toString: unknown }).toString === 'function') {
      const n = Number((value as { toString: () => string }).toString());
      return Number.isFinite(n) ? n : null;
    }
  }
  return null;
}

type SummaryRow = {
  direction: string;
  chain_id: number | null;
  chain: string | null;
  count: number;
  amount_usd: unknown;
  last_flow_at: unknown;
};

type FlowRow = {
  direction: string;
  chain_id: number | null;
  chain: string | null;
  token_symbol: string | null;
  amount_scaled: unknown;
  amount_usd: unknown;
  tx_hash: string;
  recipient: string | null;
  occurred_at: unknown;
};

// Day bucket is emitted as a 'YYYY-MM-DD' text key straight from SQL (see the
// note in getDailyNetSeries on the UTC bucketing) so the API never has to
// reconcile Postgres vs JS timezone handling.
type SeriesRow = {
  day: string;
  direction: string;
  amount_usd: unknown;
};

type DailyNetEntry = {
  day: string; // 'YYYY-MM-DD' (UTC)
  inflowUsd: number;
  outflowUsd: number;
  netUsd: number;
};

type ChainBreakdown = {
  chainId: number | null;
  chain: string | null;
  amountUsd: number;
  count: number;
};

type DirectionSummary = {
  totalUsd: number;
  count: number;
  byChain: ChainBreakdown[];
};

@Injectable()
export class BridgeService {
  constructor(private readonly prisma: PrismaService) {}

  // Normalize an arbitrary window query into a whitelisted key. Unknown values
  // fall back to the default rather than erroring — the contract stays simple.
  private resolveWindow(window?: string): string {
    return window && WINDOW_INTERVALS[window] ? window : DEFAULT_WINDOW;
  }

  async getSummary(window?: string) {
    const resolvedWindow = this.resolveWindow(window);
    const interval = WINDOW_INTERVALS[resolvedWindow];

    const rows = (await this.prisma.$queryRawUnsafe(
      `
      select direction,
             counterparty_chain_id as chain_id,
             counterparty_chain    as chain,
             count(*)::int         as count,
             coalesce(sum(amount_usd), 0) as amount_usd,
             max(occurred_at)             as last_flow_at
      from bridge_flows
      where occurred_at > now() - $1::interval
      group by direction, counterparty_chain_id, counterparty_chain
      order by amount_usd desc
      `,
      interval
    )) as SummaryRow[];

    const inflow = this.shapeDirection(rows, 'inflow');
    const outflow = this.shapeDirection(rows, 'outflow');

    let lastFlowAt: Date | null = null;
    for (const row of rows) {
      if (!row.last_flow_at) continue;
      const ts = new Date(row.last_flow_at as string | Date);
      if (!Number.isNaN(ts.getTime()) && (!lastFlowAt || ts > lastFlowAt)) {
        lastFlowAt = ts;
      }
    }

    return {
      window: resolvedWindow,
      token: TOKEN,
      inflow,
      outflow,
      netUsd: Number((inflow.totalUsd - outflow.totalUsd).toFixed(6)),
      lastFlowAt: lastFlowAt ? lastFlowAt.toISOString() : null,
      updatedAt: new Date().toISOString(),
    };
  }

  // Collapse the grouped rows for one direction into a totals + per-chain shape.
  // Always returns zeros / [] so the contract is empty-safe (no null totals).
  private shapeDirection(rows: SummaryRow[], direction: string): DirectionSummary {
    const byChain: ChainBreakdown[] = [];
    let totalUsd = 0;
    let count = 0;

    for (const row of rows) {
      if (row.direction !== direction) continue;
      const amountUsd = toNumber(row.amount_usd) ?? 0;
      const rowCount = toNumber(row.count) ?? 0;
      totalUsd += amountUsd;
      count += rowCount;
      byChain.push({
        chainId: row.chain_id,
        chain: row.chain,
        amountUsd,
        count: rowCount,
      });
    }

    byChain.sort((a, b) => b.amountUsd - a.amountUsd);

    return {
      totalUsd: Number(totalUsd.toFixed(6)),
      count,
      byChain,
    };
  }

  async getFlows(direction?: string, limit?: number) {
    // Only inflow/outflow are valid filters; anything else means "no filter".
    const dirFilter =
      direction === 'inflow' || direction === 'outflow' ? direction : null;

    let safeLimit = DEFAULT_FLOW_LIMIT;
    if (typeof limit === 'number' && Number.isFinite(limit) && limit > 0) {
      safeLimit = Math.min(Math.floor(limit), MAX_FLOW_LIMIT);
    }

    const rows = (await this.prisma.$queryRawUnsafe(
      `
      select direction,
             counterparty_chain_id as chain_id,
             counterparty_chain    as chain,
             token_symbol,
             amount_scaled,
             amount_usd,
             tx_hash,
             recipient,
             occurred_at
      from bridge_flows
      where ($1::text is null or direction = $1)
      order by occurred_at desc
      limit $2
      `,
      dirFilter,
      safeLimit
    )) as FlowRow[];

    const flows = rows.map((row) => ({
      direction: row.direction,
      chainId: row.chain_id,
      chain: row.chain,
      token: row.token_symbol ?? TOKEN,
      amountScaled: toNumber(row.amount_scaled),
      amountUsd: toNumber(row.amount_usd),
      txHash: row.tx_hash,
      recipient: row.recipient,
      occurredAt:
        row.occurred_at instanceof Date
          ? row.occurred_at.toISOString()
          : row.occurred_at,
    }));

    return {
      count: flows.length,
      limit: safeLimit,
      flows,
    };
  }

  // Daily net-flow series for the last `days` days. One row per calendar day,
  // gap-filled so the chart always gets a continuous axis even when refresh /
  // Soroban-retention gaps leave empty days.
  //
  // CRITICAL: sums amount_usd only — never amount_scaled. inflow is 7-decimal
  // native USDC and outflow is 3-decimal Allbridge system precision, so only
  // amount_usd is directionally comparable (see stellar_v1_bridge.sql).
  //
  // Deviation vs the recon's sketch: the day bucket is computed in UTC
  // (`occurred_at at time zone 'UTC'`) and rendered to a 'YYYY-MM-DD' text key
  // in SQL via to_char. date_trunc on a timestamptz would otherwise bucket in
  // the session timezone and come back as a JS Date that node-postgres reparses
  // with the process offset — two chances for day drift. Emitting the key as
  // text keeps SQL buckets and the JS gap-fill range on the same UTC calendar.
  async getDailyNetSeries(days?: number) {
    let safeDays = DEFAULT_SERIES_DAYS;
    if (typeof days === 'number' && Number.isFinite(days) && days > 0) {
      safeDays = Math.min(
        Math.max(Math.floor(days), MIN_SERIES_DAYS),
        MAX_SERIES_DAYS
      );
    }

    // Server-side constant interval string, passed as a bound `$1::interval`
    // param — mirrors getSummary. The window over-fetches the oldest partial day
    // slightly; gap-fill keeps only the exact `safeDays` UTC slots ending today.
    const interval = `${safeDays} days`;

    const rows = (await this.prisma.$queryRawUnsafe(
      `
      select to_char(date_trunc('day', occurred_at at time zone 'UTC'), 'YYYY-MM-DD') as day,
             direction,
             coalesce(sum(amount_usd), 0) as amount_usd
      from bridge_flows
      where occurred_at > now() - $1::interval
      group by 1, 2
      order by 1
      `,
      interval
    )) as SeriesRow[];

    const series = this.gapFillSeries(rows, safeDays);

    return {
      days: safeDays,
      series,
      updatedAt: new Date().toISOString(),
    };
  }

  // Pivot grouped (day, direction) rows into one entry per UTC day for the last
  // `days` days, oldest first, inserting zeros for days with no flows.
  private gapFillSeries(rows: SeriesRow[], days: number): DailyNetEntry[] {
    const byDay = new Map<string, { inflowUsd: number; outflowUsd: number }>();
    for (const row of rows) {
      if (!row.day) continue;
      const amount = toNumber(row.amount_usd) ?? 0;
      const entry = byDay.get(row.day) ?? { inflowUsd: 0, outflowUsd: 0 };
      if (row.direction === 'inflow') entry.inflowUsd += amount;
      else if (row.direction === 'outflow') entry.outflowUsd += amount;
      byDay.set(row.day, entry);
    }

    const series: DailyNetEntry[] = [];
    const today = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setUTCDate(d.getUTCDate() - i);
      const key = d.toISOString().slice(0, 10); // UTC 'YYYY-MM-DD'
      const hit = byDay.get(key) ?? { inflowUsd: 0, outflowUsd: 0 };
      const inflowUsd = Number(hit.inflowUsd.toFixed(6));
      const outflowUsd = Number(hit.outflowUsd.toFixed(6));
      series.push({
        day: key,
        inflowUsd,
        outflowUsd,
        netUsd: Number((inflowUsd - outflowUsd).toFixed(6)),
      });
    }
    return series;
  }
}
