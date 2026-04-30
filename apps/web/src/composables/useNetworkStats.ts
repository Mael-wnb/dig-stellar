// apps/web/src/composables/useNetworkStats.ts
import { ref, onMounted } from 'vue'

export interface NetworkStat {
  title: string
  value: string
  change: string
}

export function useNetworkStats() {
  const stats = ref<NetworkStat[]>([
    { title: 'XLM Price',     value: '—',     change: '—' },
    { title: 'Stellar TVL',   value: '—',     change: '—' },
    { title: 'Active Wallet', value: '+10M',  change: 'Increase' },
    { title: 'Stable MCap',   value: '—',     change: '—' },
    { title: '24h DEX Vol',   value: '$410k', change: 'Stable' },
    { title: 'Protocols',     value: '3',     change: 'tracked' },
    { title: 'USDC Supply',   value: '$242M', change: 'Increase' },
    { title: 'Avg Tx Fee',    value: '—',     change: 'stable' },
  ])

  const loading = ref(true)
  const error = ref<string | null>(null)

  function fmt(n: number): string {
    if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`
    if (n >= 1_000_000)     return `$${(n / 1_000_000).toFixed(1)}M`
    if (n >= 1_000)         return `$${(n / 1_000).toFixed(1)}K`
    return `$${n.toFixed(4)}`
  }

  function fmtCount(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
    if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`
    return `${n}`
  }

  function arrow(change: number): string {
    const sign = change >= 0 ? '▲' : '▼'
    return `${sign} ${Math.abs(change).toFixed(1)}%`
  }

  function patch(title: string, value: string, change: string) {
    const s = stats.value.find(s => s.title === title)
    if (s) { s.value = value; s.change = change }
  }

  async function fetchXLMPrice() {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=usd&include_24hr_change=true'
    )
    const d = await res.json()
    const price  = d.stellar.usd as number
    const change = d.stellar.usd_24h_change as number
    patch('XLM Price', `$${price.toFixed(4)}`, arrow(change))
  }

  async function fetchTVL() {
    const res = await fetch('https://api.llama.fi/v2/chains')
    const d: { name: string; tvl: number }[] = await res.json()
    const stellar = d.find(c => c.name === 'Stellar')
    if (stellar) patch('Stellar TVL', fmt(stellar.tvl), '▲ live')
  }

  async function fetchStableMcap() {
    const res = await fetch('https://stablecoins.llama.fi/stablecoinchains')
    const d: { name: string; totalCirculatingUSD: { peggedUSD: number } }[] = await res.json()
    const stellar = d.find(c => c.name === 'Stellar')
    if (stellar) patch('Stable MCap', fmt(stellar.totalCirculatingUSD.peggedUSD), '▲ live')
  }

  async function fetchStellarExpert() {
    const res = await fetch(
      'https://api.stellar.expert/explorer/public/network-activity/summary'
    )
    const d = await res.json()
    if (d.accounts) {
      patch('Active Wallet', fmtCount(d.accounts), '▲ live')
    }
    if (d.dex_volume) {
      patch('24h DEX Vol', fmt(d.dex_volume), '▲ live')
    }
  }

  async function fetchUSDCSupply() {
    const res = await fetch(
      'https://api.stellar.expert/explorer/public/asset/USDC-GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN/supply'
    )
    const d = await res.json()
    if (d.issued) {
      const amount = d.issued / 10_000_000
      patch('USDC Supply', fmt(amount), '▲ live')
    }
  }

  async function fetchAvgFee() {
    const res = await fetch('https://horizon.stellar.org/fee_stats')
    const d = await res.json()
    const feeXLM = parseInt(d.fee_charged.mode) / 10_000_000
    patch('Avg Tx Fee', `${feeXLM} XLM`, 'stable')
  }

  async function fetchAll() {
    loading.value = true
    error.value = null
    await Promise.allSettled([
      fetchXLMPrice(),
      fetchTVL(),
      fetchStableMcap(),
      fetchStellarExpert(),
      fetchUSDCSupply(),
      fetchAvgFee(),
    ])
    loading.value = false
  }

  onMounted(fetchAll)

  return { stats, loading, error, refresh: fetchAll }
}