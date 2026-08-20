<script setup lang="ts">
// ConnectModal — Lot C (C5) · design CONNECT/ADD WALLET modal.
// Two real paths, matching WalletSection's semantics:
//  • "Connect signer wallet" → the Stellar Wallets Kit modal (the Kit owns
//    provider selection; we never invent a signing flow). The connected wallet
//    becomes the active signer.
//  • Watch-only → add a G… address that is monitored but can never sign.
//    Lot AB: this no longer requires an existing user — the first track mints
//    a real account server-side and the session adopts it.
//
// AA3 (Lot AA): below `sm` the modal renders as a bottom sheet (100dvh cap,
// inner scroll). On touch-mobile devices the layout is honest about the
// AA0-a verdict (confirmed on a real iPhone): desktop-extension wallets don't
// run in mobile browsers and the two web-bridge wallets are unreliable there —
// so watch-only is presented FIRST as the primary mobile entry, and the signer
// path carries the caveat instead of a silently failing flow.
import { ref } from 'vue'
import { useConnectFlow } from '../../composables/useConnectFlow'
import { useSharedWallets } from '../../composables/useSharedWallets'
import { useMediaQuery } from '../../composables/useMediaQuery'

const emit = defineEmits<{ (e: 'close'): void }>()

const { connect, isConnecting } = useConnectFlow()
const { addWallet } = useSharedWallets()

// Touch-mobile ≠ narrow viewport: the extension/bridge availability that the
// honest state describes follows the DEVICE class, not the window width.
const isTouchMobile = useMediaQuery('(hover: none) and (pointer: coarse)')

const watchInput = ref('')
const label = ref('')
// W2 — optional label for the SIGNER path (watch-only has its own field).
const signerLabel = ref('')
const adding = ref(false)
const error = ref<string | null>(null)

async function onConnect() {
  await connect({ label: signerLabel.value })
  emit('close')
}

async function onTrack() {
  const address = watchInput.value.trim()
  if (!address) return
  adding.value = true
  error.value = null
  try {
    await addWallet({ address, label: label.value.trim() || undefined })
    emit('close')
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to add address.'
  } finally {
    adding.value = false
  }
}
</script>

<template>
  <!-- Teleported to <body> so a transformed/animated ancestor can never become
       the containing block for the fixed overlay (H1). -->
  <Teleport to="body">
  <div
    class="fixed inset-0 z-[50] flex items-center justify-center p-[24px] max-sm:items-end max-sm:p-0"
    style="background: rgba(38,36,32,0.34); backdrop-filter: blur(3px); animation: digOverlay .2s ease"
    @click.self="emit('close')"
  >
    <div
      class="w-[420px] rounded-[20px] max-h-[90vh] overflow-hidden flex flex-col max-sm:w-full max-sm:rounded-b-none max-sm:max-h-[100dvh]"
      style="background: var(--dig-surface); box-shadow: 0 30px 80px -30px rgba(38,36,32,0.5); animation: digSheet .3s cubic-bezier(.2,.8,.2,1) both"
    >
      <!-- flex column so the order-N classes can put watch-only first on mobile -->
      <div class="dig-scroll overflow-y-auto flex flex-col" style="padding: 24px 26px 22px">
        <div class="flex items-center justify-between mb-[4px]">
          <div class="text-[18px] font-bold">{{ isTouchMobile ? 'Add a wallet' : 'Connect a wallet' }}</div>
          <button type="button" class="dig-chip cursor-pointer text-[20px] w-[30px] h-[30px] flex items-center justify-center rounded-[8px]" style="color: var(--dig-faint)" @click="emit('close')">×</button>
        </div>
        <div class="text-[13px] mb-[20px]" style="color: var(--dig-faint)">
          {{ isTouchMobile
            ? 'Track any Stellar address read-only — or connect a signer wallet (limited on mobile).'
            : 'Sign in with any Stellar wallet, or track a public address read-only.' }}
        </div>

        <!-- Watch-only — FIRST on touch-mobile (the reliable mobile entry). -->
        <div :class="isTouchMobile ? 'order-1' : 'order-3'" class="flex flex-col">
          <div v-if="isTouchMobile" class="text-[11px] font-semibold mb-[8px]" style="color: var(--dig-faint)">TRACK AN ADDRESS (WATCH-ONLY)</div>
          <div class="flex gap-[9px]">
            <input
              v-model="watchInput"
              placeholder="Paste a G… Stellar address"
              class="flex-1 h-[44px] px-[14px] rounded-[12px] font-mono-geist text-[13px] outline-none min-w-0"
              style="border: 1px solid var(--dig-line); background: var(--dig-surface-2); color: var(--dig-text)"
            />
            <button
              type="button"
              class="dig-btn h-[44px] px-[18px] rounded-[12px] text-[13px] font-semibold cursor-pointer disabled:opacity-50"
              style="background: var(--dig-accent); color: #141414; border: none"
              :disabled="adding || !watchInput.trim()"
              @click="onTrack"
            >
              {{ adding ? 'Adding…' : 'Track' }}
            </button>
          </div>
          <input
            v-if="watchInput.trim()"
            v-model="label"
            placeholder="Label (optional)"
            class="w-full h-[40px] px-[14px] mt-[9px] rounded-[12px] text-[13px] outline-none"
            style="border: 1px solid var(--dig-line); background: var(--dig-surface-2); color: var(--dig-text)"
          />
        </div>

        <!-- Divider — always between the two sections in both orderings -->
        <div class="order-2 flex items-center gap-[10px] my-[16px]">
          <div class="flex-1 h-px" style="background: var(--dig-line-soft)"></div>
          <span class="text-[11px] font-semibold" style="color: var(--dig-faint)">{{ isTouchMobile ? 'OR SIGN (LIMITED ON MOBILE)' : 'OR WATCH-ONLY' }}</span>
          <div class="flex-1 h-px" style="background: var(--dig-line-soft)"></div>
        </div>

        <!-- Signer connect (Kit owns provider selection) — second on mobile. -->
        <div :class="isTouchMobile ? 'order-3' : 'order-1'" class="flex flex-col">
          <input
            v-model="signerLabel"
            placeholder="Label (optional, e.g. Main)"
            class="w-full h-[40px] px-[14px] mb-[9px] rounded-[12px] text-[13px] outline-none"
            style="border: 1px solid var(--dig-line); background: var(--dig-surface-2); color: var(--dig-text)"
          />
          <button
            type="button"
            class="dig-btn w-full h-[48px] rounded-[13px] text-[14px] font-bold cursor-pointer flex items-center justify-center gap-[8px]"
            :style="isTouchMobile
              ? 'background: var(--dig-surface-3); color: var(--dig-text); border: 1px solid var(--dig-line)'
              : 'background: var(--dig-accent); color: #141414; border: none'"
            :disabled="isConnecting"
            @click="onConnect"
          >
            {{ isConnecting ? 'Opening wallet…' : 'Connect signer wallet' }}
          </button>
          <!-- Honest availability copy (AA0-a, verified on device + prod):
               extensions don't exist in mobile browsers; xBull/Albedo use
               popup web bridges that are unreliable on iOS Safari. -->
          <div v-if="isTouchMobile" class="text-[11.5px] mt-[8px] text-center" style="color: var(--dig-faint)">
            Mobile browsers can't run desktop wallet extensions (Freighter, Rabet, LOBSTR, Hana).
            xBull and Albedo may work via their web wallets, but signing from mobile isn't reliable yet —
            for signing, use a desktop browser.
          </div>
          <div v-else class="text-[11.5px] mt-[8px] text-center" style="color: var(--dig-faint)">
            Freighter, xBull, Albedo, Rabet, LOBSTR, Hana (via Stellar Wallets Kit)
          </div>
        </div>

        <p v-if="error" class="order-5 text-[11.5px] mt-[10px]" style="color: var(--dig-red)">{{ error }}</p>

        <div class="order-6 flex items-center gap-[8px] mt-[16px] text-[12px]" style="color: var(--dig-faint)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l8 4v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6z"></path></svg>
          Non-custodial: Dig never sees your keys. Watch-only can't sign.
        </div>
      </div>
    </div>
  </div>
  </Teleport>
</template>
