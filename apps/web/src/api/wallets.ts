// src/api/wallets.ts
import { apiFetch } from "./client";
import type {
  ConnectWalletRequest,
  ConnectWalletResponse,
  CreateWalletRequest,
  CreateWalletResponse,
  RefreshWalletResponse,
  WalletBalancesResponse,
  WalletItem,
  WalletOverviewResponse,
} from "../types/wallet";

export async function connectWallet(
  payload: ConnectWalletRequest
): Promise<ConnectWalletResponse> {
  return apiFetch<ConnectWalletResponse>("/wallets/connect", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function fetchWalletOverview(userId: string): Promise<WalletOverviewResponse> {
  const query = new URLSearchParams({ userId }).toString();
  return apiFetch<WalletOverviewResponse>(`/wallets/overview?${query}`);
}

export async function fetchWalletBalances(
  walletId: string,
  userId: string
): Promise<WalletBalancesResponse> {
  const query = new URLSearchParams({ userId }).toString();
  return apiFetch<WalletBalancesResponse>(`/wallets/${walletId}/balances?${query}`);
}

export async function createWallet(
  payload: CreateWalletRequest
): Promise<CreateWalletResponse> {
  return apiFetch<CreateWalletResponse>("/wallets", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function refreshWallet(
  walletId: string,
  userId: string
): Promise<RefreshWalletResponse> {
  const query = new URLSearchParams({ userId }).toString();
  return apiFetch<RefreshWalletResponse>(`/wallets/${walletId}/refresh?${query}`, {
    method: "POST",
  });
}

export async function setPrimaryWallet(
  walletId: string,
  userId: string
): Promise<{ updated: boolean; wallet: WalletItem }> {
  const query = new URLSearchParams({ userId }).toString();
  return apiFetch<{ updated: boolean; wallet: WalletItem }>(
    `/wallets/${walletId}/primary?${query}`,
    {
      method: "PATCH",
    }
  );
}

export async function setWalletActive(
  walletId: string,
  userId: string,
  isActive: boolean
): Promise<{ updated: boolean; wallet: WalletItem }> {
  const query = new URLSearchParams({ userId }).toString();
  return apiFetch<{ updated: boolean; wallet: WalletItem }>(
    `/wallets/${walletId}/active?${query}`,
    {
      method: "PATCH",
      body: JSON.stringify({ isActive }),
    }
  );
}

export async function deleteWallet(
  walletId: string,
  userId: string
): Promise<{ deleted: boolean; walletId: string; userId: string; address: string }> {
  const query = new URLSearchParams({ userId }).toString();
  return apiFetch<{ deleted: boolean; walletId: string; userId: string; address: string }>(
    `/wallets/${walletId}?${query}`,
    {
      method: "DELETE",
    }
  );
}