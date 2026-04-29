import type { PoolDetailData } from '../types/protocol'
import type { PoolDisplay } from '../types/poolDisplay'

function formatUsd(v?: number | null) {
  if (!v) return '—'
  if (v >= 1_000_000_000) return `$${(v / 1e9).toFixed(1)}B`
  if (v >= 1_000_000) return `$${(v / 1e6).toFixed(1)}M`
  if (v >= 1_000) return `$${(v / 1e3).toFixed(1)}K`
  return `$${v.toFixed(0)}`
}

function formatPercent(v?: number | null) {
  if (v == null) return '—'
  return `${(v * 100).toFixed(2)}%`
}

export function mapPoolToDisplay(data: PoolDetailData): PoolDisplay {
  const isLending = data.type === 'lending_pool'
  const isAmm = data.type === 'amm_pool'

  let metrics: PoolDisplay['metrics'] = []

  /* ───────────────────────── */
  /* AMM */
  /* ───────────────────────── */

  if (isAmm) {
    metrics = [
      { label: 'TVL', value: formatUsd(data.metrics.tvlUsd), lime: true },
      { label: 'Volume 24h', value: formatUsd(data.metrics.volume24hUsd) },
      { label: 'Fees 24h', value: formatUsd(data.metrics.fees24hUsd) },
      { label: 'Swaps 24h', value: data.metrics.swaps24h?.toString() ?? '—' },
      { label: 'Tokens', value: data.tokens?.length?.toString() ?? '—' },
      { label: 'Type', value: 'AMM' },
    ]
  }

  /* ───────────────────────── */
  /* LENDING */
  /* ───────────────────────── */

  if (isLending) {
    metrics = [
      { label: 'TVL', value: formatUsd(data.metrics.tvlUsd), lime: true },
      { label: 'Supplied', value: formatUsd(data.metrics.totalSuppliedUsd) },
      { label: 'Borrowed', value: formatUsd(data.metrics.totalBorrowedUsd) },
      { label: 'Net Liquidity', value: formatUsd(data.metrics.netLiquidityUsd) },
      { label: 'Supply APY', value: formatPercent(data.metrics.supplyApy) },
      { label: 'Borrow APY', value: formatPercent(data.metrics.borrowApy) },
    ]
  }

  /* ───────────────────────── */
  /* ON-CHAIN INFO (inchangé) */
  /* ───────────────────────── */

  const onChainInfo = [
    { key: 'Protocol', value: data.protocol.name },
    { key: 'Type', value: data.type },
    { key: 'Chain', value: data.chain },
    {
      key: 'Contract',
      value: data.contractAddress
        ? data.contractAddress.slice(0, 6) + '...' + data.contractAddress.slice(-4)
        : '—',
    },
    {
      key: 'Updated',
      value: data.updatedAt
        ? new Date(data.updatedAt).toLocaleString()
        : '—',
    },
  ]

  return {
    ...data,
    metrics,
    onChainInfo,
  }
}