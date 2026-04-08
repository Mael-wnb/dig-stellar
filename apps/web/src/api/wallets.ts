// src/api/wallets.ts
import { apiFetch } from './client'
import type {
  CreateWalletRequest,
  CreateWalletResponse,
  RefreshWalletResponse,
  WalletBalancesResponse,
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

export async function createWallet(
  payload: CreateWalletRequest
): Promise<CreateWalletResponse> {
  return apiFetch<CreateWalletResponse>('/wallets', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function refreshWallet(
  walletId: string,
  userId: string
): Promise<RefreshWalletResponse> {
  const query = new URLSearchParams({ userId }).toString()
  return apiFetch<RefreshWalletResponse>(`/wallets/${walletId}/refresh?${query}`, {
    method: 'POST',
  })
}