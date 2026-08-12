<script setup lang="ts">
// YourPositionsPanel — H2 (Lot H, T3-D3). Compact "Your positions" recap on the
// dashboard, right of the half-width protocols box. Reuses the F4 state
// machinery — no new states, no new endpoint:
//  • no wallet connected      → compact EmptyPortfolioState + the same Connect CTA,
//  • connected, no positions  → compact GetStartedCard (same real actions),
//  • positions exist          → liquid total and DeFi supplied/borrowed shown
//    DISTINCT (standing rule: never folded into one number), top 3 Blend
//    positions with the shared HF colour states, "View portfolio →" link.
// Data: the SAME shared wallets/overview store the Portfolio uses
// (useSharedWallets — module-scoped, loads once; no duplicate fetch).
import { computed } from 'vue'
import { useSharedWallets } from '../../composables/useSharedWallets'
import { useAppUser } from '../../composables/useAppUser'
import { useModals } from '../../composables/useModals'
import { useView } from '../../composables/useView'
import { formatUsd } from '../../utils/format'
import { hfDisplay } from '../../utils/health'
import EmptyPortfolioState from './EmptyPortfolioState.vue'
import GetStartedCard from './GetStartedCard.vue'

const { userId } = useAppUser()
const { openConnect } = useModals()
const { setView } = useView()
const { wallets, defi, totalPortfolioUsd, overviewLoading } = useSharedWallets()

const hasWallets = computed(() => wallets.value.length > 0)
const hasAnyPosition = computed(() => wallets.value.some((w) => (w.pools ?? []).length > 0))

// Same state predicates as PortfolioView (F4) — kept in the same order.
const state = computed<'connect' | 'loading' | 'get-started' | 'positions'>(() => {
  if (!userId.value || (!hasWallets.value && !overviewLoading.value)) return 'connect'
  if (hasAnyPosition.value) return 'positions'
  if (overviewLoading.value) return 'loading'
  return 'get-started'
})

// Top 3 Blend positions across all wallets, by supplied value — the same
// flattening the Portfolio does, without the scope filter.
const topPositions = computed(() => {
  const rows: Array<{
    key: string
    wallet: string
    poolName: string
    suppliedUsd: number
    borrowedUsd: number
    healthFactor: number | null
  }> = []
  for (const w of wallets.value) {
    for (const p of w.pools ?? []) {
      rows.push({
        key: `${w.id}-${p.poolSlug}`,
        wallet: w.label || 'Wallet',
        poolName: p.poolName || p.poolSlug || 'Pool',
        suppliedUsd: p.totalCollateralUsd ?? 0,
        borrowedUsd: p.totalDebtUsd ?? 0,
        healthFactor: p.healthFactor,
      })
    }
  }
  return rows.sort((a, b) => b.suppliedUsd - a.suppliedUsd).slice(0, 3)
})
const positionCount = computed(() =>
  wallets.value.reduce((n, w) => n + (w.pools ?? []).length, 0),
)
</script>

<template>
  <div class="rounded-[18px] p-[20px] flex flex-col h-full" style="background: var(--dig-surface); border: 1px solid var(--dig-line)">
    <div class="flex items-center justify-between mb-[8px]">
      <div class="text-[14px] font-semibold">Your positions</div>
      <button
        type="button"
        class="dig-chip text-[12px] font-semibold cursor-pointer px-[8px] py-[3px] rounded-[8px]"
        style="color: var(--dig-text)"
        @click="setView('portfolio')"
      >View portfolio →</button>
    </div>

    <!-- No wallet connected — compact F4 connect state -->
    <div v-if="state === 'connect'" class="flex-1 flex flex-col justify-center">
      <EmptyPortfolioState compact @connect="openConnect" />
    </div>

    <!-- Overview loading (wallets known to exist, data on its way) -->
    <div v-else-if="state === 'loading'" class="flex-1 flex flex-col gap-[10px] py-[10px]">
      <div v-for="i in 3" :key="i" class="h-[42px] rounded-[11px] animate-pulse" style="background: var(--dig-surface-3)"></div>
    </div>

    <!-- Connected, no positions — compact F4 get-started (same real actions) -->
    <GetStartedCard v-else-if="state === 'get-started'" compact />

    <!-- Positions — liquid vs DeFi kept DISTINCT, top positions with HF states -->
    <template v-else>
      <div class="grid gap-[10px]" style="grid-template-columns: repeat(3, 1fr)">
        <div class="rounded-[12px] px-[13px] py-[11px]" style="background: var(--dig-surface-2); border: 1px solid var(--dig-line-soft)">
          <div class="text-[11px] font-medium" style="color: var(--dig-faint)">Liquid</div>
          <div class="text-[16px] font-bold tracking-[-0.02em] mt-[3px] tabular-nums">{{ formatUsd(totalPortfolioUsd) }}</div>
        </div>
        <div class="rounded-[12px] px-[13px] py-[11px]" style="background: var(--dig-surface-2); border: 1px solid var(--dig-line-soft)">
          <div class="text-[11px] font-medium" style="color: var(--dig-faint)">DeFi supplied</div>
          <div class="text-[16px] font-bold tracking-[-0.02em] mt-[3px] tabular-nums" style="color: var(--dig-green)">{{ formatUsd(defi.totalSuppliedUsd) }}</div>
        </div>
        <div class="rounded-[12px] px-[13px] py-[11px]" style="background: var(--dig-surface-2); border: 1px solid var(--dig-line-soft)">
          <div class="text-[11px] font-medium" style="color: var(--dig-faint)">DeFi borrowed</div>
          <div class="text-[16px] font-bold tracking-[-0.02em] mt-[3px] tabular-nums" style="color: var(--dig-amber)">{{ formatUsd(defi.totalBorrowedUsd) }}</div>
        </div>
      </div>

      <div class="flex flex-col mt-[6px]">
        <div
          v-for="p in topPositions"
          :key="p.key"
          class="flex items-center gap-[10px] py-[10px]"
          style="border-bottom: 1px solid var(--dig-line-soft)"
        >
          <div class="min-w-0">
            <div class="text-[13px] font-semibold truncate">{{ p.poolName }}</div>
            <div class="text-[11.5px] truncate" style="color: var(--dig-faint)">Blend · {{ p.wallet }}</div>
          </div>
          <div class="ml-auto text-right flex-shrink-0">
            <div class="text-[13px] font-semibold tabular-nums">{{ formatUsd(p.suppliedUsd) }}</div>
            <div class="text-[11.5px] font-bold tabular-nums" :style="{ color: hfDisplay(p.healthFactor).color }">{{ hfDisplay(p.healthFactor).label }}</div>
          </div>
        </div>
      </div>
      <div v-if="positionCount > topPositions.length" class="text-[11.5px] mt-[8px]" style="color: var(--dig-faint)">
        + {{ positionCount - topPositions.length }} more in the portfolio
      </div>
    </template>
  </div>
</template>
