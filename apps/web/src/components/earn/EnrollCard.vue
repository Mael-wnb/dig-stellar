<script setup lang="ts">
// EnrollCard — Lot EP (EP2). Connect → prove ownership → enrol. The proof is a
// signed TEXT message: the "This is NOT a transaction" copy is shown here,
// BEFORE the wallet prompt (recon §9.2). Wallets whose Kit module cannot sign
// messages (Lobstr) get the dedicated message and no dead button.
import { computed, ref } from 'vue'
import { useCampaign, WALLET_CANNOT_SIGN_MESSAGE } from '../../composables/useCampaign'
import { useModals } from '../../composables/useModals'
import { useWalletSession } from '../../composables/useWalletSession'
import type { CampaignWriteReason } from '../../api/campaign'

const { identity, walletCanSignMessages, pendingReferralCode, enroll } = useCampaign()
const { connectedAddress, shortConnectedAddress } = useWalletSession()
const { openConnect } = useModals()

const busy = ref(false)
const error = ref<string | null>(null)
const lastReason = ref<CampaignWriteReason | null>(null)

const REASON_COPY: Partial<Record<CampaignWriteReason, string>> = {
  'campaign-disabled': 'The campaign is not running right now.',
  'campaign-not-started': 'The campaign has not started yet.',
  'campaign-ended': 'The campaign has ended.',
  'ownership-proof-required': 'We could not verify that you own this wallet. Please try again.',
  'not-enrolled': 'This wallet is not enrolled yet.',
  'already-enrolled': 'This wallet is already enrolled.',
  'invalid-referral-code': 'This referral code is not valid. You can still join without it.',
  'self-referral': 'You cannot use your own referral code.',
}

const canJoin = computed(() => !!identity.value && walletCanSignMessages.value && !busy.value)

async function join() {
  error.value = null
  lastReason.value = null
  busy.value = true
  try {
    const res = await enroll()
    if (!res.enrolled) {
      lastReason.value = res.reason
      error.value = REASON_COPY[res.reason] ?? 'Could not join right now.'
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Could not join right now.'
  } finally {
    busy.value = false
  }
}

// invalid-referral-code: drop the in-memory code and join plainly.
async function joinWithoutCode() {
  pendingReferralCode.value = null
  await join()
}
</script>

<template>
  <section
    class="rounded-[18px] p-[22px] max-md:p-[16px]"
    style="background: var(--dig-surface); border: 1px solid var(--dig-line)"
  >
    <div class="flex items-baseline justify-between flex-wrap gap-[8px]">
      <h2 class="m-0 text-[16px] font-bold tracking-[-0.02em]">Join Earn &amp; Points</h2>
      <span class="text-[12px]" style="color: var(--dig-faint)">Points for real on-chain activity on Dig</span>
    </div>

    <p class="mt-[10px] text-[13px] leading-[1.6]" style="color: var(--dig-text-2)">
      Enrol your connected wallet to collect points for verified swaps and Blend deposits,
      daily check-ins, social tasks and referrals. Points unlock perks such as beta or early access.
    </p>

    <div
      v-if="pendingReferralCode"
      class="mt-[12px] rounded-[12px] px-[14px] py-[9px] text-[12px]"
      style="background: var(--dig-surface-2); border: 1px solid var(--dig-line-soft); color: var(--dig-text-2)"
    >
      Referral code <span class="font-mono-geist font-semibold" style="color: var(--dig-accent)">{{ pendingReferralCode }}</span>
      will be applied when you join.
    </div>

    <!-- The proof explained BEFORE the wallet prompt (recon §9.2). -->
    <div
      class="mt-[12px] rounded-[12px] px-[14px] py-[11px] text-[12px] leading-[1.6]"
      style="background: rgba(213,255,47,0.06); border: 1px solid rgba(213,255,47,0.3); color: var(--dig-text-2)"
    >
      <span class="font-semibold" style="color: var(--dig-accent)">This is NOT a transaction.</span>
      Joining asks your wallet to sign a short text message that proves you control this address.
      Nothing is built, simulated or submitted to the network, no fee is paid and no funds move.
    </div>

    <div class="mt-[14px] flex items-center gap-[12px] flex-wrap">
      <template v-if="!connectedAddress">
        <button
          type="button"
          class="dig-btn h-[38px] px-[16px] rounded-[11px] text-[13px] font-semibold cursor-pointer"
          style="background: var(--dig-accent); color: #141414; border: none"
          @click="openConnect"
        >
          Connect a wallet to join
        </button>
      </template>

      <template v-else-if="!walletCanSignMessages">
        <span class="text-[12.5px] font-medium" style="color: var(--dig-amber)">{{ WALLET_CANNOT_SIGN_MESSAGE }}</span>
      </template>

      <template v-else>
        <button
          type="button"
          class="dig-btn h-[38px] px-[16px] rounded-[11px] text-[13px] font-semibold cursor-pointer"
          style="background: var(--dig-accent); color: #141414; border: none"
          :disabled="!canJoin"
          @click="join"
        >
          {{ busy ? 'Waiting for your wallet…' : `Join with ${shortConnectedAddress}` }}
        </button>
        <span v-if="!identity" class="text-[12px]" style="color: var(--dig-faint)">
          Finish connecting this wallet first.
        </span>
      </template>
    </div>

    <div v-if="error" class="mt-[10px] text-[12.5px]" style="color: var(--dig-amber)">
      {{ error }}
      <button
        v-if="lastReason === 'invalid-referral-code'"
        type="button"
        class="ml-[6px] underline cursor-pointer font-semibold"
        style="color: var(--dig-accent)"
        :disabled="busy"
        @click="joinWithoutCode"
      >
        Join without the code
      </button>
    </div>

    <p class="mt-[12px] text-[11px] leading-[1.5]" style="color: var(--dig-faint)">
      Supported for joining: Freighter and xBull (message signing).
    </p>
  </section>
</template>
