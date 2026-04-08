// src/api/wallets.ts
import { apiFetch } from './client'
import type {
  CreateWalletRequest,
  WalletBalancesResponse,
  WalletItem,
  WalletOverviewResponse,
} from '../types/wallet'

export async function fetchWalletOverview(userId: string): Promise<WalletOverviewResponse> {
  const query = new URLSearchParams({ userId }).toString()
  return apiFetch<WalletOverviewResponse>(`/wallets/overview?${query}`)
}

export async function fetchWalletBalances(
  walletId: string,
  userId: string
): Promise<WalletBalancesResponse> {
  const query = new URLSearchParams({ userId }).toString()
  return apiFetch<WalletBalancesResponse>(`/wallets/${walletId}/balances?${query}`)
}

export async function createWallet(payload: CreateWalletRequest): Promise<WalletItem> {
  return apiFetch<WalletItem>('/wallets', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}