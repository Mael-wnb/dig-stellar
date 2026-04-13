// apps/web/src/composables/useNetworkStats.ts
import { ref, onMounted } from 'vue'
import { fetchNetworkStats } from '../api/network'

export interface NetworkStat {
  title: string
  value: string
  change: string
}

function fmtUsd(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`
  return `$${n.toFixed(4)}`
}

function fmtCount(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return `${Math.round(n)}`
}

function fmtPct(change: number | null): string {
  if (change === null) return '—'
  const sign = change >= 0 ? '▲' : '▼'
  return `${sign} ${Math.abs(change).toFixed(1)}%`
}

function fmtFeeXlm(value: number): string {
  if (value >= 1) return `${value.toFixed(2)} XLM`
  if (value >= 0.0001) return `${value.toFixed(4)} XLM`
  return `${value.toFixed(7)} XLM`
}

const FALLBACK_ACTIVE_WALLETS = {
  value: '+10M',
  change: '▲ increase',
}

const FALLBACK_DEX_VOLUME = {
  value: '$410k',
  change: 'Stable',
}

const FALLBACK_USDC_SUPPLY = {
  value: '$242M',
  change: '▲ increase',
}

export function useNetworkStats() {
  const stats = ref<NetworkStat[]>([
    { title: 'XLM Price', value: '—', change: '—' },
    { title: 'Stellar TVL', value: '—', change: '—' },
    {
      title: 'Active Wallets',
      value: FALLBACK_ACTIVE_WALLETS.value,
      change: FALLBACK_ACTIVE_WALLETS.change,
    },
    { title: 'Stable MCap', value: '—', change: '—' },
    {
      title: '24h DEX Vol',
      value: FALLBACK_DEX_VOLUME.value,
      change: FALLBACK_DEX_VOLUME.change,
    },
    { title: 'Protocols', value: '—', change: 'tracked' },
    {
      title: 'USDC Supply',
      value: FALLBACK_USDC_SUPPLY.value,
      change: FALLBACK_USDC_SUPPLY.change,
    },
    { title: 'Avg Tx Fee', value: '—', change: 'stable' },
  ])

  const loading = ref(true)
  const error = ref<string | null>(null)

  function patch(title: string, value: string, change: string) {
    const stat = stats.value.find((item) => item.title === title)
    if (stat) {
      stat.value = value
      stat.change = change
    }
  }

  async function fetchAll() {
    loading.value = true
    error.value = null

    try {
      const data = await fetchNetworkStats()

      patch(
        'XLM Price',
        data.xlmPriceUsd !== null ? `$${data.xlmPriceUsd.toFixed(4)}` : '—',
        fmtPct(data.xlmPriceChange24hPct)
      )

      patch(
        'Stellar TVL',
        data.stellarTvlUsd !== null ? fmtUsd(data.stellarTvlUsd) : '—',
        data.stellarTvlUsd !== null ? 'live' : '—'
      )

      patch(
        'Active Wallets',
        data.activeWallets !== null ? fmtCount(data.activeWallets) : FALLBACK_ACTIVE_WALLETS.value,
        data.activeWallets !== null ? 'live' : FALLBACK_ACTIVE_WALLETS.change
      )

      patch(
        'Stable MCap',
        data.stableMcapUsd !== null ? fmtUsd(data.stableMcapUsd) : '—',
        data.stableMcapUsd !== null ? 'live' : '—'
      )

      patch(
        '24h DEX Vol',
        data.dexVolume24hUsd !== null ? fmtUsd(data.dexVolume24hUsd) : FALLBACK_DEX_VOLUME.value,
        data.dexVolume24hUsd !== null ? 'live' : FALLBACK_DEX_VOLUME.change
      )

      patch('Protocols', `${data.protocolCount}`, 'tracked')

      patch(
        'USDC Supply',
        data.usdcSupplyUsd !== null ? fmtUsd(data.usdcSupplyUsd) : FALLBACK_USDC_SUPPLY.value,
        data.usdcSupplyUsd !== null ? 'live' : FALLBACK_USDC_SUPPLY.change
      )

      patch(
        'Avg Tx Fee',
        data.avgTxFeeXlm !== null ? fmtFeeXlm(data.avgTxFeeXlm) : '—',
        data.avgTxFeeXlm !== null ? 'stable' : '—'
      )
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load network stats'
    } finally {
      loading.value = false
    }
  }

  onMounted(fetchAll)

  return { stats, loading, error, refresh: fetchAll }
}