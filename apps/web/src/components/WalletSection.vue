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
  error,
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

async function addWalletWithoutSignature(): Promise<void> {
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
</script>

<template>
  <div class="wallet-grid">
    <div class="card">
      <div class="balance-block">
        <p class="balance-label">Multi-Wallet Amount</p>
        <p v-if="overviewLoading" class="balance-total">—</p>
        <p v-else class="balance-total">{{ fmtUsd(totalPortfolioUsd) }}</p>
        <p v-if="selectedWallet" class="balance-sub">
          {{ selectedWallet.label || "Wallet" }} —
          {{ fmtUsd(selectedWallet.totalPortfolioUsd ?? 0) }}
        </p>
      </div>

      <div class="wallet-list">
        <div
          v-for="wallet in wallets"
          :key="wallet.id"
          class="wallet-row"
          :class="{ active: selectedWallet?.id === wallet.id }"
          @click="selectWallet(wallet)"
        >
          <div class="wallet-main">
            <div class="wallet-topline">
              <span class="wallet-num">
                {{ wallet.label || "Unnamed wallet" }}
                <span v-if="wallet.isPrimary" class="pill primary">Primary</span>
                <span v-if="!wallet.isActive" class="pill inactive">Inactive</span>
              </span>
            </div>

            <span class="wallet-addr">{{ shortAddr(wallet.address) }}</span>
          </div>

          <div class="wallet-right">
            <span v-if="wallet.loading" class="wallet-amount">…</span>
            <span v-else class="wallet-amount">
              {{ fmtUsd(wallet.totalPortfolioUsd ?? 0) }}
            </span>

            <button class="btn-sel" @click.stop="selectWallet(wallet)">
              Select ›
            </button>
          </div>
        </div>

        <transition name="slide">
          <div v-if="selectedWallet" class="wallet-detail-panel">
            <div class="wallet-actions">
              <button
                class="mini-btn"
                :disabled="isBusy(selectedWallet.id)"
                @click="refreshOneWallet(selectedWallet)"
              >
                {{ isBusy(selectedWallet.id) ? "Refreshing…" : "Refresh" }}
              </button>

              <button
                class="mini-btn"
                :disabled="isBusy(selectedWallet.id) || selectedWallet.isPrimary"
                @click="setPrimary(selectedWallet)"
              >
                Set primary
              </button>

              <button
                class="mini-btn"
                :disabled="isBusy(selectedWallet.id)"
                @click="toggleActive(selectedWallet)"
              >
                {{ selectedWallet.isActive ? "Deactivate" : "Activate" }}
              </button>

              <button
                class="mini-btn danger"
                :disabled="isBusy(selectedWallet.id)"
                @click="handleDeleteWallet(selectedWallet)"
              >
                Delete
              </button>
            </div>

            <div v-if="selectedWallet.balances?.length" class="token-breakdown">
              <div
                v-for="balance in selectedWallet.balances"
                :key="balance.id"
                class="token-row"
              >
                <div class="token-left">
                  <span class="token-symbol">{{ displaySymbol(balance) }}</span>
                  <span class="token-balance">
                    {{
                      (balance.balance ?? 0).toLocaleString("en-US", {
                        maximumFractionDigits: 4,
                      })
                    }}
                  </span>
                </div>
                <span class="token-usd">{{ fmtUsd(balance.balanceUsd) }}</span>
              </div>
            </div>

            <div v-else class="empty-balances">
              No balances found for this wallet.
            </div>
          </div>
        </transition>

        <button
          class="add-wallet-btn"
          :disabled="isConnecting"
          @click="openConnectModal"
        >
          <span class="add-icon">+</span>
          {{ isConnecting ? "Opening wallet…" : "Add Stellar Wallet" }}
        </button>

        <p v-if="connectError && !showAddModal" class="inline-error">
          {{ connectError }}
        </p>
        <p v-if="error" class="inline-error">{{ error }}</p>
      </div>
    </div>

    <div class="card card-soon">
      <p class="notif-title">Notifications</p>

      <div class="notif-list">
        <div
          v-for="(notification, index) in notifications"
          :key="index"
          class="notif-row"
        >
          <span class="notif-text">
            <strong>{{ notification.wallet }}</strong> :
            {{ notification.protocol }} ›
          </span>
          <span class="notif-badge" :style="{ color: notification.color }">
            {{ notification.status }}
          </span>
        </div>
      </div>

      <div class="notif-actions">
        <button class="btn-action">Rebalance Wallet 1</button>
        <button class="btn-claim">Claim Wallet 2</button>
        <button class="see-all">See all notifications</button>
      </div>

      <div class="soon-overlay">
        <div class="soon-pill">
          <span class="soon-dot"></span>
          On-chain actions — Coming soon
        </div>
      </div>
    </div>

    <transition name="fade">
      <div
        v-if="showAddModal"
        class="modal-overlay"
        @click.self="closeAddModal"
      >
        <div class="connect-modal">
          <div class="modal-header">
            <span class="modal-title">Add Wallet</span>
            <button class="modal-close" @click="closeAddModal">✕</button>
          </div>

          <div class="sign-address-block">
            <span class="sign-label">Wallet detected</span>
            <span class="sign-address">{{ pendingAddress }}</span>
          </div>

          <div class="sign-address-block">
            <span class="sign-label">Wallet provider</span>
            <span class="sign-address">{{ pendingWalletProviderId || "Unknown" }}</span>
          </div>

          <div class="sign-label-row">
            <span class="sign-label">Label (optional)</span>
            <input
              v-model="newLabel"
              class="sign-label-input"
              :placeholder="`Wallet ${wallets.length + 1}`"
            />
          </div>

          <p class="sign-info">
            This wallet will be attached to your current app profile.
          </p>

          <p v-if="connectError" class="connect-error">{{ connectError }}</p>

          <div class="modal-actions">
            <button
              class="btn-confirm"
              :disabled="addLoading"
              @click="addWalletWithoutSignature"
            >
              {{ addLoading ? "Adding wallet…" : "Add Wallet" }}
            </button>
            <button class="btn-cancel" @click="closeAddModal">Cancel</button>
          </div>
        </div>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.wallet-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
@media (max-width: 640px) {
  .wallet-grid {
    grid-template-columns: 1fr;
  }
}

.card {
  background: #181818;
  border: 1px solid #2a2a2a;
  border-radius: 12px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.card-soon {
  position: relative;
  overflow: hidden;
}

.balance-label {
  font-size: 12px;
  color: #9a9b99;
}
.balance-total {
  font-size: 2rem;
  font-weight: 700;
  color: #fff;
  line-height: 1.1;
  letter-spacing: -0.03em;
}
.balance-sub {
  font-size: 12px;
  color: #9a9b99;
}

.wallet-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.wallet-row {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: 10px;
  background: #202020;
  border: 1px solid #2a2a2a;
  border-radius: 8px;
  padding: 10px 12px;
  cursor: pointer;
  transition: border-color 0.15s;
}
.wallet-row:hover {
  border-color: rgba(213, 255, 47, 0.3);
}
.wallet-row.active {
  border-color: #d5ff2f;
  background: #1a1f0e;
}

.wallet-main {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.wallet-topline {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.wallet-num {
  font-size: 12px;
  font-weight: 700;
  color: #e2e6e1;
  white-space: nowrap;
}
.wallet-addr {
  font-size: 11px;
  color: #9a9b99;
  font-family: "DM Mono", monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.wallet-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.wallet-amount {
  font-size: 12px;
  color: #d5ff2f;
  font-weight: 600;
  white-space: nowrap;
}

.pill {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 2px 8px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
}
.pill.primary {
  color: #d5ff2f;
  background: rgba(213, 255, 47, 0.08);
  border: 1px solid rgba(213, 255, 47, 0.3);
}
.pill.inactive {
  color: #ffb86b;
  background: rgba(255, 184, 107, 0.08);
  border: 1px solid rgba(255, 184, 107, 0.3);
}

.btn-sel,
.mini-btn {
  font-size: 11px;
  color: #d5ff2f;
  border: 1px solid rgba(213, 255, 47, 0.3);
  background: transparent;
  border-radius: 5px;
  padding: 4px 8px;
  cursor: pointer;
  transition: background 0.15s;
}
.btn-sel:hover,
.mini-btn:hover:not(:disabled) {
  background: rgba(213, 255, 47, 0.1);
}
.mini-btn:disabled,
.btn-sel:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.mini-btn.danger {
  color: #ff7b7b;
  border-color: rgba(255, 123, 123, 0.35);
}
.mini-btn.danger:hover:not(:disabled) {
  background: rgba(255, 123, 123, 0.1);
}

.wallet-detail-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.wallet-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.token-breakdown {
  background: #161616;
  border: 1px solid #2a2a2a;
  border-radius: 8px;
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.token-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 0;
  border-bottom: 1px solid #222;
  font-size: 12px;
}
.token-row:last-child {
  border-bottom: none;
}
.token-left {
  display: flex;
  align-items: center;
  gap: 8px;
}
.token-symbol {
  font-weight: 700;
  color: #e2e6e1;
}
.token-balance {
  color: #9a9b99;
}
.token-usd {
  color: #d5ff2f;
  font-weight: 600;
}

.empty-balances {
  font-size: 12px;
  color: #9a9b99;
  background: #161616;
  border: 1px solid #2a2a2a;
  border-radius: 8px;
  padding: 12px;
}

.add-wallet-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  background: transparent;
  border: 1px dashed rgba(213, 255, 47, 0.3);
  border-radius: 8px;
  padding: 10px 14px;
  color: #d5ff2f;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  letter-spacing: 0.04em;
  transition: border-color 0.15s, background 0.15s;
  font-family: "DM Mono", monospace;
}
.add-wallet-btn:hover:not(:disabled) {
  border-color: #d5ff2f;
  background: rgba(213, 255, 47, 0.05);
}
.add-wallet-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.add-icon {
  width: 18px;
  height: 18px;
  background: rgba(213, 255, 47, 0.12);
  border: 1px solid rgba(213, 255, 47, 0.3);
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  line-height: 1;
  flex-shrink: 0;
}

.inline-error {
  font-size: 11px;
  color: #ff5a5a;
  text-align: center;
}

.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: rgba(0, 0, 0, 0.65);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}
.connect-modal {
  background: #181818;
  border: 1px solid #333;
  border-radius: 16px;
  padding: 20px;
  width: 100%;
  max-width: 380px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.6);
}
.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.modal-title {
  font-size: 15px;
  font-weight: 700;
  color: #e2e6e1;
  flex: 1;
  text-align: center;
}
.modal-close {
  font-size: 13px;
  color: #5e5f5d;
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px;
  transition: color 0.15s;
}
.modal-close:hover {
  color: #e2e6e1;
}

.sign-address-block {
  background: #141414;
  border: 1px solid #2a2a2a;
  border-radius: 8px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.sign-label {
  font-size: 10px;
  color: #5e5f5d;
  text-transform: uppercase;
  letter-spacing: 0.1em;
}
.sign-address {
  font-size: 11px;
  color: #d5ff2f;
  font-family: "DM Mono", monospace;
  word-break: break-all;
}
.sign-label-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.sign-label-input {
  background: #141414;
  border: 1px solid #3a3a3a;
  border-radius: 6px;
  padding: 7px 10px;
  font-size: 12px;
  color: #e2e6e1;
  font-family: "DM Mono", monospace;
  outline: none;
  width: 100%;
  transition: border-color 0.15s;
}
.sign-label-input:focus {
  border-color: #d5ff2f;
}
.sign-label-input::placeholder {
  color: #5e5f5d;
}
.sign-info {
  font-size: 11px;
  color: #5e5f5d;
  line-height: 1.5;
  background: rgba(213, 255, 47, 0.04);
  border: 1px solid rgba(213, 255, 47, 0.1);
  border-radius: 6px;
  padding: 8px 10px;
}
.connect-error {
  font-size: 11px;
  color: #ff5a5a;
  text-align: center;
}

.modal-actions {
  display: flex;
  gap: 8px;
}
.btn-confirm {
  font-size: 11px;
  font-weight: 700;
  color: #d5ff2f;
  background: #373b26;
  border: 1px solid #d5ff2f;
  border-radius: 6px;
  padding: 8px 14px;
  cursor: pointer;
  flex: 1;
  transition: background 0.15s;
}
.btn-confirm:hover:not(:disabled) {
  background: rgba(213, 255, 47, 0.2);
}
.btn-confirm:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.btn-cancel {
  font-size: 11px;
  color: #9a9b99;
  background: transparent;
  border: 1px solid #3a3a3a;
  border-radius: 6px;
  padding: 8px 14px;
  cursor: pointer;
}
.btn-cancel:hover {
  border-color: #5e5f5d;
  color: #e2e6e1;
}

.notif-title {
  font-size: 12px;
  color: #9a9b99;
}
.notif-list {
  display: flex;
  flex-direction: column;
}
.notif-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 9px 0;
  border-bottom: 1px solid #2a2a2a;
}
.notif-text {
  font-size: 12px;
  color: #9a9b99;
}
.notif-text strong {
  color: #e2e6e1;
}
.notif-badge {
  font-size: 12px;
  font-weight: 700;
}
.notif-actions {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 4px;
}
.btn-action {
  font-size: 12px;
  font-weight: 700;
  color: #d5ff2f;
  background: #373b26;
  border: 1px solid #d5ff2f;
  border-radius: 6px;
  padding: 7px 14px;
  cursor: pointer;
  width: fit-content;
  letter-spacing: 0.05em;
}
.btn-claim {
  font-size: 12px;
  font-weight: 700;
  color: #fff;
  background: #222;
  border: 1px solid #3a3a3a;
  border-radius: 6px;
  padding: 7px 14px;
  cursor: pointer;
  width: fit-content;
}
.see-all {
  font-size: 12px;
  color: #d5ff2f;
  background: none;
  border: none;
  cursor: pointer;
  text-align: left;
}

.soon-overlay {
  position: absolute;
  inset: 0;
  background: rgba(14, 14, 14, 0.35);
  backdrop-filter: blur(1.5px);
  -webkit-backdrop-filter: blur(1.5px);
  border-radius: 15px;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}
.soon-pill {
  display: flex;
  align-items: center;
  gap: 8px;
  background: #1a1a1a;
  border: 1px solid #3a3a3a;
  border-radius: 999px;
  padding: 8px 18px;
  font-size: 15px;
  font-weight: 600;
  color: #9a9b99;
  letter-spacing: 0.06em;
  user-select: none;
}
.soon-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #d5ff2f;
  flex-shrink: 0;
  animation: pulse 2s ease-in-out infinite;
}
@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.3;
  }
}

.slide-enter-active,
.slide-leave-active {
  transition: all 0.2s ease;
}
.slide-enter-from,
.slide-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>