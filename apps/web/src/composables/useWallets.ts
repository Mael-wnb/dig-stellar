// src/composables/useWallets.ts
import { computed, ref } from "vue";
import {
  createWallet,
  deleteWallet,
  fetchWalletBalances,
  fetchWalletOverview,
  refreshWallet,
  setPrimaryWallet,
  setWalletActive,
} from "../api/wallets";
import type { WalletItem } from "../types/wallet";

export function useWallets(userIdRef: { value: string | null }) {
  const wallets = ref<WalletItem[]>([]);
  const selectedWallet = ref<WalletItem | null>(null);
  const overviewLoading = ref(true);
  const actionLoadingWalletId = ref<string | null>(null);
  const error = ref("");

  const totalPortfolioUsd = computed(() =>
    wallets.value.reduce(
      (sum, wallet) => sum + (wallet.totalPortfolioUsd ?? 0),
      0
    )
  );

  function requireUserId(): string {
    const userId = userIdRef.value?.trim();
    if (!userId) {
      throw new Error("No connected app user found.");
    }
    return userId;
  }

  function isBusy(walletId?: string): boolean {
    return !!walletId && actionLoadingWalletId.value === walletId;
  }

  async function loadOverview(): Promise<void> {
    const userId = userIdRef.value?.trim();

    if (!userId) {
      wallets.value = [];
      selectedWallet.value = null;
      overviewLoading.value = false;
      return;
    }

    overviewLoading.value = true;
    error.value = "";

    try {
      const data = await fetchWalletOverview(userId);

      wallets.value = data.wallets.map((wallet) => ({
        ...wallet,
        totalPortfolioUsd: wallet.totalPortfolioUsd ?? 0,
        balances: wallet.balances ?? [],
        loading: false,
      }));

      await Promise.all(wallets.value.map((wallet) => loadWalletBalances(wallet.id)));

      if (selectedWallet.value) {
        const updatedSelectedWallet = wallets.value.find(
          (wallet) => wallet.id === selectedWallet.value?.id
        );
        selectedWallet.value = updatedSelectedWallet ?? null;
      }
    } catch (err) {
      error.value =
        err instanceof Error ? err.message : "Failed to fetch wallet overview.";
    } finally {
      overviewLoading.value = false;
    }
  }

  async function loadWalletBalances(walletId: string): Promise<void> {
    const userId = requireUserId();
    const wallet = wallets.value.find((item) => item.id === walletId);
    if (!wallet) return;

    wallet.loading = true;

    try {
      const data = await fetchWalletBalances(walletId, userId);
      wallet.totalPortfolioUsd = data.totalPortfolioUsd;
      wallet.balances = data.balances;
    } catch (err) {
      console.error(`Failed to fetch balances for ${walletId}`, err);
    } finally {
      wallet.loading = false;
    }
  }

  async function addWallet(params: {
    address: string;
    label?: string;
  }): Promise<WalletItem> {
    const userId = requireUserId();
    error.value = "";

    const response = await createWallet({
      userId,
      chain: "stellar",
      address: params.address,
      label: params.label?.trim() || "",
      signature: "",
    });

    const createdWallet = response.wallet ?? response;

    await refreshWallet(createdWallet.id, userId);
    await loadOverview();

    const justAddedWallet =
      wallets.value.find((wallet) => wallet.id === createdWallet.id) ?? null;

    selectedWallet.value = justAddedWallet;

    return createdWallet;
  }

  async function refreshOneWallet(wallet: WalletItem): Promise<void> {
    const userId = requireUserId();
    error.value = "";
    actionLoadingWalletId.value = wallet.id;

    try {
      await refreshWallet(wallet.id, userId);
      await loadWalletBalances(wallet.id);

      if (selectedWallet.value?.id === wallet.id) {
        const updatedWallet =
          wallets.value.find((item) => item.id === wallet.id) ?? null;
        selectedWallet.value = updatedWallet;
      }
    } catch (err) {
      error.value =
        err instanceof Error ? err.message : "Failed to refresh wallet.";
    } finally {
      actionLoadingWalletId.value = null;
    }
  }

  async function setPrimary(wallet: WalletItem): Promise<void> {
    const userId = requireUserId();
    error.value = "";
    actionLoadingWalletId.value = wallet.id;

    try {
      await setPrimaryWallet(wallet.id, userId);
      await loadOverview();

      if (selectedWallet.value?.id === wallet.id) {
        selectedWallet.value =
          wallets.value.find((item) => item.id === wallet.id) ?? null;
      }
    } catch (err) {
      error.value =
        err instanceof Error ? err.message : "Failed to set primary wallet.";
    } finally {
      actionLoadingWalletId.value = null;
    }
  }

  async function toggleActive(wallet: WalletItem): Promise<void> {
    const userId = requireUserId();
    error.value = "";
    actionLoadingWalletId.value = wallet.id;

    try {
      await setWalletActive(wallet.id, userId, !wallet.isActive);
      await loadOverview();

      if (selectedWallet.value?.id === wallet.id) {
        selectedWallet.value =
          wallets.value.find((item) => item.id === wallet.id) ?? null;
      }
    } catch (err) {
      error.value =
        err instanceof Error ? err.message : "Failed to update wallet status.";
    } finally {
      actionLoadingWalletId.value = null;
    }
  }

  async function removeWallet(wallet: WalletItem): Promise<void> {
    const userId = requireUserId();
    error.value = "";
    actionLoadingWalletId.value = wallet.id;

    try {
      await deleteWallet(wallet.id, userId);

      if (selectedWallet.value?.id === wallet.id) {
        selectedWallet.value = null;
      }

      await loadOverview();
    } catch (err) {
      error.value =
        err instanceof Error ? err.message : "Failed to delete wallet.";
    } finally {
      actionLoadingWalletId.value = null;
    }
  }

  function hydrateFromConnect(payload: {
    wallets: WalletItem[];
  }): void {
    wallets.value = payload.wallets.map((wallet) => ({
      ...wallet,
      totalPortfolioUsd: wallet.totalPortfolioUsd ?? 0,
      balances: wallet.balances ?? [],
      loading: false,
    }));

    if (selectedWallet.value) {
      const updatedSelectedWallet = wallets.value.find(
        (wallet) => wallet.id === selectedWallet.value?.id
      );
      selectedWallet.value = updatedSelectedWallet ?? null;
    }
  }

  function selectWallet(wallet: WalletItem): void {
    selectedWallet.value =
      selectedWallet.value?.id === wallet.id ? null : wallet;
  }

  function clearWallets(): void {
    wallets.value = [];
    selectedWallet.value = null;
    error.value = "";
    overviewLoading.value = false;
    actionLoadingWalletId.value = null;
  }

  return {
    wallets,
    selectedWallet,
    overviewLoading,
    actionLoadingWalletId,
    error,
    totalPortfolioUsd,
    isBusy,
    loadOverview,
    loadWalletBalances,
    addWallet,
    refreshOneWallet,
    setPrimary,
    toggleActive,
    removeWallet,
    hydrateFromConnect,
    clearWallets,
    selectWallet,
  };
}