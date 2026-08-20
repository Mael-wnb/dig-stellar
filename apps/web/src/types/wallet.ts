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
  isActiveSigner: boolean;
  chain: string;
  totalPortfolioUsd?: number;
  balances?: WalletBalanceItem[];
  pools?: WalletPositionPool[]; // Blend DeFi positions (Gap B part 2)
  positionsLoading?: boolean;
  loading?: boolean;
}

// T2-D1 Gap B part 2 — Blend DeFi positions + health.
export interface WalletPoolHealthSummary {
  walletId: string;
  address: string;
  label: string | null;
  entityId: string | null; // pool entity id
  poolSlug: string | null;
  poolName: string | null;
  healthFactor: number | null; // null = no debt (not at risk)
  totalCollateralUsd: number;
  totalDebtUsd: number;
  positions?: WalletPositionItem[]; // H6 — per-asset legs behind the USD rollup
}

export interface WalletDefiSummary {
  totalSuppliedUsd: number;
  totalBorrowedUsd: number;
  netDefiUsd: number;
  poolHealth: WalletPoolHealthSummary[];
}

export interface WalletPositionItem {
  positionType: "supply" | "borrow" | string;
  side: "supplied" | "borrowed" | "other";
  assetSymbol: string | null;
  assetContractId: string | null;
  logoUrl: string | null; // backend asset logo; null → BrandLogo monogram
  amountScaled: number;
  amountUsd: number | null;
  collateralEnabled?: boolean;
}

export interface WalletPositionPool {
  venueSlug: string | null;
  entityId: string | null; // pool entity id (null = not targetable)
  poolSlug: string | null;
  poolName: string | null;
  healthFactor: number | null; // null = no debt
  totalCollateralUsd: number;
  totalDebtUsd: number;
  borrowLimitUsd: number | null;
  netApy: number | null;
  positionsCount: number | null;
  snapshotAt: string | null;
  positions: WalletPositionItem[];
}

export interface WalletPositionsResponse {
  walletId: string;
  address: string;
  pools: WalletPositionPool[];
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
  defi?: WalletDefiSummary;
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
  // Lot AB: absent on the FIRST watch-only track — the backend mints a real
  // user and returns its id (never the shared demo account).
  userId?: string;
  chain: string;
  address: string;
  label: string;
  signature: string;
}

export interface CreateWalletResponse {
  created?: boolean;
  // Lot AB: the owning user — the minted one when createdUser is true.
  createdUser?: boolean;
  userId?: string;
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
  // Session account id when one exists (W1): the backend attaches/promotes the
  // connected wallet inside THAT account instead of forking a new user.
  userId?: string;
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