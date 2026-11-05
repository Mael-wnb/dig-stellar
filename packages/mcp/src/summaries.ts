// One-line human summaries for each tool result. Every summary ends with the freshness of
// the data it describes (`isStale`, `asOf`) so an agent cannot miss it.
import {
  asOfDate,
  isStale,
  type FreshnessMeta,
  type NetworkStats,
  type OpsStatus,
  type PoolDetail,
  type PoolSeries,
  type PoolSummary,
  type ProtocolSummary,
} from '@getdig/stellar-api';

export function usd(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'n/a';
  const abs = Math.abs(value);
  if (abs >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `$${(value / 1e3).toFixed(1)}K`;
  return `$${value.toFixed(2)}`;
}

/** APY/APR fractions from the API (0.05 = 5%). */
export function pct(fraction: number | null | undefined): string {
  if (fraction === null || fraction === undefined || !Number.isFinite(fraction)) return 'n/a';
  return `${(fraction * 100).toFixed(2)}%`;
}

function count(value: number | null | undefined): string {
  return value === null || value === undefined ? 'n/a' : value.toLocaleString('en-US');
}

export function freshness(payload: FreshnessMeta): string {
  return `isStale=${String(isStale(payload))}, asOf=${asOfDate(payload)?.toISOString() ?? 'n/a'}`;
}

export function freshnessOfRows(rows: FreshnessMeta[]): string {
  if (rows.length === 0) return 'isStale=n/a (no rows), asOf=n/a';
  const stale = rows.filter((row) => isStale(row) === true).length;
  const unknown = rows.filter((row) => isStale(row) === null).length;
  const times = rows
    .map(asOfDate)
    .filter((date): date is Date => date !== null)
    .map((date) => date.getTime());
  const oldest = times.length ? new Date(Math.min(...times)).toISOString() : 'n/a';
  const newest = times.length ? new Date(Math.max(...times)).toISOString() : 'n/a';
  const unknownNote = unknown ? ` (${unknown} with no row yet)` : '';
  return `isStale=true for ${stale}/${rows.length} rows${unknownNote}, asOf oldest=${oldest} newest=${newest}`;
}

export function summarizeProtocols(rows: ProtocolSummary[]): string {
  const parts = rows.map((row) => `${row.name} (${row.type}, TVL ${usd(row.tvlUsd)})`);
  return `${rows.length} protocols: ${parts.join(', ')}; ${freshnessOfRows(rows)}`;
}

export interface ListPoolsEcho {
  protocol?: string;
  sort?: string;
  order?: string;
}

function describePoolRow(row: PoolSummary): string {
  const m = row.metrics;
  const lending = row.type !== 'amm_pool';
  const detail = lending
    ? `supply APY ${pct(m.supplyApy)}, borrow APY ${pct(m.borrowApy)}`
    : `24h volume ${usd(m.volume24hUsd)}, 24h fees ${usd(m.fees24hUsd)}`;
  return `${row.id} [${row.protocol.name}, ${row.type}] TVL ${usd(m.tvlUsd)}, ${detail}`;
}

export function summarizePools(rows: PoolSummary[], query: ListPoolsEcho): string {
  const filter = query.protocol ? `protocol=${query.protocol}` : 'all protocols';
  const sort = `sort=${query.sort ?? 'tvlUsd'} ${query.order ?? 'desc'}`;
  const first = rows[0] ? `; first: ${describePoolRow(rows[0])}` : '';
  return `${rows.length} pools (${filter}, ${sort})${first}; ${freshnessOfRows(rows)}`;
}

export function summarizePool(pool: PoolDetail): string {
  const head = `${pool.name} [${pool.protocol.name}, ${pool.type}]: TVL ${usd(pool.metrics.tvlUsd)}`;
  if ('reserves' in pool) {
    const m = pool.metrics;
    return (
      `${head}, supplied ${usd(m.totalSuppliedUsd)}, borrowed ${usd(m.totalBorrowedUsd)}, ` +
      `supply APY ${pct(m.supplyApy)}, borrow APY ${pct(m.borrowApy)}, ${pool.reserves.length} reserves; ` +
      freshness(pool)
    );
  }
  const m = pool.metrics;
  return (
    `${head}, 24h volume ${usd(m.volume24hUsd)}, 24h fees ${usd(m.fees24hUsd)}, ` +
    `24h swaps ${count(m.swaps24h)}, ${pool.tokens.length} tokens; ` +
    freshness(pool)
  );
}

export function summarizeSeries(series: PoolSeries): string {
  const last = series.points[series.points.length - 1];
  const latest = last ? `, latest ${usd(last.tvlUsd)} on ${last.day}` : '';
  const covered = series.covered ? '' : ' (slug not covered by daily snapshots)';
  return (
    `${series.slug}: ${series.points.length} daily TVL points` +
    `${series.first && series.last ? ` ${series.first}..${series.last}` : ''}${latest}${covered}; ` +
    `isStale=n/a (series computed at request time from daily snapshots), asOf=${series.updatedAt}`
  );
}

export function summarizeNetworkStats(stats: NetworkStats): string {
  const change =
    stats.xlmPriceChange24hPct === null ? 'n/a' : `${stats.xlmPriceChange24hPct.toFixed(2)}% 24h`;
  const price = stats.xlmPriceUsd === null ? 'n/a' : `$${stats.xlmPriceUsd.toFixed(4)}`;
  return (
    `XLM ${price} (${change}), tracked Stellar DeFi TVL ${usd(stats.stellarTvlUsd)} across ` +
    `${stats.protocolCount} protocols, active wallets ${count(stats.activeWallets)}, ` +
    `24h DEX volume ${usd(stats.dexVolume24hUsd)}, USDC supply ${usd(stats.usdcSupplyUsd)}; ` +
    freshness(stats)
  );
}

/**
 * `/v1/ops/status` carries every run and every per-run segment of every component (about
 * 150 KB). The tool returns the same payload with `runs` and each component's `segments`
 * replaced by counts plus the last segment, which keeps the state, gaps and availability.
 */
export function condensePipelineStatus(status: OpsStatus) {
  const { runs, components, ...rest } = status;
  return {
    ...rest,
    runCount: runs.length,
    components: components.map(({ segments, ...component }) => ({
      ...component,
      segmentCount: segments.length,
      lastSegment: segments[segments.length - 1] ?? null,
    })),
  };
}

export function summarizePipelineStatus(status: OpsStatus, now: number = Date.now()): string {
  const { overall } = status;
  const byState = new Map<string, number>();
  for (const component of status.components) {
    byState.set(component.state, (byState.get(component.state) ?? 0) + 1);
  }
  const states = [...byState.entries()].map(([state, n]) => `${n} ${state}`).join(', ');
  const lastRun = overall.lastRunAt ? Date.parse(overall.lastRunAt) : Number.NaN;
  const stale = Number.isNaN(lastRun) ? null : now - lastRun > status.staleAfterSeconds * 1000;
  return (
    `Dig refresh pipeline (${status.window}): ${overall.state}, last run ${overall.lastRunAt ?? 'n/a'}, ` +
    `${overall.missedCycles24h} missed cycles and ${overall.failedSteps24h} failed steps in 24h, ` +
    `${status.runs.length} runs, ${status.gaps.length} gaps, components: ${states || 'none'}; ` +
    `isStale=${String(stale)}, asOf=${overall.lastRunAt ?? 'n/a'}`
  );
}
