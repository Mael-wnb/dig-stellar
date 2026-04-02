// apps/web/src/composables/Usewalletbalance.ts
import { ref } from 'vue'

export interface TokenBalance {
  symbol: string
  amount: number
  valueUsd: number
}

export interface WalletBalance {
  address: string
  tokens: TokenBalance[]
  totalUsd: number
  loading: boolean
  error: string | null
}

// ── Prix live des assets Stellar ─────────────────────────────────────────────
// On fetch XLM via CoinGecko + on peut étendre avec d'autres assets

const COINGECKO_IDS: Record<string, string> = {
  XLM:  'stellar',
  USDC: 'usd-coin',
  EURC: 'euro-coin',
  BTC:  'bitcoin',
  ETH:  'ethereum',
}

async function fetchPrices(symbols: string[]): Promise<Record<string, number>> {
  const ids = symbols
    .map(s => COINGECKO_IDS[s])
    .filter(Boolean)
    .join(',')

  if (!ids) return {}

  const res = await fetch(
    `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`
  )
  const data = await res.json()

  const prices: Record<string, number> = {}
  for (const [symbol, geckoId] of Object.entries(COINGECKO_IDS)) {
    if (data[geckoId]?.usd) {
      prices[symbol] = data[geckoId].usd
    }
  }
  // Stablecoins sans gecko ID → peg à $1
  for (const sym of symbols) {
    if (!prices[sym]) prices[sym] = 1
  }
  return prices
}

// ── Fetch balances d'un wallet Stellar ───────────────────────────────────────

async function fetchWalletBalances(address: string): Promise<WalletBalance> {
  const result: WalletBalance = {
    address,
    tokens: [],
    totalUsd: 0,
    loading: false,
    error: null,
  }

  try {
    const res = await fetch(`https://horizon.stellar.org/accounts/${address}`)

    if (!res.ok) {
      result.error = res.status === 404
        ? 'Account not found on Stellar network.'
        : `Horizon error: ${res.status}`
      return result
    }

    const data = await res.json()
    const rawBalances: { asset_type: string; asset_code?: string; balance: string }[] =
      data.balances ?? []

    // Extraire les symbols présents
    const symbols = rawBalances.map(b =>
      b.asset_type === 'native' ? 'XLM' : (b.asset_code ?? 'UNKNOWN')
    )

    const prices = await fetchPrices(symbols)

    let total = 0
    const tokens: TokenBalance[] = []

    for (const b of rawBalances) {
      const symbol = b.asset_type === 'native' ? 'XLM' : (b.asset_code ?? 'UNKNOWN')
      const amount = parseFloat(b.balance)
      const price  = prices[symbol] ?? 0
      const valueUsd = amount * price

      if (amount > 0) {
        tokens.push({ symbol, amount, valueUsd })
        total += valueUsd
      }
    }

    // Trier par valeur USD décroissante
    tokens.sort((a, b) => b.valueUsd - a.valueUsd)

    result.tokens  = tokens
    result.totalUsd = total
  } catch (err) {
    result.error = 'Failed to fetch wallet data.'
  }

  return result
}

// ── Composable public ────────────────────────────────────────────────────────

export function useWalletBalance() {
  const balances = ref<Record<string, WalletBalance>>({})

  async function loadWallet(address: string): Promise<void> {
    // Init loading state
    balances.value[address] = {
      address,
      tokens: [],
      totalUsd: 0,
      loading: true,
      error: null,
    }

    const result = await fetchWalletBalances(address)
    result.loading = false
    balances.value[address] = result
  }

  function getWallet(address: string): WalletBalance | null {
    return balances.value[address] ?? null
  }

  function formatUsd(n: number): string {
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
    if (n >= 1_000)     return `$${(n / 1_000).toFixed(2)}K`
    return `$${n.toFixed(2)}`
  }

  function formatAmount(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
    if (n >= 1_000)     return `${(n / 1_000).toFixed(2)}K`
    return n.toFixed(4)
  }

  return {
    balances,
    loadWallet,
    getWallet,
    formatUsd,
    formatAmount,
  }
}