<script setup lang="ts">
// EmptyPortfolioState — F4 (Lot F). The "no wallet connected" state for the
// Portfolio (and any wallet-dependent section). Not a page, no router change:
// a value-prop + a single CTA into the existing ConnectModal (Wallets Kit and
// add-by-address/watch-only are both reachable from there). Honest copy:
// read-only until the user actively signs, non-custodial throughout.
//
// H2 (Lot H): `compact` renders the same value prop + CTA at panel density and
// without its own card chrome — for embedding inside an existing card (the
// dashboard "Your positions" panel). Copy and behavior are identical.
withDefaults(defineProps<{ compact?: boolean }>(), { compact: false })
defineEmits<{ (e: 'connect'): void }>()
</script>

<template>
  <div
    class="flex flex-col items-center text-center"
    :class="compact ? 'px-[6px] py-[14px]' : 'rounded-[18px] px-[32px] py-[44px]'"
    :style="compact ? undefined : 'background: var(--dig-surface); border: 1px solid var(--dig-line)'"
  >
    <div
      class="rounded-[15px] flex items-center justify-center"
      :class="compact ? 'w-[42px] h-[42px] mb-[12px]' : 'w-[52px] h-[52px] mb-[18px]'"
      style="background: rgba(213,255,47,0.1); border: 1px solid rgba(213,255,47,0.3)"
    >
      <svg :width="compact ? 20 : 24" :height="compact ? 20 : 24" viewBox="0 0 24 24" fill="none" stroke="var(--dig-accent)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <rect x="2" y="6" width="20" height="13" rx="3"></rect>
        <path d="M2 10h20"></path>
        <circle cx="17" cy="14" r="1.4" fill="var(--dig-accent)"></circle>
      </svg>
    </div>
    <div class="font-bold tracking-[-0.02em]" :class="compact ? 'text-[15px]' : 'text-[18px]'">Track your Stellar DeFi portfolio</div>
    <div class="max-w-[420px]" :class="compact ? 'text-[12.5px] mt-[6px]' : 'text-[13px] mt-[8px]'" style="color: var(--dig-faint)">
      See balances and Blend positions across every wallet: non-custodial, read-only
      until you choose to act. You sign everything in your own wallet.
    </div>
    <button
      type="button"
      class="dig-btn rounded-[12px] text-[13px] font-bold cursor-pointer"
      :class="compact ? 'h-[38px] px-[18px] mt-[16px]' : 'h-[44px] px-[24px] mt-[22px]'"
      style="background: var(--dig-accent); color: #141414; border: none"
      @click="$emit('connect')"
    >
      Connect wallet
    </button>
    <div class="text-[11.5px]" :class="compact ? 'mt-[10px]' : 'mt-[12px]'" style="color: var(--dig-faint)">
      Or add any address as watch-only: no signing, just monitoring.
    </div>
  </div>
</template>
