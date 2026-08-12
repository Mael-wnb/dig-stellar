<script setup lang="ts">
// ConnectModal — Lot C (C5) · design CONNECT/ADD WALLET modal.
// Two real paths, matching WalletSection's semantics:
//  • "Connect signer wallet" → the Stellar Wallets Kit modal (Freighter/xBull/
//    Albedo/WalletConnect — the Kit owns provider selection; we never invent a
//    signing flow). The connected wallet becomes the active signer.
//  • Watch-only → add a G… address that is monitored but can never sign. Requires
//    an existing user (connect a signer first), mirroring the existing rule.
import { ref } from 'vue'
import { useConnectFlow } from '../../composables/useConnectFlow'
import { useSharedWallets } from '../../composables/useSharedWallets'
import { useAppUser } from '../../composables/useAppUser'

const emit = defineEmits<{ (e: 'close'): void }>()

const { userId } = useAppUser()
const { connect, isConnecting } = useConnectFlow()
const { addWallet } = useSharedWallets()

const watchInput = ref('')
const label = ref('')
const adding = ref(false)
const error = ref<string | null>(null)

async function onConnect() {
  await connect()
  emit('close')
}

async function onTrack() {
  const address = watchInput.value.trim()
  if (!address) return
  if (!userId.value) {
    error.value = 'Connect a signer wallet first, then add watch-only addresses.'
    return
  }
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
    class="fixed inset-0 z-[50] flex items-center justify-center p-[24px]"
    style="background: rgba(38,36,32,0.34); backdrop-filter: blur(3px); animation: digOverlay .2s ease"
    @click.self="emit('close')"
  >
    <div
      class="w-[420px] rounded-[20px] max-h-[90vh] overflow-hidden flex flex-col"
      style="background: var(--dig-surface); box-shadow: 0 30px 80px -30px rgba(38,36,32,0.5); animation: digSheet .3s cubic-bezier(.2,.8,.2,1) both"
    >
      <div class="dig-scroll overflow-y-auto" style="padding: 24px 26px 22px">
        <div class="flex items-center justify-between mb-[4px]">
          <div class="text-[18px] font-bold">Connect a wallet</div>
          <button type="button" class="dig-chip cursor-pointer text-[20px] w-[30px] h-[30px] flex items-center justify-center rounded-[8px]" style="color: var(--dig-faint)" @click="emit('close')">×</button>
        </div>
        <div class="text-[13px] mb-[20px]" style="color: var(--dig-faint)">Sign in with any Stellar wallet, or track a public address read-only.</div>

        <!-- Signer connect (Kit owns provider selection) -->
        <button
          type="button"
          class="dig-btn w-full h-[48px] rounded-[13px] text-[14px] font-bold cursor-pointer flex items-center justify-center gap-[8px]"
          style="background: var(--dig-accent); color: #141414; border: none"
          :disabled="isConnecting"
          @click="onConnect"
        >
          {{ isConnecting ? 'Opening wallet…' : 'Connect signer wallet' }}
        </button>
        <div class="text-[11.5px] mt-[8px] text-center" style="color: var(--dig-faint)">
          Freighter · xBull · Albedo · WalletConnect — via Stellar Wallets Kit
        </div>

        <!-- Divider -->
        <div class="flex items-center gap-[10px] my-[16px]">
          <div class="flex-1 h-px" style="background: var(--dig-line-soft)"></div>
          <span class="text-[11px] font-semibold" style="color: var(--dig-faint)">OR WATCH-ONLY</span>
          <div class="flex-1 h-px" style="background: var(--dig-line-soft)"></div>
        </div>

        <div class="flex gap-[9px]">
          <input
            v-model="watchInput"
            placeholder="Paste a G… Stellar address"
            class="flex-1 h-[44px] px-[14px] rounded-[12px] font-mono-geist text-[13px] outline-none"
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

        <p v-if="error" class="text-[11.5px] mt-[10px]" style="color: var(--dig-red)">{{ error }}</p>

        <div class="flex items-center gap-[8px] mt-[16px] text-[12px]" style="color: var(--dig-faint)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l8 4v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6z"></path></svg>
          Non-custodial — Dig never sees your keys. Watch-only can't sign.
        </div>
      </div>
    </div>
  </div>
  </Teleport>
</template>
