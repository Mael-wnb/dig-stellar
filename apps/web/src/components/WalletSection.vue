<!-- src/components/WalletSection.vue -->
<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { connectWallet as connectWalletApi } from "../api/wallets";
import { useAppUser } from "../composables/useAppUser";
import { useWalletSession } from "../composables/useWalletSession";
import { useWallets } from "../composables/useWallets";
import type {
  WalletBalanceItem,
  WalletNotification,
  WalletItem,
} from "../types/wallet";

defineProps<{
  notifications: WalletNotification[];
}>();

const { userId, setUserId, restoreUser, clearUser } = useAppUser();

const {
  isConnecting,
  connectWallet,
  restoreWalletSession,
  disconnectWallet,
} = useWalletSession();

const {
  wallets,
  selectedWallet,
  overviewLoading,
  error: _error,
  totalPortfolioUsd,
  isBusy,
  loadOverview,
  addWallet,
  refreshOneWallet,
  setPrimary,
  toggleActive,
  removeWallet,
  hydrateFromConnect,
  clearWallets,
  selectWallet,
} = useWallets(userId);

const connectError = ref("");
const showAddModal = ref(false);
const pendingAddress = ref("");
const pendingWalletProviderId = ref<string | null>(null);
const newLabel = ref("");
const addLoading = ref(false);

function fmtUsd(value: number | null | undefined): string {
  const amount =
    typeof value === "number" && Number.isFinite(value) ? value : 0;

  return `$${amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function shortAddr(address: string): string {
  return address.length > 14
    ? `${address.slice(0, 6)}…${address.slice(-6)}`
    : address;
}

function displaySymbol(balance: WalletBalanceItem): string {
  if (balance.metadata?.assetType === "native") return "XLM";
  if (balance.symbol?.toLowerCase() === "native") return "XLM";
  return balance.symbol ?? "Unknown";
}

async function openConnectModal(): Promise<void> {
  connectError.value = "";

  try {
    const sessionResult = await connectWallet();

    if (!sessionResult?.address) {
      throw new Error("No wallet address returned.");
    }

    const connectResponse = await connectWalletApi({
      chain: "stellar",
      address: sessionResult.address,
      label: "",
    });

    setUserId(connectResponse.userId);
    hydrateFromConnect({
      wallets: connectResponse.wallets,
    });

    pendingAddress.value = sessionResult.address;
    pendingWalletProviderId.value = sessionResult.providerId;

    const alreadyPresent = wallets.value.find(
      (wallet) =>
        wallet.address.toLowerCase() === sessionResult.address.toLowerCase()
    );

    if (alreadyPresent) {
      selectedWallet.value = alreadyPresent;
      showAddModal.value = false;
      await loadOverview();
      return;
    }

    newLabel.value = "";
    showAddModal.value = true;
  } catch (err: unknown) {
    connectError.value =
      err instanceof Error ? err.message : "Connection failed or cancelled.";
  }
}

async function _addWalletWithoutSignature(): Promise<void> {
    if (!pendingAddress.value) return;

  addLoading.value = true;
  connectError.value = "";

  try {
    const alreadyPresent = wallets.value.find(
      (wallet) =>
        wallet.address.toLowerCase() === pendingAddress.value.toLowerCase()
    );

    if (alreadyPresent) {
      selectedWallet.value = alreadyPresent;
      closeAddModal();
      return;
    }

    await addWallet({
      address: pendingAddress.value,
      label: newLabel.value,
    });

    closeAddModal();
  } catch (err: unknown) {
    console.error("[wallet] addWalletWithoutSignature failed", err);
    connectError.value =
      err instanceof Error ? err.message : "Failed to add wallet.";
  } finally {
    addLoading.value = false;
  }
}

async function handleDeleteWallet(wallet: WalletItem): Promise<void> {
  const confirmed = window.confirm(
    `Delete wallet ${wallet.label || shortAddr(wallet.address)}?`
  );
  if (!confirmed) return;

  await removeWallet(wallet);

  if (wallets.value.length === 0) {
    disconnectWallet();
    clearUser();
    clearWallets();
  }
}

function closeAddModal(): void {
  showAddModal.value = false;
  pendingAddress.value = "";
  pendingWalletProviderId.value = null;
  newLabel.value = "";
  connectError.value = "";
}

watch(
  () => userId.value,
  async (nextUserId) => {
    if (nextUserId) {
      await loadOverview();
    } else {
      clearWallets();
    }
  },
  { immediate: true }
);

onMounted(() => {
  restoreWalletSession();
  restoreUser();
});
void _addWalletWithoutSignature
</script>

<template>
  <div class="grid grid-cols-2 gap-[10px] max-sm:grid-cols-1">

    <!-- LEFT CARD -->
    <div class="bg-[#181818] border border-[#2a2a2a] rounded-[12px] p-4 flex flex-col gap-[14px]">

      <!-- BALANCE -->
      <div class="flex flex-col gap-1">
        <p class="text-[12px] text-[#9a9b99]">Multi-Wallet Amount</p>

        <p v-if="overviewLoading" class="text-[2rem] font-bold text-white leading-[1.1] tracking-[-0.03em]">
          —
        </p>

        <p v-else class="text-[2rem] font-bold text-white leading-[1.1] tracking-[-0.03em]">
          {{ fmtUsd(totalPortfolioUsd) }}
        </p>

        <p v-if="selectedWallet" class="text-[12px] text-[#9a9b99]">
          {{ selectedWallet.label || "Wallet" }} —
          {{ fmtUsd(selectedWallet.totalPortfolioUsd ?? 0) }}
        </p>
      </div>

      <!-- WALLET LIST -->
      <div class="flex flex-col gap-[6px]">

        <div
          v-for="wallet in wallets"
          :key="wallet.id"
          class="grid grid-cols-[1fr_auto] items-center gap-[10px] bg-[#202020] border border-[#2a2a2a] rounded-[8px] px-3 py-[10px] cursor-pointer transition"
          :class="[
            selectedWallet?.id === wallet.id
              ? 'border-[#d5ff2f] bg-[#1a1f0e]'
              : 'hover:border-[rgba(213,255,47,0.3)]'
          ]"
          @click="selectWallet(wallet)"
        >

          <div class="flex flex-col gap-1 min-w-0">

            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-[12px] font-bold text-[#e2e6e1] whitespace-nowrap">
                {{ wallet.label || "Unnamed wallet" }}
              </span>

              <span
                v-if="wallet.isPrimary"
                class="px-2 py-[2px] text-[10px] font-bold rounded-full border border-[rgba(213,255,47,0.3)] text-[#d5ff2f] bg-[rgba(213,255,47,0.08)]"
              >
                Primary
              </span>

              <span
                v-if="!wallet.isActive"
                class="px-2 py-[2px] text-[10px] font-bold rounded-full border border-[rgba(255,184,107,0.3)] text-[#ffb86b] bg-[rgba(255,184,107,0.08)]"
              >
                Inactive
              </span>
            </div>

            <span class="text-[11px] text-[#9a9b99] font-mono truncate">
              {{ shortAddr(wallet.address) }}
            </span>

          </div>

          <div class="flex items-center gap-2 shrink-0">

            <span v-if="wallet.loading" class="text-[12px] text-[#d5ff2f] font-semibold">…</span>

            <span v-else class="text-[12px] text-[#d5ff2f] font-semibold">
              {{ fmtUsd(wallet.totalPortfolioUsd ?? 0) }}
            </span>

            <button
              class="text-[11px] text-[#d5ff2f] border border-[rgba(213,255,47,0.3)] rounded-[5px] px-2 py-1 hover:bg-[rgba(213,255,47,0.1)]"
              @click.stop="selectWallet(wallet)"
            >
              Select ›
            </button>

          </div>

        </div>

        <!-- DETAIL -->
        <transition name="slide">
          <div v-if="selectedWallet" class="flex flex-col gap-[10px]">

            <div class="flex flex-wrap gap-[6px]">

              <button class="mini-btn" :disabled="isBusy(selectedWallet.id)" @click="refreshOneWallet(selectedWallet)">
                {{ isBusy(selectedWallet.id) ? "Refreshing…" : "Refresh" }}
              </button>

              <button class="mini-btn" :disabled="isBusy(selectedWallet.id) || selectedWallet.isPrimary" @click="setPrimary(selectedWallet)">
                Set primary
              </button>

              <button class="mini-btn" :disabled="isBusy(selectedWallet.id)" @click="toggleActive(selectedWallet)">
                {{ selectedWallet.isActive ? "Deactivate" : "Activate" }}
              </button>

              <button class="mini-btn text-[#ff7b7b] border-[rgba(255,123,123,0.35)]" :disabled="isBusy(selectedWallet.id)" @click="handleDeleteWallet(selectedWallet)">
                Delete
              </button>

            </div>

            <div v-if="selectedWallet.balances?.length"
              class="bg-[#161616] border border-[#2a2a2a] rounded-[8px] px-3 py-2 flex flex-col gap-1"
            >

              <div
                v-for="balance in selectedWallet.balances"
                :key="balance.id"
                class="flex justify-between items-center py-1 border-b border-[#222] last:border-none text-[12px]"
              >
                <div class="flex items-center gap-2">
                  <span class="font-bold text-[#e2e6e1]">
                    {{ displaySymbol(balance) }}
                  </span>
                  <span class="text-[#9a9b99]">
                    {{ (balance.balance ?? 0).toLocaleString("en-US", { maximumFractionDigits: 4 }) }}
                  </span>
                </div>

                <span class="text-[#d5ff2f] font-semibold">
                  {{ fmtUsd(balance.balanceUsd) }}
                </span>
              </div>

            </div>

            <div v-else class="text-[12px] text-[#9a9b99] bg-[#161616] border border-[#2a2a2a] rounded-[8px] p-3">
              No balances found for this wallet.
            </div>

          </div>
        </transition>

        <!-- ADD BUTTON -->
        <button
          class="flex items-center gap-2 w-full border border-dashed border-[rgba(213,255,47,0.3)] rounded-[8px] px-3 py-[10px] text-[#d5ff2f] text-[12px] font-semibold font-mono hover:border-[#d5ff2f] hover:bg-[rgba(213,255,47,0.05)]"
          :disabled="isConnecting"
          @click="openConnectModal"
        >
          <span class="w-[18px] h-[18px] flex items-center justify-center text-[14px] bg-[rgba(213,255,47,0.12)] border border-[rgba(213,255,47,0.3)] rounded">
            +
          </span>
          {{ isConnecting ? "Opening wallet…" : "Add Stellar Wallet" }}
        </button>

      </div>
    </div>

    <!-- RIGHT CARD (UNCHANGED VISU) -->
    <div class="bg-[#181818] border border-[#2a2a2a] rounded-[12px] p-4 flex flex-col gap-[14px] relative overflow-hidden">

      <p class="text-[12px] text-[#9a9b99]">Notifications</p>

      <div class="flex flex-col">
        <div
          v-for="(notification, index) in notifications"
          :key="index"
          class="flex justify-between items-center py-[9px] border-b border-[#2a2a2a]"
        >
          <span class="text-[12px] text-[#9a9b99]">
            <strong class="text-[#e2e6e1]">{{ notification.wallet }}</strong> :
            {{ notification.protocol }} ›
          </span>

          <span class="text-[12px] font-bold" :style="{ color: notification.color }">
            {{ notification.status }}
          </span>
        </div>
      </div>

      <div class="flex flex-col gap-2 mt-1">

        <button class="text-[12px] font-bold text-[#d5ff2f] bg-[#373b26] border border-[#d5ff2f] rounded px-3 py-[7px] w-fit">
          Rebalance Wallet 1
        </button>

        <button class="text-[12px] font-bold text-white bg-[#222] border border-[#3a3a3a] rounded px-3 py-[7px] w-fit">
          Claim Wallet 2
        </button>

        <button class="text-[12px] text-[#d5ff2f]">
          See all notifications
        </button>

      </div>

      <!-- OVERLAY -->
      <div class="absolute inset-0 bg-[rgba(14,14,14,0.35)] backdrop-blur-[1.5px] flex items-center justify-center pointer-events-none rounded-[15px]">

        <div class="flex items-center gap-2 bg-[#1a1a1a] border border-[#3a3a3a] rounded-full px-[18px] py-2 text-[15px] font-semibold text-[#9a9b99] tracking-[0.06em]">

          <span class="w-[6px] h-[6px] bg-[#d5ff2f] rounded-full animate-pulse"></span>

          On-chain actions — Coming soon

        </div>
      </div>

    </div>

  </div>
</template>