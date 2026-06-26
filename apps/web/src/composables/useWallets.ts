// src/composables/useWallets.ts
import { computed, ref } from "vue";
import {
  createWallet,
  deleteWallet,
  fetchWalletBalances,
  fetchWalletOverview,
  fetchWalletPositions,
  refreshWallet,
  setActiveSigner,
  setPrimaryWallet,
  setWalletActive,
} from "../api/wallets";
import type { WalletDefiSummary, WalletItem } from "../types/wallet";
import { useActiveSigner } from "./useActiveSigner";

const EMPTY_DEFI: WalletDefiSummary = {
  totalSuppliedUsd: 0,
  totalBorrowedUsd: 0,
  netDefiUsd: 0,
  poolHealth: [],
};

export function useWallets(userIdRef: { value: string | null }) {
  const { setActiveSignerAddress } = useActiveSigner();
  const wallets = ref<WalletItem[]>([]);
  const selectedWallet = ref<WalletItem | null>(null);
  const overviewLoading = ref(true);
  const actionLoadingWalletId = ref<string | null>(null);
  const error = ref("");
  // Consolidated Blend DeFi view across all the user's wallets (from /overview).
  const defi = ref<WalletDefiSummary>({ ...EMPTY_DEFI });

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

  // Keep the shared active-signer address aligned with the current list. The
  // signer designation is a singleton (at most one isActiveSigner per user).
  function syncActiveSigner(): void {
    const signer = wallets.value.find((wallet) => wallet.isActiveSigner);
    setActiveSignerAddress(signer?.address ?? null);
  }

  async function loadOverview(): Promise<void> {
    const userId = userIdRef.value?.trim();

    if (!userId) {
      wallets.value = [];
      selectedWallet.value = null;
      defi.value = { ...EMPTY_DEFI };
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
        pools: wallet.pools ?? [],
        loading: false,
      }));

      defi.value = data.defi ?? { ...EMPTY_DEFI };

      syncActiveSigner();

      await Promise.all([
        ...wallets.value.map((wallet) => loadWalletBalances(wallet.id)),
        ...wallets.value.map((wallet) => loadWalletPositions(wallet.id)),
      ]);

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

  async function loadWalletPositions(walletId: string): Promise<void> {
    const userId = requireUserId();
    const wallet = wallets.value.find((item) => item.id === walletId);
    if (!wallet) return;

    wallet.positionsLoading = true;

    try {
      const data = await fetchWalletPositions(walletId, userId);
      wallet.pools = data.pools;
    } catch (err) {
      console.error(`Failed to fetch positions for ${walletId}`, err);
    } finally {
      wallet.positionsLoading = false;
    }
  }

  // Re-fetch ONLY the consolidated Blend DeFi block from /overview, without
  // re-mapping the wallet list, re-fetching every wallet's balances/positions,
  // or toggling the page-level overviewLoading flag. Used after a single-wallet
  // refresh so the consolidated header reflects the new snapshot, while keeping
  // the per-wallet re-fetch (balances/positions) as the only granular reload.
  async function loadDefiSummary(): Promise<void> {
    const userId = userIdRef.value?.trim();
    if (!userId) return;

    try {
      const data = await fetchWalletOverview(userId);
      defi.value = data.defi ?? { ...EMPTY_DEFI };
    } catch (err) {
      console.error("Failed to refresh consolidated DeFi summary", err);
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
      // refreshWallet also re-resolves Blend positions (non-fatal) server-side,
      // so AFTER it returns re-fetch this wallet's balances + positions, plus the
      // consolidated DeFi block (/overview) so the shared header reflects the new
      // state too — otherwise it stays stale until a full page reload. The server
      // refresh is awaited first; only then do the re-fetches read the new snapshot.
      await refreshWallet(wallet.id, userId);
      await Promise.all([
        loadWalletBalances(wallet.id),
        loadWalletPositions(wallet.id),
        loadDefiSummary(),
      ]);

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

  async function setSigner(wallet: WalletItem): Promise<void> {
    const userId = requireUserId();
    error.value = "";
    actionLoadingWalletId.value = wallet.id;

    try {
      await setActiveSigner(wallet.id, userId);
      await loadOverview();

      if (selectedWallet.value?.id === wallet.id) {
        selectedWallet.value =
          wallets.value.find((item) => item.id === wallet.id) ?? null;
      }
    } catch (err) {
      error.value =
        err instanceof Error ? err.message : "Failed to set active signer.";
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
      pools: wallet.pools ?? [],
      loading: false,
    }));

    syncActiveSigner();

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
    defi.value = { ...EMPTY_DEFI };
    error.value = "";
    overviewLoading.value = false;
    actionLoadingWalletId.value = null;
    setActiveSignerAddress(null);
  }

  return {
    wallets,
    selectedWallet,
    overviewLoading,
    actionLoadingWalletId,
    error,
    defi,
    totalPortfolioUsd,
    isBusy,
    loadOverview,
    loadWalletBalances,
    loadWalletPositions,
    addWallet,
    refreshOneWallet,
    setPrimary,
    setSigner,
    toggleActive,
    removeWallet,
    hydrateFromConnect,
    clearWallets,
    selectWallet,
  };
}