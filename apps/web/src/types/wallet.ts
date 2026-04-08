// src/types/wallet.ts

export interface WalletBalanceItem {
    id: string
    symbol: string
    balance: number
    priceUsd: number
    balanceUsd: number
    assetContractId: string
    metadata: {
      assetCode: string | null
      assetType: string
    }
  }
  
  export interface WalletItem {
    id: string
    address: string
    label: string
    isPrimary: boolean
    isActive: boolean
    chain: string
    totalPortfolioUsd?: number
    balances?: WalletBalanceItem[]
    loading?: boolean
  }
  
  export interface WalletOverviewResponse {
    wallets: WalletItem[]
  }
  
  export interface WalletBalancesResponse {
    totalPortfolioUsd: number
    balances: WalletBalanceItem[]
  }
  
  export interface CreateWalletRequest {
    userId: string
    chain: string
    address: string
    label: string
    signature: string
  }
  
  export interface WalletNotification {
    wallet: string
    protocol: string
    status: string
    color: string
  }