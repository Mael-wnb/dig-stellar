<script setup lang="ts">
// GetStartedCard — F4 (Lot F). Shown when a wallet IS connected but has no
// tracked positions yet: a real "get started" card, not a hollow shell. Up to
// three real actions:
//   1. Fund your wallet — plain copy only (no on-ramp integration in this lot).
//   2. Try a swap        — opens the REAL SDEX swap action (ActionModal, amm).
//   3. Deposit in Blend  — opens the REAL Blend deposit action (lending) and
//      shows the pool's REAL current supply APY from our API, with freshness.
// Honest-copy rules (firm): APY is labeled current/variable, never projected
// earnings; on Mainnet a real-funds warning + the 100 XLM launch cap are shown;
// a non-custodial line is always present. The parent hides this card as soon as
// a position exists — no sponsored placement of any kind.
//
// H2 (Lot H): `compact` renders the SAME three actions and copy at panel
// density — tiles stacked vertically, no own card chrome — for embedding in
// the dashboard "Your positions" panel. No forked variant, one component.
import { computed, onMounted } from 'vue'
import { useAdvertisedBlendPool } from '../../composables/useAdvertisedBlendPool'
import { blendDepositActionContext, sdexSwapActionContext } from '../../lib/advertisedBlendPool'
import { useModals } from '../../composables/useModals'
import { useNetwork } from '../../composables/useNetwork'
import FreshnessChip from '../FreshnessChip.vue'
import PointsChip from '../earn/PointsChip.vue'
import { useCampaign } from '../../composables/useCampaign'

const props = withDefaults(defineProps<{ compact?: boolean }>(), { compact: false })

const { openAction } = useModals()
const { network } = useNetwork()

// Lot EP (EP2): "+N pts" next to the APY — a SIBLING node fed only by the API
// rules block; null (campaign inactive/unknown) renders nothing. The APY node
// and its helper above are untouched; points are never folded into the rate.
const { pointsForAction, disclaimer: campaignDisclaimer, refreshCampaign } = useCampaign()

const isMainnet = computed(() => network.value === 'mainnet')

// The real Blend pool whose live supply APY + freshness the tile surfaces
// (highest finite APY; null → no fabricated number, the deposit still works).
// EP4: the selection lives in lib/advertisedBlendPool + useAdvertisedBlendPool,
// shared with the Earn "Earn more" card so both CTAs open the SAME pool.
const { advertisedPool: blendPool, load: loadAdvertisedPool } = useAdvertisedBlendPool()

onMounted(() => {
  void refreshCampaign()
  void loadAdvertisedPool()
})

const apyLabel = computed(() => {
  const v = blendPool.value?.metrics.supplyApy
  if (v === null || v === undefined || !Number.isFinite(v)) return null
  return `${(v * 100).toFixed(2)}%`
})

function trySwap() {
  openAction(sdexSwapActionContext())
}

function depositBlend() {
  openAction(blendDepositActionContext(blendPool.value))
}
</script>

<template>
  <div
    :class="props.compact ? '' : 'rounded-[18px] p-[24px]'"
    :style="props.compact ? undefined : 'background: var(--dig-surface); border: 1px solid var(--dig-line)'"
  >
    <div class="flex items-baseline justify-between flex-wrap gap-[8px]">
      <div class="font-bold tracking-[-0.02em]" :class="props.compact ? 'text-[14px]' : 'text-[16px]'">Get started</div>
      <div class="text-[12px]" style="color: var(--dig-faint)">
        Your wallet is connected. Here's how to open your first position.
      </div>
    </div>

    <!-- Mainnet reality check: real funds + the launch cap. Testnet stays quiet. -->
    <div
      v-if="isMainnet"
      class="mt-[14px] rounded-[12px] px-[14px] py-[11px] text-[12px]"
      style="background: rgba(255,184,107,0.08); border: 1px solid rgba(255,184,107,0.4); color: var(--dig-amber)"
    >
      <span class="font-semibold">Mainnet: real funds.</span>
      A 100 XLM per-transaction cap applies during the launch period.
    </div>

    <div class="grid gap-[12px] mt-[16px]" :style="{ gridTemplateColumns: props.compact ? '1fr' : 'repeat(3, 1fr)' }">
      <!-- 1. Fund — plain copy, no on-ramp -->
      <div class="rounded-[14px] p-[16px] flex flex-col" style="background: var(--dig-surface-2); border: 1px solid var(--dig-line-soft)">
        <div class="text-[13px] font-bold">Fund your wallet</div>
        <div class="text-[12px] mt-[6px] flex-1" style="color: var(--dig-faint)">
          Transfer XLM to your connected address from an exchange or another wallet.
          No on-ramp is built into the app yet.
        </div>
        <div class="text-[11px] mt-[10px] font-semibold" style="color: var(--dig-faint)">Send XLM →</div>
      </div>

      <!-- 2. Swap — opens the real SDEX swap -->
      <button
        type="button"
        class="dig-card-h rounded-[14px] p-[16px] flex flex-col text-left cursor-pointer"
        style="background: var(--dig-surface-2); border: 1px solid var(--dig-line-soft)"
        @click="trySwap"
      >
        <div class="text-[13px] font-bold">Try a swap</div>
        <div class="text-[12px] mt-[6px] flex-1" style="color: var(--dig-faint)">
          Swap between vetted assets on the Stellar DEX. Every transaction is decoded
          and verified against your request before you sign.
        </div>
        <!-- Lot EP (EP2): Dig points for a verified swap (API rules block only). -->
        <div class="mt-[6px]">
          <PointsChip :points="pointsForAction('sdex-swap')" :disclaimer="campaignDisclaimer" caption="Dig points per verified swap" />
        </div>
        <div class="text-[11px] mt-[10px] font-semibold" style="color: var(--dig-accent)">Open swap →</div>
      </button>

      <!-- 3. Deposit in Blend — opens the real deposit, shows the REAL current supply APY -->
      <button
        type="button"
        class="dig-card-h rounded-[14px] p-[16px] flex flex-col text-left cursor-pointer"
        style="background: var(--dig-surface-2); border: 1px solid var(--dig-line-soft)"
        @click="depositBlend"
      >
        <div class="flex items-baseline justify-between gap-[6px]">
          <div class="text-[13px] font-bold">Deposit in Blend</div>
          <div v-if="apyLabel" class="text-[13px] font-bold tabular-nums" style="color: var(--dig-green)">{{ apyLabel }}</div>
        </div>
        <div v-if="apyLabel" class="text-[10.5px] mt-[2px]" style="color: var(--dig-faint)">
          Current supply APY (variable)
        </div>
        <!-- Lot EP (EP2): Dig points for a verified deposit, separate from the APY above. -->
        <div class="mt-[6px]">
          <PointsChip :points="pointsForAction('blend-deposit')" :disclaimer="campaignDisclaimer" caption="Dig points per verified deposit" />
        </div>
        <div class="text-[12px] mt-[6px] flex-1" style="color: var(--dig-faint)">
          Supply an asset as collateral and earn the pool's variable rate. Not a
          promised or projected return.
        </div>
        <div v-if="blendPool" class="mt-[10px]">
          <FreshnessChip
            :updated-at="blendPool.updatedAt"
            :is-stale="blendPool.isStale"
            :stale-after-seconds="blendPool.staleAfterSeconds"
          />
        </div>
        <div class="text-[11px] mt-[10px] font-semibold" style="color: var(--dig-accent)">Open deposit →</div>
      </button>
    </div>

    <div class="text-[11.5px] mt-[16px]" style="color: var(--dig-faint)">
      Non-custodial: you sign everything in your own wallet. Dig never holds your keys or funds.
    </div>
    <!-- Lot EP (EP4): the campaign line is rendered once, on the Earn view only. -->
  </div>
</template>
