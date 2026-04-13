<!-- src/components/DashboardHeader.vue -->
<script setup lang="ts">
import { computed, onMounted } from "vue";
import { connectWallet as connectWalletApi } from "../api/wallets";
import { useAppUser } from "../composables/useAppUser";
import { useWalletSession } from "../composables/useWalletSession";

defineProps<{
  stats: { title: string; value: string; change?: string }[];
}>();

const { userId, setUserId, restoreUser, clearUser } = useAppUser();

const {
  connectedAddress,
  shortConnectedAddress,
  isConnecting,
  connectWallet,
  disconnectWallet: disconnectWalletSession,
  restoreWalletSession,
} = useWalletSession();

const resolvedUser = computed(() => !!userId.value);

async function openWalletModal() {
  try {
    const sessionResult = await connectWallet();
    console.log("[header] sessionResult", sessionResult);

    if (!sessionResult?.address) {
      throw new Error("No wallet address returned.");
    }

    const connectResponse = await connectWalletApi({
      chain: "stellar",
      address: sessionResult.address,
      label: "",
    });

    console.log("[header] connectResponse", connectResponse);

    const backendUserId = connectResponse?.userId?.trim();

    if (!backendUserId) {
      throw new Error("Backend did not return userId.");
    }

    window.localStorage.setItem("dig_stellar_user_id", backendUserId);
    setUserId(backendUserId);

    console.log("[header] user linked", {
      backendUserId,
      storedUserId: window.localStorage.getItem("dig_stellar_user_id"),
    });
  } catch (error) {
    console.error("[header] Wallet connection cancelled or failed", error);
  }
}

function disconnectWallet() {
  disconnectWalletSession();
  clearUser();
  window.localStorage.removeItem("dig_stellar_user_id");
}

function getStatChangeClass(change?: string) {
  if (!change) return "";

  const normalized = change.trim().toLowerCase();

  if (
    normalized.startsWith("▼") ||
    normalized.startsWith("-") ||
    normalized === "decrease"
  ) {
    return "down";
  }

  if (
    normalized.startsWith("▲") ||
    normalized.startsWith("+") ||
    normalized === "increase"
  ) {
    return "up";
  }

  return "neutral";
}

onMounted(() => {
  restoreWalletSession();
  restoreUser();

  console.log("[header] mounted", {
    connectedAddress: connectedAddress.value,
    userId: userId.value,
    storedUserId: window.localStorage.getItem("dig_stellar_user_id"),
  });
});
</script>

<template>
  <div class="header-wrap">
    <div class="topbar">
      <div class="logo-group">
        <div class="logo-circle">
          <img src="../assets/stellar.svg" alt="Stellar" width="48" height="48" />
        </div>
        <div class="title-row">
          <h1>Dig Stellar</h1>
          <span class="badge-beta">ALPHA</span>
        </div>
      </div>

      <div class="right-block">
        <button
          v-if="!connectedAddress"
          class="wallet-connect-btn"
          :disabled="isConnecting"
          @click="openWalletModal"
        >
          <span class="wallet-dot" />
          {{ isConnecting ? "Connecting…" : "Connect Wallet" }}
        </button>

        <div
          v-else
          class="wallet-connected"
          title="Click to disconnect"
          @click="disconnectWallet"
        >
          <span class="wallet-dot wallet-dot--active" />
          <span class="wallet-addr">{{ shortConnectedAddress }}</span>
          <span class="wallet-network">
            {{ resolvedUser ? "Linked" : "Session only" }}
          </span>
        </div>

        <div class="desc-block">
          <div class="links-row">
            <a
              href="https://github.com/Mael-wnb/dig-stellar"
              target="_blank"
              class="link-pill"
            >
              GitHub ↗
            </a>
            <a
              href="https://communityfund.stellar.org/submissions/recoebnaQgCsMeEjm"
              target="_blank"
              class="link-pill"
            >
              Grant submission ↗
            </a>
          </div>
        </div>
      </div>
    </div>

    <div class="stats-grid">
      <div v-for="stat in stats" :key="stat.title" class="stat-card">
        <div class="stat-label">{{ stat.title }}</div>
        <div class="stat-value">{{ stat.value }}</div>
        <div
          v-if="stat.change"
          class="stat-change"
          :class="getStatChangeClass(stat.change)"
        >
          {{ stat.change }}
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.header-wrap { display: flex; flex-direction: column; gap: 14px; }

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.logo-group { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }

.logo-circle {
  width: 56px; height: 56px;
  border-radius: 50%;
  background: #373B26;
  border: 1px solid #D5FF2F;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
  overflow: hidden;
}

.title-row { display: flex; align-items: center; gap: 8px; }

h1 {
  font-size: 1.35rem;
  font-weight: 700;
  color: #fff;
  letter-spacing: -0.02em;
  margin: 0;
}

.badge-beta {
  font-size: 9px;
  font-weight: 700;
  color: #D5FF2F;
  background: #373B26;
  border: 1px solid #D5FF2F;
  border-radius: 4px;
  padding: 2px 6px;
  letter-spacing: 0.1em;
}

.right-block {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 10px;
}

.desc-block {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
  max-width: 380px;
}

.links-row { display: flex; gap: 6px; }

.link-pill {
  font-size: 11px;
  font-weight: 600;
  color: #D5FF2F;
  background: #373B26;
  border: 1px solid rgba(213,255,47,0.3);
  border-radius: 4px;
  padding: 3px 10px;
  text-decoration: none;
  letter-spacing: 0.05em;
  transition: background 0.15s;
}
.link-pill:hover { background: rgba(213,255,47,0.15); }

.wallet-connect-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border-radius: 8px;
  border: 1px solid #D5FF2F;
  background: transparent;
  color: #D5FF2F;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
  cursor: pointer;
  transition: background 0.15s;
  white-space: nowrap;
  font-family: 'DM Mono', monospace;
}
.wallet-connect-btn:hover:not(:disabled) { background: rgba(213,255,47,0.08); }
.wallet-connect-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.wallet-connected {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 14px;
  border-radius: 8px;
  border: 1px solid rgba(213,255,47,0.3);
  background: #1a1f0e;
  cursor: pointer;
  transition: border-color 0.15s;
}
.wallet-connected:hover { border-color: rgba(255,90,90,0.5); }

.wallet-dot {
  width: 7px; height: 7px;
  border-radius: 50%;
  background: #9A9B99;
  flex-shrink: 0;
}
.wallet-dot--active {
  background: #D5FF2F;
  animation: wpulse 2s infinite;
}
@keyframes wpulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

.wallet-addr {
  font-size: 12px;
  font-weight: 700;
  color: #D5FF2F;
  letter-spacing: 0.04em;
  font-family: 'DM Mono', monospace;
}
.wallet-network { font-size: 10px; color: #9A9B99; letter-spacing: 0.06em; }

.stats-grid {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 6px;
}
@media (max-width: 900px) {
  .stats-grid { grid-template-columns: repeat(4, 1fr); }
  .desc-block { display: none; }
}
@media (max-width: 500px) { .stats-grid { grid-template-columns: repeat(2, 1fr); } }

.stat-card {
  background: #181818;
  border: 1px solid #2a2a2a;
  border-radius: 10px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  justify-content: flex-start;
}

.stat-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #9A9B99;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.stat-value {
  font-size: 15px;
  font-weight: 700;
  color: #fff;
  font-variant-numeric: tabular-nums;
}

.stat-change {
  font-size: 11px;
  font-weight: 500;
}

.stat-change.up {
  color: #D5FF2F;
}

.stat-change.down {
  color: #FF5A5A;
}

.stat-change.neutral {
  color: #9A9B99;
}
</style>