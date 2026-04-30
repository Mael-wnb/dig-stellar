<script setup lang="ts">
import { computed, onMounted } from "vue";
import { connectWallet as connectWalletApi } from "../api/wallets";
import { useAppUser } from "../composables/useAppUser";
import { useWalletSession } from "../composables/useWalletSession";

import digLogotype from "../assets/icons/dig-logotype.svg";
import stellarBadge from "../assets/icons/stellar-badge.svg";
import iconWallet from "../assets/icons/icon-wallet.svg";

const { setUserId, restoreUser, clearUser } = useAppUser();

const {
  connectedAddress,
  shortConnectedAddress,
  isConnecting,
  connectWallet,
  disconnectWallet: disconnectWalletSession,
  restoreWalletSession,
} = useWalletSession();

const walletLabel = computed(() => {
  if (isConnecting.value) return "Connecting…";
  if (connectedAddress.value) return shortConnectedAddress.value;
  return "Connect wallet";
});

async function openWalletModal() {
  if (connectedAddress.value) {
    disconnectWallet();
    return;
  }

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

    const backendUserId = connectResponse?.userId?.trim();

    if (!backendUserId) {
      throw new Error("Backend did not return userId.");
    }

    window.localStorage.setItem("dig_stellar_user_id", backendUserId);
    setUserId(backendUserId);
  } catch (error) {
    console.error("[header] Wallet connection failed", error);
  }
}

function disconnectWallet() {
  disconnectWalletSession();
  clearUser();
  window.localStorage.removeItem("dig_stellar_user_id");
}

onMounted(() => {
  restoreWalletSession();
  restoreUser();
});
</script>

<template>
  <header class="header">
    <!-- LEFT: Logo + chain selector -->
    <div class="header-left">
      <img :src="digLogotype" alt="DIG" class="logotype" />

      <div class="chain-selectors">
        <div class="chain-item">
          <span class="chain-label">x</span>
        </div>
        <div class="chain-item chain-item-stellar">
          <img :src="stellarBadge" alt="" class="chain-badge" />
          <span class="chain-label chain-label-active">Stellar </span>
        </div>
      </div>
    </div>

    <!-- RIGHT: Links + wallet -->
    <div class="header-right">
      <a
        href="https://github.com/Mael-wnb/dig-stellar"
        target="_blank"
        class="header-link"
      >
        GitHub ↗
      </a>

      <a
        href="https://communityfund.stellar.org/submissions/recJYN4fvS3EaRjp7?fbclid=IwY2xjawRgA0NleHRuA2FlbQIxMQBzcnRjBmFwcF9pZAEwAAEeznPTB0FwHVjiNAyREUO5Y03DKrJno27X1vfo6AZaydpyegrPd2ll4KTGL6Y_aem_xbCicjCQO-VX3ay8iZnH6g"
        target="_blank"
        class="header-link"
      >
        Grant ↗
      </a>

      <div class="action-separator" />

      <button
        class="wallet-btn"
        :class="{ 'wallet-btn--connected': connectedAddress }"
        :disabled="isConnecting"
        @click="openWalletModal"
      >
        <img :src="iconWallet" alt="" class="wallet-icon" />
        <span class="wallet-label">{{ walletLabel }}</span>
      </button>
    </div>
  </header>
</template>

<style scoped>
.header {
  display: flex;
  align-items: stretch;
  justify-content: space-between;
  height: 60px;
  padding: 5px 197px;
  border-bottom: 1px solid #4b4c4b;
  background: #252525;
}

@media (max-width: 1440px) {
  .header {
    padding: 5px 48px;
  }
}

@media (max-width: 768px) {
  .header {
    padding: 5px 16px;
  }
}

/* ── LEFT ── */
.header-left {
  display: flex;
  align-items: center;
  align-self: stretch;
}

.logotype {
  height: 17px;
  width: auto;
}

.chain-selectors {
  display: flex;
  align-items: stretch;
  align-self: stretch;
}

.chain-item {
  display: flex;
  align-items: center;
  align-self: stretch;
  padding: 0 10px;
}

.chain-item-stellar {
  gap: 5px;
  padding: 0 10px 0 0;
}

.chain-badge {
  width: 14px;
  height: 14px;
}

.chain-label {
  font-family: "Space Mono", monospace;
  font-weight: 700;
  font-size: 12px;
  color: #838583;
  text-align: center;
  user-select: none;
}

.chain-label-active {
  color: #d5ff2f;
}

/* ── RIGHT ── */
.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.header-link {
  font-family: "Space Mono", monospace;
  font-weight: 700;
  font-size: 12px;
  color: #d5ff2f;
  background: #373b26;
  border: 1px solid rgba(213, 255, 47, 0.3);
  padding: 4px 12px;
  border-radius: 4px;
  text-decoration: none;
  white-space: nowrap;
  transition:
    background 0.15s,
    border-color 0.15s;
}

.header-link:hover {
  background: rgba(213, 255, 47, 0.15);
  border-color: #d5ff2f;
}

.action-separator {
  width: 1px;
  align-self: stretch;
  background: #4b4c4b;
}

/* ── Wallet button (prominent) ── */
.wallet-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 18px;
  height: 31px;
  background: rgba(213, 255, 47, 0.08);
  border: 1px solid #d5ff2f;
  border-radius: 4px;
  cursor: pointer;
  transition:
    background 0.15s,
    border-color 0.15s;
}

.wallet-btn:hover {
  background: rgba(213, 255, 47, 0.16);
}

.wallet-btn:disabled {
  opacity: 0.5;
  cursor: wait;
}

.wallet-btn--connected {
  border-color: rgba(213, 255, 47, 0.4);
  background: rgba(213, 255, 47, 0.06);
}

.wallet-icon {
  width: 18px;
  height: 18px;
  filter: brightness(0) saturate(100%) invert(91%) sepia(30%) saturate(1000%)
    hue-rotate(25deg) brightness(105%);
}

.wallet-label {
  font-family: "Space Mono", monospace;
  font-weight: 700;
  font-size: 12px;
  color: #d5ff2f;
  white-space: nowrap;
}

@media (max-width: 640px) {
  .header-link {
    display: none;
  }
  .action-separator {
    display: none;
  }
  .wallet-btn {
    padding: 0 12px;
  }
}
</style>
