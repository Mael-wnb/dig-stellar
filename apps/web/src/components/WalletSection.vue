<!-- src/components/WalletSection.vue -->
<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { connectWallet as connectWalletApi } from "../api/wallets";
import { useAppUser } from "../composables/useAppUser";
import { useWalletSession } from "../composables/useWalletSession";
import { useWallets } from "../composables/useWallets";
import { displaySymbol } from "../utils/format";
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
  connectedAddress,
  restoreWalletSession,
  disconnectWallet,
} = useWalletSession();

const {
  wallets,
  selectedWallet,
  overviewLoading,
  error: _error,
  defi,
  totalPortfolioUsd,
  isBusy,
  loadOverview,
  addWallet,
  refreshOneWallet,
  setPrimary,
  setSigner,
  removeWallet,
  hydrateFromConnect,
  clearWallets,
  selectWallet,
  toggleActive,
} = useWallets(userId);

const connectError = ref("");
const showAddModal = ref(false);
// Two add-paths share one modal: "signer" (address proven via the Kit, promoted
// to the user's active signer) vs "watch-only" (address typed in, never signs).
const addMode = ref<"signer" | "watch-only">("signer");
const pendingAddress = ref("");
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

// Health-factor presentation (Gap B). null = no debt (collateral-only, not at
// risk). Thresholds mirror the hand-off brief: ≥1.5 healthy, 1.2–1.5 caution,
// <1.2 at risk. The raw value is always shown next to the cue so it can be
// compared directly to Blend's own UI.
function hfDisplay(hf: number | null): {
  label: string;
  color: string;
  value: string;
} {
  if (hf === null || !Number.isFinite(hf)) {
    return { label: "No borrow", color: "#9a9b99", value: "—" };
  }
  const value = `HF ${hf.toFixed(2)}`;
  if (hf >= 1.5) return { label: "Healthy", color: "#6ee7a8", value };
  if (hf >= 1.2) return { label: "Caution", color: "#ffb86b", value };
  return { label: "At risk", color: "#ff7b7b", value };
}

// A wallet has DeFi exposure if any pool carries a position.
function hasDefi(wallet: WalletItem): boolean {
  return !!wallet.pools && wallet.pools.length > 0;
}

function balanceSymbol(balance: WalletBalanceItem): string {
  // Horizon flags the native token via assetType; otherwise the symbol may
  // itself be "native". Route both through the shared display helper.
  if (balance.metadata?.assetType === "native") return displaySymbol("native");
  return displaySymbol(balance.symbol ?? "Unknown");
}

// The active signer is "live" (capable of signing) only when the Kit is
// currently connected to its address. Designated-but-not-connected is an honest
// hybrid state we surface explicitly.
function isSignerConnected(wallet: WalletItem): boolean {
  return (
    wallet.isActiveSigner &&
    !!connectedAddress.value &&
    connectedAddress.value.toLowerCase() === wallet.address.toLowerCase()
  );
}

// Path 1 — "Connect signer wallet": connecting via the Kit proves control of the
// address, so the connected wallet becomes (or stays) the active signer.
async function openConnectModal(): Promise<void> {
  connectError.value = "";

  try {
    const sessionResult = await connectWallet();

    if (!sessionResult?.address) {
      throw new Error("No wallet address returned.");
    }

    // Brand-new user: the connect endpoint creates the user + wallet and
    // designates it the active signer server-side.
    if (!userId.value) {
      const connectResponse = await connectWalletApi({
        chain: "stellar",
        address: sessionResult.address,
        label: "",
      });

      setUserId(connectResponse.userId);
      hydrateFromConnect({ wallets: connectResponse.wallets });
      await loadOverview();

      const linkedWallet = wallets.value.find(
        (wallet) =>
          wallet.address.toLowerCase() === sessionResult.address.toLowerCase()
      );
      if (linkedWallet) selectedWallet.value = linkedWallet;
      return;
    }

    // Existing user, address already tracked: promote it to the active signer.
    const alreadyPresent = wallets.value.find(
      (wallet) =>
        wallet.address.toLowerCase() === sessionResult.address.toLowerCase()
    );

    if (alreadyPresent) {
      selectedWallet.value = alreadyPresent;
      if (!alreadyPresent.isActiveSigner) {
        await setSigner(alreadyPresent);
        selectedWallet.value =
          wallets.value.find((w) => w.id === alreadyPresent.id) ?? null;
      }
      return;
    }

    // Existing user, new connected address: confirm a label, then add + promote.
    addMode.value = "signer";
    pendingAddress.value = sessionResult.address;
    newLabel.value = "";
    showAddModal.value = true;
  } catch (err: unknown) {
    connectError.value =
      err instanceof Error ? err.message : "Connection failed or cancelled.";
  }
}

// Path 2 — "Add watch-only address": no Kit, no signing. Requires an existing
// user (connect a signer first), since watch-only wallets attach to that user.
function openWatchOnlyModal(): void {
  connectError.value = "";
  addMode.value = "watch-only";
  pendingAddress.value = "";
  newLabel.value = "";
  showAddModal.value = true;
}

async function confirmAdd(): Promise<void> {
  const address = pendingAddress.value.trim();
  if (!address) {
    connectError.value = "A Stellar address is required.";
    return;
  }

  addLoading.value = true;
  connectError.value = "";

  try {
    const alreadyPresent = wallets.value.find(
      (wallet) => wallet.address.toLowerCase() === address.toLowerCase()
    );

    if (alreadyPresent) {
      selectedWallet.value = alreadyPresent;
      if (addMode.value === "signer" && !alreadyPresent.isActiveSigner) {
        await setSigner(alreadyPresent);
      }
      closeAddModal();
      return;
    }

    const created = await addWallet({
      address,
      label: newLabel.value,
    });

    // Signer path: the wallet was just created watch-only by default — promote
    // it to the active signer (singleton; demotes any previous signer).
    if (addMode.value === "signer") {
      await setSigner(created);
    }

    closeAddModal();
  } catch (err: unknown) {
    console.error("[wallet] confirmAdd failed", err);
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
  addMode.value = "signer";
  pendingAddress.value = "";
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
</script>

<template>
  <div class="grid grid-cols-2 gap-[10px] max-sm:grid-cols-1">

    <!-- LEFT CARD -->
    <div class="bg-[#2A2A2A] border border-[#383838] rounded-[12px] p-4 flex flex-col gap-[14px]">

      <!-- BALANCE -->
      <div class="flex flex-col gap-1">
        <div class="flex items-center gap-2 flex-wrap">
          <p class="text-[12px] text-[#9a9b99]">Multi-Wallet Amount</p>

          <span
            class="px-2 py-[1px] text-[9px] font-bold rounded-full border border-[rgba(213,255,47,0.3)] text-[#d5ff2f] bg-[rgba(213,255,47,0.08)] cursor-help"
            title="Displayed balances are Mainnet. The network selector applies to signing (Testnet swap) only."
          >
            Mainnet holdings
          </span>
        </div>

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

      <!-- CONSOLIDATED DEFI (Blend) — across all tracked wallets -->
      <div class="bg-[#202020] border border-[#383838] rounded-[8px] px-3 py-[10px] flex flex-col gap-[8px]">
        <div class="flex items-center gap-2 flex-wrap">
          <p class="text-[12px] text-[#9a9b99]">DeFi positions</p>
          <span
            class="px-2 py-[1px] text-[9px] font-bold rounded-full border border-[rgba(213,255,47,0.3)] text-[#d5ff2f] bg-[rgba(213,255,47,0.08)]"
          >
            Blend
          </span>
        </div>

        <div v-if="defi.poolHealth.length" class="flex flex-col gap-[8px]">
          <div class="grid grid-cols-3 gap-2">
            <div class="flex flex-col">
              <span class="text-[10px] text-[#9a9b99]">Supplied</span>
              <span class="text-[14px] font-bold text-[#e2e6e1]">{{ fmtUsd(defi.totalSuppliedUsd) }}</span>
            </div>
            <div class="flex flex-col">
              <span class="text-[10px] text-[#9a9b99]">Borrowed</span>
              <span class="text-[14px] font-bold text-[#ffb86b]">{{ fmtUsd(defi.totalBorrowedUsd) }}</span>
            </div>
            <div class="flex flex-col">
              <span class="text-[10px] text-[#9a9b99]">Net DeFi</span>
              <span class="text-[14px] font-bold text-[#d5ff2f]">{{ fmtUsd(defi.netDefiUsd) }}</span>
            </div>
          </div>

          <!-- consolidated per-pool health across all wallets, riskiest first -->
          <div class="flex flex-col gap-[4px]">
            <div
              v-for="(pool, idx) in defi.poolHealth"
              :key="`${pool.walletId}-${pool.poolSlug}-${idx}`"
              class="flex items-center justify-between gap-2 text-[11px] border-b border-[#222] last:border-none py-[3px]"
            >
              <span class="text-[#9a9b99] truncate">
                {{ pool.label || shortAddr(pool.address) }} ·
                <span class="text-[#e2e6e1]">{{ pool.poolName || pool.poolSlug || "Pool" }}</span>
              </span>
              <span class="font-bold whitespace-nowrap" :style="{ color: hfDisplay(pool.healthFactor).color }">
                {{ hfDisplay(pool.healthFactor).label }}
                <span class="text-[#9a9b99] font-normal">({{ hfDisplay(pool.healthFactor).value }})</span>
              </span>
            </div>
          </div>
        </div>

        <p v-else class="text-[11px] text-[#9a9b99]">
          No Blend positions across your tracked wallets.
        </p>
      </div>

      <!-- WALLET LIST -->
      <div class="flex flex-col gap-[6px]">

        <div
          v-for="wallet in wallets"
          :key="wallet.id"
          class="grid grid-cols-[1fr_auto] items-center gap-[10px] bg-[#202020] border border-[#383838] rounded-[8px] px-3 py-[10px] cursor-pointer transition"
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

              <!-- ROLE: active signer (with live-connection state) vs watch-only -->
              <span
                v-if="wallet.isActiveSigner"
                class="px-2 py-[2px] text-[10px] font-bold rounded-full border"
                :class="isSignerConnected(wallet)
                  ? 'border-[rgba(213,255,47,0.5)] text-[#d5ff2f] bg-[rgba(213,255,47,0.12)]'
                  : 'border-[rgba(213,255,47,0.25)] text-[#a9c437] bg-[rgba(213,255,47,0.05)]'"
              >
                {{ isSignerConnected(wallet) ? "Active Signer · connected" : "Active Signer · not connected" }}
              </span>

              <span
                v-else
                class="px-2 py-[2px] text-[10px] font-bold rounded-full border border-[rgba(154,155,153,0.3)] text-[#9a9b99] bg-[rgba(154,155,153,0.08)]"
              >
                Watch-only
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

            <!-- Signing context: only the connected active signer can sign. -->
            <p
              v-if="selectedWallet.isActiveSigner"
              class="text-[11px]"
              :class="isSignerConnected(selectedWallet) ? 'text-[#d5ff2f]' : 'text-[#a9c437]'"
            >
              {{ isSignerConnected(selectedWallet)
                ? "This is your active signing wallet (connected)."
                : "Designated signer — connect this wallet to sign." }}
            </p>
            <p v-else class="text-[11px] text-[#9a9b99]">
              Watch-only — monitored, but cannot sign actions.
            </p>

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
              class="bg-[#161616] border border-[#383838] rounded-[8px] px-3 py-2 flex flex-col gap-1"
            >

              <div
                v-for="balance in selectedWallet.balances"
                :key="balance.id"
                class="flex justify-between items-center py-1 border-b border-[#222] last:border-none text-[12px]"
              >
                <div class="flex items-center gap-2">
                  <span class="font-bold text-[#e2e6e1]">
                    {{ balanceSymbol(balance) }}
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

            <div v-else class="text-[12px] text-[#9a9b99] bg-[#161616] border border-[#383838] rounded-[8px] p-3">
              No balances found for this wallet.
            </div>

            <!-- PER-WALLET DEFI (Blend): supplied / borrowed + health factor per pool -->
            <div class="flex items-center gap-2">
              <span class="text-[11px] text-[#9a9b99]">Blend positions</span>
              <span v-if="selectedWallet.positionsLoading" class="text-[11px] text-[#d5ff2f]">…</span>
            </div>

            <div
              v-if="hasDefi(selectedWallet)"
              class="flex flex-col gap-[8px]"
            >
              <div
                v-for="(pool, pIdx) in selectedWallet.pools"
                :key="`${pool.poolSlug}-${pIdx}`"
                class="bg-[#161616] border border-[#383838] rounded-[8px] px-3 py-2 flex flex-col gap-[6px]"
              >
                <div class="flex items-center justify-between gap-2">
                  <span class="text-[12px] font-bold text-[#e2e6e1] truncate">
                    {{ pool.poolName || pool.poolSlug || "Pool" }}
                  </span>
                  <span class="text-[11px] font-bold whitespace-nowrap" :style="{ color: hfDisplay(pool.healthFactor).color }">
                    {{ hfDisplay(pool.healthFactor).label }}
                    <span class="text-[#9a9b99] font-normal">{{ hfDisplay(pool.healthFactor).value }}</span>
                  </span>
                </div>

                <div
                  v-for="(position, posIdx) in pool.positions"
                  :key="`${pool.poolSlug}-${position.positionType}-${position.assetSymbol}-${posIdx}`"
                  class="flex justify-between items-center text-[12px] border-b border-[#222] last:border-none py-1"
                >
                  <div class="flex items-center gap-2 min-w-0">
                    <span
                      class="px-[6px] py-[1px] text-[9px] font-bold rounded-full border whitespace-nowrap"
                      :class="position.positionType === 'borrow'
                        ? 'border-[rgba(255,184,107,0.35)] text-[#ffb86b] bg-[rgba(255,184,107,0.08)]'
                        : 'border-[rgba(110,231,168,0.35)] text-[#6ee7a8] bg-[rgba(110,231,168,0.08)]'"
                    >
                      {{ position.positionType === "borrow" ? "Borrow" : "Supply" }}
                    </span>
                    <span class="font-bold text-[#e2e6e1]">{{ displaySymbol(position.assetSymbol ?? "?") }}</span>
                    <span class="text-[#9a9b99] truncate">
                      {{ (position.amountScaled ?? 0).toLocaleString("en-US", { maximumFractionDigits: 4 }) }}
                    </span>
                  </div>
                  <span
                    class="font-semibold whitespace-nowrap"
                    :class="position.positionType === 'borrow' ? 'text-[#ffb86b]' : 'text-[#d5ff2f]'"
                  >
                    {{ fmtUsd(position.amountUsd) }}
                  </span>
                </div>
              </div>
            </div>

            <div
              v-else
              class="text-[12px] text-[#9a9b99] bg-[#161616] border border-[#383838] rounded-[8px] p-3"
            >
              No Blend positions for this wallet.
            </div>

          </div>
        </transition>

        <!-- CONNECT ERROR -->
        <p v-if="connectError && !showAddModal" class="text-[11px] text-[#ff7b7b]">
          {{ connectError }}
        </p>

        <!-- ADD PATHS: distinct signer vs watch-only -->
        <div class="grid grid-cols-2 gap-2 max-sm:grid-cols-1">
          <button
            class="flex items-center justify-center gap-2 border border-dashed border-[rgba(213,255,47,0.3)] rounded-[8px] px-3 py-[10px] text-[#d5ff2f] text-[12px] font-semibold font-mono hover:border-[#d5ff2f] hover:bg-[rgba(213,255,47,0.05)] disabled:opacity-50"
            :disabled="isConnecting"
            @click="openConnectModal"
          >
            <span class="w-[18px] h-[18px] flex items-center justify-center text-[14px] bg-[rgba(213,255,47,0.12)] border border-[rgba(213,255,47,0.3)] rounded">
              +
            </span>
            {{ isConnecting ? "Opening wallet…" : "Connect signer wallet" }}
          </button>

          <button
            class="flex items-center justify-center gap-2 border border-dashed border-[#3a3a3a] rounded-[8px] px-3 py-[10px] text-[#9a9b99] text-[12px] font-semibold font-mono hover:border-[#9a9b99] hover:bg-[rgba(255,255,255,0.03)] disabled:opacity-40 disabled:cursor-not-allowed"
            :disabled="!userId"
            :title="!userId ? 'Connect a signer wallet first' : 'Add a watch-only address'"
            @click="openWatchOnlyModal"
          >
            <span class="w-[18px] h-[18px] flex items-center justify-center text-[12px] bg-[#202020] border border-[#3a3a3a] rounded">
              👁
            </span>
            Add watch-only address
          </button>
        </div>

      </div>
    </div>

    <!-- RIGHT CARD (UNCHANGED VISU) -->
    <div class="bg-[#2A2A2A] border border-[#383838] rounded-[12px] p-4 flex flex-col gap-[14px] relative overflow-hidden">

      <p class="text-[12px] text-[#9a9b99]">Notifications</p>

      <div class="flex flex-col">
        <div
          v-for="(notification, index) in notifications"
          :key="index"
          class="flex justify-between items-center py-[9px] border-b border-[#383838]"
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

    <!-- ADD MODAL (shared by both add-paths) -->
    <div
      v-if="showAddModal"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      @click.self="closeAddModal"
    >
      <div class="w-full max-w-[380px] bg-[#2A2A2A] border border-[#383838] rounded-[12px] p-4 flex flex-col gap-3">

        <div class="flex items-center justify-between">
          <span class="text-[13px] font-bold text-[#e2e6e1]">
            {{ addMode === "signer" ? "Add signing wallet" : "Add watch-only address" }}
          </span>
          <button class="text-[#9a9b99] hover:text-white text-[14px]" @click="closeAddModal">✕</button>
        </div>

        <p class="text-[11px] text-[#9a9b99]">
          <template v-if="addMode === 'signer'">
            This wallet becomes your
            <span class="text-[#d5ff2f] font-semibold">active signer</span> — the
            only wallet that can sign actions.
          </template>
          <template v-else>
            Fully monitored, but
            <span class="text-[#ffb86b] font-semibold">watch-only</span>: it can
            never sign.
          </template>
        </p>

        <label class="flex flex-col gap-1">
          <span class="text-[11px] text-[#9a9b99]">Stellar address</span>
          <input
            v-model="pendingAddress"
            type="text"
            :readonly="addMode === 'signer'"
            placeholder="G…"
            class="bg-[#202020] border border-[#383838] rounded-md px-3 py-2 text-[12px] font-mono text-[#e2e6e1] focus:border-[#d5ff2f] outline-none read-only:opacity-60"
          />
        </label>

        <label class="flex flex-col gap-1">
          <span class="text-[11px] text-[#9a9b99]">Label (optional)</span>
          <input
            v-model="newLabel"
            type="text"
            placeholder="e.g. Main wallet"
            class="bg-[#202020] border border-[#383838] rounded-md px-3 py-2 text-[12px] text-[#e2e6e1] focus:border-[#d5ff2f] outline-none"
          />
        </label>

        <p v-if="connectError" class="text-[11px] text-[#ff7b7b]">{{ connectError }}</p>

        <div class="flex gap-2 justify-end">
          <button class="mini-btn" :disabled="addLoading" @click="closeAddModal">
            Cancel
          </button>
          <button
            class="mini-btn border-[#d5ff2f] text-[#d5ff2f]"
            :disabled="addLoading || !pendingAddress.trim()"
            @click="confirmAdd"
          >
            {{ addLoading ? "Adding…" : addMode === "signer" ? "Add signer" : "Add watch-only" }}
          </button>
        </div>
      </div>
    </div>

  </div>
</template>
