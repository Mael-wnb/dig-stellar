<script setup>
import { ref } from 'vue'

defineProps({
  wallets:       { type: Array,  required: true },
  notifications: { type: Array,  required: true },
  totalBalance:  { type: String, default: '$14,523.89' },
})

const selectedWallet = ref(null)
</script>

<template>
  <div class="wallet-grid">

    <!-- LEFT: balances + wallet list -->
    <div class="card">
      <div class="balance-block">
        <p class="balance-label">Multi-Wallet Amount</p>
        <p class="balance-total">{{ totalBalance }}</p>
        <p v-if="selectedWallet" class="balance-sub">
          Wallet {{ selectedWallet.id }} — {{ selectedWallet.amount }}
        </p>
      </div>

      <div class="wallet-list">
        <div
          v-for="w in wallets"
          :key="w.id"
          class="wallet-row"
          :class="{ active: selectedWallet?.id === w.id }"
          @click="selectedWallet = w"
        >
          <span class="wallet-num">Wallet {{ w.id }}</span>
          <span class="wallet-addr">{{ w.address }}</span>
          <div class="wallet-right">
            <span class="wallet-amount">{{ w.amount }}</span>
            <button class="btn-sel" @click.stop="selectedWallet = w">Select ›</button>
          </div>
        </div>

        <button class="add-wallet-btn">
          <span class="add-icon">+</span>
          Add Stellar Wallet
        </button>
      </div>
    </div>

    <!-- RIGHT: notifications + soon overlay -->
    <div class="card card-soon">

      <p class="notif-title">Notifications</p>

      <div class="notif-list">
        <div v-for="(n, i) in notifications" :key="i" class="notif-row">
          <span class="notif-text">
            <strong>{{ n.wallet }}</strong> : {{ n.protocol }} ›
          </span>
          <span class="notif-badge" :style="{ color: n.color }">{{ n.status }}</span>
        </div>
      </div>

      <div class="notif-actions">
        <button class="btn-action">Rebalance Wallet 1</button>
        <button class="btn-claim">Claim Wallet 2</button>
        <button class="see-all">See all notifications</button>
      </div>

      <!-- Voile soon -->
      <div class="soon-overlay">
        <div class="soon-pill">
          <span class="soon-dot"></span>
          On-chain actions — Coming soon
        </div>
      </div>

    </div>

  </div>
</template>

<style scoped>
.wallet-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
@media (max-width: 640px) { .wallet-grid { grid-template-columns: 1fr; } }

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
  color: #9A9B99;
  letter-spacing: 0.06em;
  user-select: none;
}

.soon-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #D5FF2F;
  flex-shrink: 0;
  animation: pulse 2s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.3; }
}

.balance-label { font-size: 12px; color: #9A9B99; }
.balance-total { font-size: 2rem; font-weight: 700; color: #fff; line-height: 1.1; letter-spacing: -0.03em; }
.balance-sub   { font-size: 12px; color: #9A9B99; }

.wallet-list { display: flex; flex-direction: column; gap: 6px; }

.wallet-row {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 10px;
  background: #202020;
  border: 1px solid #2a2a2a;
  border-radius: 8px;
  padding: 10px 12px;
  cursor: pointer;
  transition: border-color 0.15s;
}
.wallet-row:hover { border-color: rgba(213,255,47,0.3); }
.wallet-row.active { border-color: #D5FF2F; background: #1a1f0e; }

.wallet-num { font-size: 12px; font-weight: 700; color: #E2E6E1; white-space: nowrap; }

.wallet-addr {
  font-size: 12px;
  color: #9A9B99;
  font-family: 'DM Mono', monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.wallet-right { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.wallet-amount { font-size: 12px; color: #D5FF2F; font-weight: 600; white-space: nowrap; }

.btn-sel {
  font-size: 11px;
  color: #D5FF2F;
  border: 1px solid rgba(213,255,47,0.3);
  background: transparent;
  border-radius: 5px;
  padding: 3px 8px;
  cursor: pointer;
  transition: background 0.15s;
}
.btn-sel:hover { background: rgba(213,255,47,0.1); }

/* Add wallet CTA */
.add-wallet-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  background: transparent;
  border: 1px dashed rgba(213,255,47,0.3);
  border-radius: 8px;
  padding: 10px 14px;
  color: #D5FF2F;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  letter-spacing: 0.04em;
  transition: border-color 0.15s, background 0.15s;
  font-family: 'DM Mono', monospace;
}
.add-wallet-btn:hover {
  border-color: #D5FF2F;
  background: rgba(213,255,47,0.05);
}

.add-icon {
  width: 18px; height: 18px;
  background: rgba(213,255,47,0.12);
  border: 1px solid rgba(213,255,47,0.3);
  border-radius: 4px;
  display: flex; align-items: center; justify-content: center;
  font-size: 14px;
  line-height: 1;
  flex-shrink: 0;
}

/* Notifications */
.notif-title { font-size: 12px; color: #9A9B99; }

.notif-list { display: flex; flex-direction: column; }
.notif-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 9px 0;
  border-bottom: 1px solid #2a2a2a;
}
.notif-text { font-size: 12px; color: #9A9B99; }
.notif-text strong { color: #E2E6E1; }
.notif-badge { font-size: 12px; font-weight: 700; }

.notif-actions { display: flex; flex-direction: column; gap: 6px; margin-top: 4px; }

.btn-action {
  font-size: 12px; font-weight: 700; color: #D5FF2F;
  background: #373B26; border: 1px solid #D5FF2F;
  border-radius: 6px; padding: 7px 14px; cursor: pointer;
  width: fit-content; letter-spacing: 0.05em;
}
.btn-claim {
  font-size: 12px; font-weight: 700; color: #fff;
  background: #222; border: 1px solid #3a3a3a;
  border-radius: 6px; padding: 7px 14px; cursor: pointer; width: fit-content;
}
.see-all {
  font-size: 12px; color: #D5FF2F;
  background: none; border: none; cursor: pointer; text-align: left;
}
</style>