// src/types/wallet.ts

export interface WalletBalanceItem {
  id: string
  assetId: string | null
  assetContractId: string | null
  symbol: string | null
  balanceRaw: string | number | null
  balance: number | null
  priceUsd: number | null
  balanceUsd: number | null
  snapshotAt: string | null
  metadata: {
    source?: string
    address?: string
    assetCode?: string | null
    assetType?: string | null
    assetIssuer?: string | null
    buyingLiabilities?: string | null
    sellingLiabilities?: string | null
  } | null
}

export interface WalletItem {
  id: string
  userId: string
  address: string
  label: string | null
  isPrimary: boolean
  isActive: boolean
  chain: string
  metadata: Record<string, unknown> | null
  createdAt: string
  updatedAt: string
  totalPortfolioUsd?: number
  balances?: WalletBalanceItem[]
  loading?: boolean
}

export interface WalletOverviewSummary {
  totalWallets: number
  activeWallets: number
  totalTrackedPositions: number
  totalPortfolioUsd: number
}

export interface WalletOverviewByChainItem {
  chain: string
  totalWallets: number
  activeWallets: number
}

export interface WalletOverviewResponse {
  userId: string
  summary: WalletOverviewSummary
  byChain: WalletOverviewByChainItem[]
  wallets: WalletItem[]
}

export interface WalletBalancesResponse {
  wallet: WalletItem
  count: number
  totalPortfolioUsd: number
  balances: WalletBalanceItem[]
}

export interface CreateWalletRequest {
  userId: string
  chain: string
  address: string
  label?: string | null
  signature?: string
}

export interface CreateWalletResponse {
  created: boolean
  wallet: WalletItem
}

export interface RefreshWalletResponse {
  refreshed: boolean
  wallet: WalletItem
  count: number
  totalPortfolioUsd: number
  balances: WalletBalanceItem[]
}

export interface WalletNotification {
  wallet: string
  protocol: string
  status: string
  color: string
}