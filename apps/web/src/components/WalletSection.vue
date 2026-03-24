<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import {
  StellarWalletsKit,
  WalletNetwork,
  allowAllModules,
  XBULL_ID,
} from '@creit.tech/stellar-wallets-kit'

// ─── TYPES ───────────────────────────────────────────────────────────────────

interface WalletBalance {
  id: string
  symbol: string
  balance: number
  priceUsd: number
  balanceUsd: number
  assetContractId: string
  metadata: {
    assetCode: string | null
    assetType: string
  }
}

interface Wallet {
  id: string
  address: string
  label: string
  isPrimary: boolean
  isActive: boolean
  chain: string
  totalPortfolioUsd?: number
  balances?: WalletBalance[]
  loading?: boolean
}

interface Notification {
  wallet: string
  protocol: string
  status: string
  color: string
}

// ─── PROPS ───────────────────────────────────────────────────────────────────

defineProps<{
  notifications: Notification[]
}>()

// ─── CONFIG ──────────────────────────────────────────────────────────────────

const USER_ID  = '11111111-1111-4111-8111-111111111111'
const BASE_URL = 'http://localhost:3000/v1'

// ─── WALLET KIT ──────────────────────────────────────────────────────────────

const kit = new StellarWalletsKit({
  network: WalletNetwork.PUBLIC,
  selectedWalletId: XBULL_ID,
  modules: allowAllModules(),
})

// ─── STATE ───────────────────────────────────────────────────────────────────

const wallets         = ref<Wallet[]>([])
const selectedWallet  = ref<Wallet | null>(null)
const overviewLoading = ref(true)

// Connect flow
const isConnecting   = ref(false)
const connectError   = ref('')
const showSignModal  = ref(false)
const pendingAddress = ref('')
const newLabel       = ref('')
const signLoading    = ref(false)

// ─── COMPUTED ────────────────────────────────────────────────────────────────

const totalPortfolioUsd = computed(() =>
  wallets.value.reduce((sum, w) => sum + (w.totalPortfolioUsd ?? 0), 0)
)

const pendingSignMessage = computed(() =>
  `I confirm that I own this Stellar wallet:\n${pendingAddress.value}\n\nTimestamp: ${Date.now()}`
)

const fmtUsd = (n: number) =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const shortAddr = (addr: string) =>
  addr.length > 14 ? `${addr.slice(0, 6)}…${addr.slice(-6)}` : addr

// ─── API ─────────────────────────────────────────────────────────────────────

async function fetchOverview() {
  overviewLoading.value = true
  try {
    const res  = await fetch(`${BASE_URL}/wallets/overview?userId=${USER_ID}`)
    const data = await res.json()
    wallets.value = (data.wallets ?? []).map((w: Wallet) => ({ ...w, loading: false }))
    await Promise.all(wallets.value.map(w => fetchWalletBalances(w.id)))
  } catch (e) {
    console.error('Failed to fetch overview', e)
  } finally {
    overviewLoading.value = false
  }
}

async function fetchWalletBalances(walletId: string) {
  const w = wallets.value.find(w => w.id === walletId)
  if (!w) return
  w.loading = true
  try {
    const res  = await fetch(`${BASE_URL}/wallets/${walletId}/balances?userId=${USER_ID}`)
    const data = await res.json()
    w.totalPortfolioUsd = data.totalPortfolioUsd ?? 0
    w.balances = data.balances ?? []
  } catch (e) {
    console.error(`Failed to fetch balances for ${walletId}`, e)
  } finally {
    w.loading = false
  }
}

async function submitWallet(address: string, signature: string) {
  const res = await fetch(`${BASE_URL}/wallets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId:    USER_ID,
      chain:     'stellar',
      address,
      label:     newLabel.value.trim() || `Wallet ${wallets.value.length + 1}`,
      signature,
    }),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

// ─── CONNECT WALLET FLOW ─────────────────────────────────────────────────────

async function openConnectModal() {
  connectError.value = ''
  isConnecting.value = true
  try {
    await kit.openModal({
      onWalletSelected: async (option) => {
        kit.setWallet(option.id)
        const { address } = await kit.getAddress()

        if (!address || !/^G[A-Z2-7]{55}$/.test(address))
          throw new Error('Invalid Stellar address returned by wallet.')
        if (wallets.value.find(w => w.address === address))
          throw new Error('This wallet is already added.')

        pendingAddress.value = address
        newLabel.value       = ''
        showSignModal.value  = true
      },
    })
  } catch (e: unknown) {
    connectError.value = e instanceof Error ? e.message : 'Connection failed or cancelled.'
  } finally {
    isConnecting.value = false
  }
}

async function signAndAdd() {
  if (!pendingAddress.value) return
  signLoading.value  = true
  connectError.value = ''
  try {
    const { signedMessage } = await (kit as any).signMessage({
      message:   pendingSignMessage.value,
      publicKey: pendingAddress.value,
    })

    const data = await submitWallet(pendingAddress.value, signedMessage ?? '')
    wallets.value.push({ ...data, loading: false })
    await fetchWalletBalances(data.id)
    closeSignModal()
  } catch (e: unknown) {
    connectError.value = e instanceof Error ? e.message : 'Signature failed.'
  } finally {
    signLoading.value = false
  }
}

function closeSignModal() {
  showSignModal.value  = false
  pendingAddress.value = ''
  newLabel.value       = ''
  connectError.value   = ''
}

function selectWallet(w: Wallet) {
  selectedWallet.value = selectedWallet.value?.id === w.id ? null : w
}

// ─── INIT ────────────────────────────────────────────────────────────────────

onMounted(fetchOverview)
</script>

<template>
  <div class="wallet-grid">

    <!-- LEFT: balances + wallet list -->
    <div class="card">

      <div class="balance-block">
        <p class="balance-label">Multi-Wallet Amount</p>
        <p v-if="overviewLoading" class="balance-total">—</p>
        <p v-else class="balance-total">{{ fmtUsd(totalPortfolioUsd) }}</p>
        <p v-if="selectedWallet" class="balance-sub">
          {{ selectedWallet.label }} — {{ fmtUsd(selectedWallet.totalPortfolioUsd ?? 0) }}
        </p>
      </div>

      <div class="wallet-list">
        <div
          v-for="w in wallets"
          :key="w.id"
          class="wallet-row"
          :class="{ active: selectedWallet?.id === w.id }"
          @click="selectWallet(w)"
        >
          <span class="wallet-num">{{ w.label }}</span>
          <span class="wallet-addr">{{ shortAddr(w.address) }}</span>
          <div class="wallet-right">
            <span v-if="w.loading" class="wallet-amount">…</span>
            <span v-else class="wallet-amount">{{ fmtUsd(w.totalPortfolioUsd ?? 0) }}</span>
            <button class="btn-sel" @click.stop="selectWallet(w)">Select ›</button>
          </div>
        </div>

        <!-- Token breakdown -->
        <transition name="slide">
          <div v-if="selectedWallet?.balances?.length" class="token-breakdown">
            <div v-for="b in selectedWallet.balances" :key="b.id" class="token-row">
              <div class="token-left">
                <span class="token-symbol">{{ b.metadata.assetType === 'native' ? 'XLM' : b.symbol }}</span>
                <span class="token-balance">{{ b.balance.toLocaleString('en-US', { maximumFractionDigits: 4 }) }}</span>
              </div>
              <span class="token-usd">{{ fmtUsd(b.balanceUsd) }}</span>
            </div>
          </div>
        </transition>

        <!-- Add wallet CTA -->
        <button class="add-wallet-btn" :disabled="isConnecting" @click="openConnectModal">
          <span class="add-icon">+</span>
          {{ isConnecting ? 'Opening wallet…' : 'Add Stellar Wallet' }}
        </button>

        <p v-if="connectError && !showSignModal" class="inline-error">{{ connectError }}</p>
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
      <div class="soon-overlay">
        <div class="soon-pill">
          <span class="soon-dot"></span>
          On-chain actions — Coming soon
        </div>
      </div>
    </div>

    <!-- ── SIGN MODAL ──────────────────────────────────────────────────────── -->
    <transition name="fade">
      <div v-if="showSignModal" class="modal-overlay" @click.self="closeSignModal">
        <div class="connect-modal">

          <div class="modal-header">
            <span class="modal-title">Prove Ownership</span>
            <button class="modal-close" @click="closeSignModal">✕</button>
          </div>

          <div class="sign-address-block">
            <span class="sign-label">Wallet detected</span>
            <span class="sign-address">{{ pendingAddress }}</span>
          </div>

          <div class="sign-message-block">
            <span class="sign-label">Message to sign</span>
            <pre class="sign-message-text">{{ pendingSignMessage }}</pre>
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
            Your wallet will prompt you to sign this message.
            No transaction is broadcast — this only proves ownership.
          </p>

          <p v-if="connectError" class="connect-error">{{ connectError }}</p>

          <div class="modal-actions">
            <button class="btn-confirm" :disabled="signLoading" @click="signAndAdd">
              {{ signLoading ? 'Waiting for signature…' : 'Sign & Add Wallet' }}
            </button>
            <button class="btn-cancel" @click="closeSignModal">Cancel</button>
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
.card-soon { position: relative; overflow: hidden; }

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
.wallet-row:hover  { border-color: rgba(213,255,47,0.3); }
.wallet-row.active { border-color: #D5FF2F; background: #1a1f0e; }

.wallet-num  { font-size: 12px; font-weight: 700; color: #E2E6E1; white-space: nowrap; }
.wallet-addr {
  font-size: 11px; color: #9A9B99;
  font-family: 'DM Mono', monospace;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0;
}
.wallet-right  { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.wallet-amount { font-size: 12px; color: #D5FF2F; font-weight: 600; white-space: nowrap; }

.btn-sel {
  font-size: 11px; color: #D5FF2F;
  border: 1px solid rgba(213,255,47,0.3); background: transparent;
  border-radius: 5px; padding: 3px 8px; cursor: pointer; transition: background 0.15s;
}
.btn-sel:hover { background: rgba(213,255,47,0.1); }

.token-breakdown {
  background: #161616; border: 1px solid #2a2a2a; border-radius: 8px;
  padding: 8px 12px; display: flex; flex-direction: column; gap: 4px;
}
.token-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 4px 0; border-bottom: 1px solid #222; font-size: 12px;
}
.token-row:last-child { border-bottom: none; }
.token-left    { display: flex; align-items: center; gap: 8px; }
.token-symbol  { font-weight: 700; color: #E2E6E1; }
.token-balance { color: #9A9B99; }
.token-usd     { color: #D5FF2F; font-weight: 600; }

.add-wallet-btn {
  display: flex; align-items: center; gap: 8px; width: 100%;
  background: transparent; border: 1px dashed rgba(213,255,47,0.3);
  border-radius: 8px; padding: 10px 14px; color: #D5FF2F;
  font-size: 12px; font-weight: 600; cursor: pointer;
  letter-spacing: 0.04em; transition: border-color 0.15s, background 0.15s;
  font-family: 'DM Mono', monospace;
}
.add-wallet-btn:hover:not(:disabled) { border-color: #D5FF2F; background: rgba(213,255,47,0.05); }
.add-wallet-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.add-icon {
  width: 18px; height: 18px;
  background: rgba(213,255,47,0.12); border: 1px solid rgba(213,255,47,0.3);
  border-radius: 4px; display: flex; align-items: center; justify-content: center;
  font-size: 14px; line-height: 1; flex-shrink: 0;
}

.inline-error { font-size: 11px; color: #FF5A5A; text-align: center; }

/* Modal */
.modal-overlay {
  position: fixed; inset: 0; z-index: 100;
  background: rgba(0,0,0,0.65); backdrop-filter: blur(4px);
  display: flex; align-items: center; justify-content: center; padding: 16px;
}
.connect-modal {
  background: #181818; border: 1px solid #333; border-radius: 16px;
  padding: 20px; width: 100%; max-width: 380px;
  display: flex; flex-direction: column; gap: 14px;
  box-shadow: 0 24px 60px rgba(0,0,0,0.6);
}
.modal-header { display: flex; align-items: center; justify-content: space-between; }
.modal-title  { font-size: 15px; font-weight: 700; color: #E2E6E1; flex: 1; text-align: center; }
.modal-close  {
  font-size: 13px; color: #5E5F5D; background: none; border: none;
  cursor: pointer; padding: 4px; transition: color 0.15s;
}
.modal-close:hover { color: #E2E6E1; }

.sign-address-block,
.sign-message-block {
  background: #141414; border: 1px solid #2a2a2a;
  border-radius: 8px; padding: 10px 12px; display: flex; flex-direction: column; gap: 4px;
}
.sign-label   { font-size: 10px; color: #5E5F5D; text-transform: uppercase; letter-spacing: 0.1em; }
.sign-address { font-size: 11px; color: #D5FF2F; font-family: 'DM Mono', monospace; word-break: break-all; }
.sign-message-text {
  font-size: 10px; color: #9A9B99; font-family: 'DM Mono', monospace;
  white-space: pre-wrap; word-break: break-all; margin: 0; line-height: 1.5;
}
.sign-label-row { display: flex; flex-direction: column; gap: 4px; }
.sign-label-input {
  background: #141414; border: 1px solid #3a3a3a; border-radius: 6px;
  padding: 7px 10px; font-size: 12px; color: #E2E6E1;
  font-family: 'DM Mono', monospace; outline: none; width: 100%; transition: border-color 0.15s;
}
.sign-label-input:focus { border-color: #D5FF2F; }
.sign-label-input::placeholder { color: #5E5F5D; }
.sign-info {
  font-size: 11px; color: #5E5F5D; line-height: 1.5;
  background: rgba(213,255,47,0.04); border: 1px solid rgba(213,255,47,0.1);
  border-radius: 6px; padding: 8px 10px;
}
.connect-error { font-size: 11px; color: #FF5A5A; text-align: center; }

.modal-actions { display: flex; gap: 8px; }
.btn-confirm {
  font-size: 11px; font-weight: 700; color: #D5FF2F;
  background: #373B26; border: 1px solid #D5FF2F;
  border-radius: 6px; padding: 8px 14px; cursor: pointer; flex: 1; transition: background 0.15s;
}
.btn-confirm:hover:not(:disabled) { background: rgba(213,255,47,0.2); }
.btn-confirm:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-cancel {
  font-size: 11px; color: #9A9B99; background: transparent; border: 1px solid #3a3a3a;
  border-radius: 6px; padding: 8px 14px; cursor: pointer;
}
.btn-cancel:hover { border-color: #5E5F5D; color: #E2E6E1; }

/* Notifications */
.notif-title  { font-size: 12px; color: #9A9B99; }
.notif-list   { display: flex; flex-direction: column; }
.notif-row    { display: flex; align-items: center; justify-content: space-between; padding: 9px 0; border-bottom: 1px solid #2a2a2a; }
.notif-text   { font-size: 12px; color: #9A9B99; }
.notif-text strong { color: #E2E6E1; }
.notif-badge  { font-size: 12px; font-weight: 700; }
.notif-actions { display: flex; flex-direction: column; gap: 6px; margin-top: 4px; }
.btn-action {
  font-size: 12px; font-weight: 700; color: #D5FF2F;
  background: #373B26; border: 1px solid #D5FF2F;
  border-radius: 6px; padding: 7px 14px; cursor: pointer; width: fit-content; letter-spacing: 0.05em;
}
.btn-claim {
  font-size: 12px; font-weight: 700; color: #fff;
  background: #222; border: 1px solid #3a3a3a;
  border-radius: 6px; padding: 7px 14px; cursor: pointer; width: fit-content;
}
.see-all { font-size: 12px; color: #D5FF2F; background: none; border: none; cursor: pointer; text-align: left; }

.soon-overlay {
  position: absolute; inset: 0;
  background: rgba(14,14,14,0.35); backdrop-filter: blur(1.5px);
  -webkit-backdrop-filter: blur(1.5px); border-radius: 15px;
  display: flex; align-items: center; justify-content: center; pointer-events: none;
}
.soon-pill {
  display: flex; align-items: center; gap: 8px;
  background: #1a1a1a; border: 1px solid #3a3a3a;
  border-radius: 999px; padding: 8px 18px;
  font-size: 15px; font-weight: 600; color: #9A9B99;
  letter-spacing: 0.06em; user-select: none;
}
.soon-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: #D5FF2F; flex-shrink: 0;
  animation: pulse 2s ease-in-out infinite;
}
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }

.slide-enter-active, .slide-leave-active { transition: all 0.2s ease; }
.slide-enter-from, .slide-leave-to { opacity: 0; transform: translateY(-6px); }
.fade-enter-active, .fade-leave-active { transition: opacity 0.2s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>