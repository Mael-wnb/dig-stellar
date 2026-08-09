<script setup lang="ts">
// ActionModal — Lot C (C5) · design ACTION FLOW shell.
// Wraps the REAL, already-gated actions in the design chrome:
//  • lending pools → the real BlendDepositCard,
//  • AMM pools    → the real SdexSwapWidget.
// Both keep their own build → CLIENT-SIDE VALIDATE (validateSwapXdr /
// validateDepositXdr) → sign → submit flow and the flags regime EXACTLY as they
// are — this modal is chrome only, never the signing/validation point. Add/Remove
// liquidity are present but disabled ("soon") — they go live with Lot D.
import { ref } from 'vue'
import type { ActionContext } from '../../composables/useModals'
import { venueTheme } from '../../data/venueTheme'
import SdexSwapWidget from '../SdexSwapWidget.vue'
import BlendDepositCard from '../BlendDepositCard.vue'
import NetworkToggle from '../NetworkToggle.vue'

const props = defineProps<{ ctx: ActionContext }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const theme = venueTheme(props.ctx.kind === 'lending' ? 'blend' : undefined)

const primaryLabel = props.ctx.kind === 'lending' ? 'Supply' : 'Swap'
// Tabs present in the shell; only the primary (real) action is enabled.
const tabs = [
  { key: 'primary', label: primaryLabel, soon: false },
  { key: 'add', label: 'Add liquidity', soon: true },
  { key: 'remove', label: 'Remove liquidity', soon: true },
]
const activeTab = ref('primary')
</script>

<template>
  <div
    class="fixed inset-0 z-[50] flex items-center justify-center p-[24px]"
    style="background: rgba(38,36,32,0.34); backdrop-filter: blur(3px); animation: digOverlay .2s ease"
    @click.self="emit('close')"
  >
    <div
      class="w-[520px] max-w-full rounded-[20px] max-h-[92vh] overflow-hidden flex flex-col"
      style="background: var(--dig-surface); box-shadow: 0 30px 80px -30px rgba(38,36,32,0.5); animation: digSheet .3s cubic-bezier(.2,.8,.2,1) both"
    >
      <!-- header -->
      <div class="px-[26px] pt-[22px]">
        <div class="flex items-center justify-between mb-[16px]">
          <div class="flex items-center gap-[11px]">
            <span class="w-[34px] h-[34px] rounded-[10px] flex items-center justify-center font-bold text-[14px]" :style="{ background: theme.tint, color: theme.color }">
              <img v-if="theme.logo" :src="theme.logo" alt="" class="w-[60%] h-[60%] object-contain" />
              <template v-else>{{ theme.letter }}</template>
            </span>
            <div>
              <div class="text-[16px] font-bold">{{ primaryLabel }}</div>
              <div class="text-[12px]" style="color: var(--dig-faint)">{{ ctx.name }} · {{ ctx.venue }}</div>
            </div>
          </div>
          <button type="button" class="dig-chip cursor-pointer text-[20px] w-[30px] h-[30px] flex items-center justify-center rounded-[8px]" style="color: var(--dig-faint)" @click="emit('close')">×</button>
        </div>

        <!-- tabs (liquidity disabled 'soon') -->
        <div class="flex gap-[8px] mb-[4px]">
          <button
            v-for="t in tabs"
            :key="t.key"
            type="button"
            class="flex-1 text-center py-[10px] rounded-[11px] text-[13px] font-semibold flex items-center justify-center gap-[6px]"
            :class="t.soon ? 'cursor-not-allowed' : 'cursor-pointer'"
            :disabled="t.soon"
            :style="{
              color: activeTab === t.key ? 'var(--dig-text)' : 'var(--dig-faint)',
              background: activeTab === t.key ? '#2A2A27' : 'var(--dig-surface-3)',
              border: `1.5px solid ${activeTab === t.key ? 'var(--dig-accent)' : 'transparent'}`,
              opacity: t.soon ? 0.55 : 1,
            }"
            @click="!t.soon && (activeTab = t.key)"
          >
            {{ t.label }}
            <span v-if="t.soon" class="text-[9px] font-bold uppercase px-[5px] py-[1px] rounded-[6px]" style="background: var(--dig-line); color: var(--dig-faint)">Soon</span>
          </button>
        </div>
      </div>

      <!-- body: the REAL action widget (same validators + flags regime) -->
      <div class="dig-scroll px-[26px] py-[18px] overflow-y-auto">
        <div class="flex items-center justify-between gap-[8px] mb-[12px]">
          <div class="text-[11.5px] flex items-center gap-[6px]" style="color: var(--dig-faint)">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l8 4v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6z"></path></svg>
            Decoded &amp; verified against your request before signing.
          </div>
          <!-- The swap is gated per-network; expose the network selector here so
               the widget's "switch to Testnet" instruction is actionable from
               the modal (the only other toggle lives on the dashboard). Signing
               scope only — does not change the Mainnet portfolio/data plane. -->
          <NetworkToggle />
        </div>
        <BlendDepositCard v-if="ctx.kind === 'lending'" />
        <SdexSwapWidget v-else />
      </div>
    </div>
  </div>
</template>
