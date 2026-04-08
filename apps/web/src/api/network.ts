// src/api/network.ts
import { apiFetch } from './client'
import type { PoolListItem } from '../types/protocol'

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url)

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(text || `Request failed: ${response.status}`)
  }

  return response.json() as Promise<T>
}

export interface CoinGeckoSimplePriceResponse {
  stellar?: {
    usd?: number
    usd_24h_change?: number
  }
}

export interface DefiLlamaChainRow {
  name: string
  tvl: number
}

export interface StablecoinChainRow {
  name: string
  totalCirculatingUSD?: {
    peggedUSD?: number
  }
}

export interface HorizonFeeStatsResponse {
  fee_charged?: {
    mode?: string
  }
}

export async function fetchXlmPriceStats(): Promise<{
  priceUsd: number
  change24h: number
}> {
  const data = await fetchJson<CoinGeckoSimplePriceResponse>(
    'https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=usd&include_24hr_change=true'
  )

  const priceUsd = data.stellar?.usd
  const change24h = data.stellar?.usd_24h_change

  if (!Number.isFinite(priceUsd) || !Number.isFinite(change24h)) {
    throw new Error('Invalid XLM price payload')
  }

  return {
    priceUsd: Number(priceUsd),
    change24h: Number(change24h),
  }
}

export async function fetchStellarTvl(): Promise<number> {
  const rows = await fetchJson<DefiLlamaChainRow[]>('https://api.llama.fi/v2/chains')
  const stellar = rows.find((row) => row.name === 'Stellar')

  if (!stellar || !Number.isFinite(stellar.tvl)) {
    throw new Error('Stellar TVL not found')
  }

  return stellar.tvl
}

export async function fetchStellarStableMcap(): Promise<number> {
  const rows = await fetchJson<StablecoinChainRow[]>(
    'https://stablecoins.llama.fi/stablecoinchains'
  )

  const stellar = rows.find((row) => row.name === 'Stellar')
  const value = stellar?.totalCirculatingUSD?.peggedUSD

  if (!Number.isFinite(value)) {
    throw new Error('Stellar stablecoin market cap not found')
  }

  return Number(value)
}

export async function fetchUsdcSupply(): Promise<number> {
  const data = await fetchJson<{ issued?: number }>(
    'https://api.stellar.expert/explorer/public/asset/USDC-GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN/supply'
  )

  if (!Number.isFinite(data.issued)) {
    throw new Error('USDC supply not found')
  }

  return Number(data.issued) / 10_000_000
}

export async function fetchAverageFeeXlm(): Promise<number> {
  const data = await fetchJson<HorizonFeeStatsResponse>('https://horizon.stellar.org/fee_stats')
  const rawMode = data.fee_charged?.mode

  if (!rawMode) {
    throw new Error('Fee stats not found')
  }

  const stroops = Number.parseInt(rawMode, 10)
  if (!Number.isFinite(stroops)) {
    throw new Error('Invalid fee mode value')
  }

  return stroops / 10_000_000
}

export async function fetchProtocolCount(): Promise<number> {
  const pools = await apiFetch<PoolListItem[]>('/pools')
  return new Set(pools.map((pool) => pool.protocol.id)).size
}

export async function fetchTrackedDexVolume24h(): Promise<number> {
  const pools = await apiFetch<PoolListItem[]>('/pools')

  return pools.reduce((sum, pool) => {
    const volume = pool.metrics.volume24hUsd
    return sum + (Number.isFinite(volume) ? Number(volume) : 0)
  }, 0)
}