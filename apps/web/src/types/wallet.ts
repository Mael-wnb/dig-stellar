// src/types/wallet.ts

export interface WalletBalanceItem {
  id: string;
  symbol: string;
  balance: number;
  priceUsd: number;
  balanceUsd: number;
  assetContractId: string;
  metadata: {
    assetCode: string | null;
    assetType: string;
  };
}

export interface WalletItem {
  id: string;
  address: string;
  label: string;
  isPrimary: boolean;
  isActive: boolean;
  chain: string;
  totalPortfolioUsd?: number;
  balances?: WalletBalanceItem[];
  loading?: boolean;
}

export interface WalletOverviewResponse {
  userId: string;
  wallets: WalletItem[];
  summary?: {
    totalWallets: number;
    activeWallets: number;
    totalTrackedPositions: number;
    totalPortfolioUsd: number;
  };
  byChain?: Array<{
    chain: string;
    totalWallets: number;
    activeWallets: number;
  }>;
}

export interface WalletBalancesResponse {
  totalPortfolioUsd: number;
  balances: WalletBalanceItem[];
}

export interface CreateWalletRequest {
  userId: string;
  chain: string;
  address: string;
  label: string;
  signature: string;
}

export interface CreateWalletResponse {
  created?: boolean;
  wallet: WalletItem;
}

export interface RefreshWalletResponse {
  refreshed: boolean;
  wallet: WalletItem;
  count: number;
  totalPortfolioUsd: number;
  balances: WalletBalanceItem[];
}

export interface ConnectWalletRequest {
  chain: string;
  address: string;
  label?: string;
}

export interface ConnectWalletResponse {
  connected: boolean;
  createdUser: boolean;
  createdWallet: boolean;
  userId: string;
  wallet: WalletItem;
  wallets: WalletItem[];
  summary: {
    totalWallets: number;
    activeWallets: number;
    totalTrackedPositions: number;
    totalPortfolioUsd: number;
  };
  byChain: Array<{
    chain: string;
    totalWallets: number;
    activeWallets: number;
  }>;
}

export interface WalletNotification {
  wallet: string;
  protocol: string;
  status: string;
  color: string;
}