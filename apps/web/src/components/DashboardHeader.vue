<!-- src/components/DashboardHeader.vue -->
<script setup lang="ts">
import { ref, computed } from 'vue'
import {
  StellarWalletsKit,
  WalletNetwork,
  allowAllModules,
  XBULL_ID,
} from '@creit.tech/stellar-wallets-kit'

defineProps<{
  stats: { title: string; value: string; change?: string }[]
}>()

// ── Wallet Kit ───────────────────────────────────────────────────────────────
const connectedAddress = ref<string | null>(null)
const isConnecting = ref(false)

const kit = new StellarWalletsKit({
  network: WalletNetwork.PUBLIC,
  selectedWalletId: XBULL_ID,
  modules: allowAllModules(),
})

async function openWalletModal() {
  isConnecting.value = true
  try {
    await kit.openModal({
      onWalletSelected: async (option) => {
        kit.setWallet(option.id)
        const { address } = await kit.getAddress()
        connectedAddress.value = address
      },
    })
  } catch (e) {
    console.error('Wallet connection cancelled or failed', e)
  } finally {
    isConnecting.value = false
  }
}

function disconnectWallet() {
  connectedAddress.value = null
}

const shortAddress = computed(() => {
  if (!connectedAddress.value) return null
  return `${connectedAddress.value.slice(0, 6)}…${connectedAddress.value.slice(-4)}`
})
</script>

<template>
  <div class="header-wrap">

    <!-- Top bar -->
    <div class="topbar">
      <div class="logo-group">
        <div class="logo-circle">
          <img src="../assets/stellar.svg" alt="Stellar" width="48" height="48" />
        </div>
        <div class="title-row">
          <h1>Stellar Grant by Dig</h1>
          <span class="badge-beta">BETA</span>
        </div>
      </div>

      <div class="right-block">
        <!-- Connect Wallet -->
        <button
          v-if="!connectedAddress"
          class="wallet-connect-btn"
          :disabled="isConnecting"
          @click="openWalletModal"
        >
          <span class="wallet-dot" />
          {{ isConnecting ? 'Connecting…' : 'Connect Wallet' }}
        </button>

        <div v-else class="wallet-connected" title="Click to disconnect" @click="disconnectWallet">
          <span class="wallet-dot wallet-dot--active" />
          <span class="wallet-addr">{{ shortAddress }}</span>
          <span class="wallet-network">Mainnet</span>
        </div>

        <div class="desc-block">
          <p class="desc">
            Dig is applying for a Stellar Community Fund grant to build the go-to analytics &amp;
            portfolio dashboard for Stellar DeFi — real-time TVL, multi-wallet tracking, on-chain
            actions, protocol notifications, inflow/outflow monitoring, and Stellar market cap
            tracking across Soroban protocols. This is an early demo.
          </p>
          <div class="links-row">
            <a href="https://github.com/Mael-wnb/dig-stellar" target="_blank" class="link-pill">GitHub ↗</a>
            <a href="https://communityfund.stellar.org/submissions/recoebnaQgCsMeEjm" target="_blank" class="link-pill">Grant submission ↗</a>
          </div>
        </div>
      </div>
    </div>

    <!-- Stats grid -->
    <div class="stats-grid">
      <div v-for="stat in stats" :key="stat.title" class="stat-card">
        <div class="stat-label">{{ stat.title }}</div>
        <div class="stat-value">{{ stat.value }}</div>
        <div
          v-if="stat.change"
          class="stat-change"
          :class="{ down: stat.change.startsWith('▼') || stat.change.startsWith('-') }"
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

/* Right side: desc + wallet */
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

.desc {
  font-size: 11px;
  color: #9A9B99;
  text-align: right;
  line-height: 1.6;
  margin: 0;
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

/* Connect Wallet */
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
  50%       { opacity: 0.4; }
}

.wallet-addr {
  font-size: 12px;
  font-weight: 700;
  color: #D5FF2F;
  letter-spacing: 0.04em;
  font-family: 'DM Mono', monospace;
}
.wallet-network { font-size: 10px; color: #9A9B99; letter-spacing: 0.06em; }

/* Stats */
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

.stat-change { font-size: 11px; color: #D5FF2F; font-weight: 500; }
.stat-change.down { color: #FF5A5A; }
</style>