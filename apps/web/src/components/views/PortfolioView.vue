<script setup lang="ts">
// PortfolioView — Lot C (design: Dig Stellar.dc.html PORTFOLIO block).
// Real wallets/overview data. Hard rules that carry over:
//  • liquid total is kept DISTINCT from DeFi supplied/borrowed (never folded
//    into one number),
//  • "Your open positions" = real Blend positions + health factor with the
//    colour risk states,
//  • watch-only vs active-signer badges,
//  • by-wallet / by-position toggle over the same data.
// When nothing is connected it shows an honest connect state.
import { computed, ref } from 'vue'
import { useSharedWallets } from '../../composables/useSharedWallets'
import { useView } from '../../composables/useView'
import { useAppUser } from '../../composables/useAppUser'
import { useModals } from '../../composables/useModals'
import { useConnectFlow } from '../../composables/useConnectFlow'
import { formatUsd } from '../../utils/format'
import type { WalletItem, WalletPositionItem } from '../../types/wallet'
import EmptyPortfolioState from '../common/EmptyPortfolioState.vue'
import GetStartedCard from '../common/GetStartedCard.vue'
import PositionAssetChips from '../common/PositionAssetChips.vue'
import HealthFactorGauge from '../common/HealthFactorGauge.vue'

const { userId } = useAppUser()
const { openPool } = useView()
const { openConnect } = useModals()
const { disconnect } = useConnectFlow()
const {
  wallets,
  defi,
  totalPortfolioUsd,
  overviewLoading,
  isBusy,
  refreshOneWallet,
  selectWallet,
  // Active-signer model management (T2-D1) — ported from WalletSection so the
  // portfolio is the single home for wallet operations.
  setSigner,
  setPrimary,
  toggleActive,
  removeWallet,
  clearWallets,
} = useSharedWallets()

// Per-card management menu (⋯). Only one open at a time.
const menuOpenId = ref<string | null>(null)
function toggleMenu(id: string) {
  menuOpenId.value = menuOpenId.value === id ? null : id
}

async function onSetSigner(w: WalletItem) {
  menuOpenId.value = null
  await setSigner(w)
}
async function onSetPrimary(w: WalletItem) {
  menuOpenId.value = null
  await setPrimary(w)
}
async function onToggleActive(w: WalletItem) {
  menuOpenId.value = null
  await toggleActive(w)
}
async function onDelete(w: WalletItem) {
  menuOpenId.value = null
  if (!window.confirm(`Delete wallet ${w.label || w.address}?`)) return
  await removeWallet(w)
  // Deleting the last wallet ends the session (mirrors the prior WalletSection).
  if (wallets.value.length === 0) {
    disconnect()
    clearWallets()
  }
}

const hasWallets = computed(() => wallets.value.length > 0)

const WALLET_DOTS = ['#63A7FF', '#2E9E63', '#D86A3E', '#7B45D6', '#B98A00', '#159A8C', '#D0522E']
function walletDot(w: WalletItem, i: number): string {
  return w.isActiveSigner ? '#D5FF2F' : WALLET_DOTS[i % WALLET_DOTS.length]
}
function shortAddr(a: string): string {
  return a && a.length > 12 ? `${a.slice(0, 5)}…${a.slice(-5)}` : a
}

// Scope filter: 'all' or a wallet id.
const scope = ref<string>('all')
function toggleScope(id: string) {
  scope.value = scope.value === id ? 'all' : id
}

// by-wallet / by-position view of the same positions.
const viewMode = ref<'position' | 'wallet'>('position')

interface PositionRow {
  key: string
  walletId: string
  wallet: string
  walletDot: string
  poolName: string
  poolSlug: string | null
  suppliedUsd: number
  borrowedUsd: number
  healthFactor: number | null
  legs: WalletPositionItem[] // H6 — per-asset composition, shown as chips
}

const positions = computed<PositionRow[]>(() => {
  const rows: PositionRow[] = []
  wallets.value.forEach((w, i) => {
    if (scope.value !== 'all' && scope.value !== w.id) return
    for (const p of w.pools ?? []) {
      rows.push({
        key: `${w.id}-${p.poolSlug}`,
        walletId: w.id,
        wallet: w.label || 'Wallet',
        walletDot: walletDot(w, i),
        poolName: p.poolName || p.poolSlug || 'Pool',
        poolSlug: p.poolSlug,
        suppliedUsd: p.totalCollateralUsd ?? 0,
        borrowedUsd: p.totalDebtUsd ?? 0,
        healthFactor: p.healthFactor,
        legs: p.positions ?? [],
      })
    }
  })
  return rows.sort((a, b) => b.suppliedUsd - a.suppliedUsd)
})

// Whether ANY tracked wallet has a position, independent of the scope filter.
// Drives the get-started card vs the positions panel so that filtering to an
// empty wallet doesn't resurrect the onboarding card when positions exist elsewhere.
const hasAnyPosition = computed(() =>
  wallets.value.some((w) => (w.pools ?? []).length > 0),
)

// Grouped view (by wallet) — same rows, bucketed.
const grouped = computed(() => {
  const map = new Map<string, { wallet: string; dot: string; rows: PositionRow[] }>()
  for (const r of positions.value) {
    const g = map.get(r.walletId) ?? { wallet: r.wallet, dot: r.walletDot, rows: [] }
    g.rows.push(r)
    map.set(r.walletId, g)
  }
  return [...map.values()]
})

// Breakdown segments (by-position value share).
const breakdown = computed(() => {
  const total = positions.value.reduce((s, p) => s + p.suppliedUsd, 0)
  return {
    total,
    segs: positions.value.map((p, i) => ({
      key: p.key,
      label: p.poolName,
      value: formatUsd(p.suppliedUsd),
      color: WALLET_DOTS[i % WALLET_DOTS.length],
      width: `${total > 0 ? (p.suppliedUsd / total) * 100 : 0}%`,
    })),
  }
})

const scopeTitle = computed(() => {
  if (scope.value === 'all') return 'Positions across all wallets'
  const w = wallets.value.find((x) => x.id === scope.value)
  return w ? `Positions · ${w.label || 'Wallet'}` : 'Positions'
})
</script>

<template>
  <div class="max-w-[1180px] mx-auto px-[26px] py-[26px] flex flex-col gap-[16px]" style="animation: digFade .35s ease both">
    <!-- Empty / connect state (no wallet connected) -->
    <EmptyPortfolioState v-if="!userId || (!hasWallets && !overviewLoading)" @connect="openConnect" />

    <template v-else>
      <!-- Summary: liquid kept distinct from DeFi supplied/borrowed -->
      <div class="grid gap-[16px]" style="grid-template-columns: repeat(4, 1fr)">
        <div class="rounded-[16px] px-[20px] py-[18px]" style="background: var(--dig-surface); border: 1px solid var(--dig-line)">
          <div class="text-[12px] font-medium" style="color: var(--dig-faint)">Liquid balances</div>
          <div class="text-[24px] font-bold tracking-[-0.02em] mt-[6px] tabular-nums">{{ formatUsd(totalPortfolioUsd) }}</div>
          <div class="text-[12px] mt-[4px]" style="color: var(--dig-faint)">{{ wallets.length }} wallets · Mainnet</div>
        </div>
        <div class="rounded-[16px] px-[20px] py-[18px]" style="background: var(--dig-surface); border: 1px solid var(--dig-line)">
          <div class="text-[12px] font-medium" style="color: var(--dig-faint)">DeFi supplied</div>
          <div class="text-[24px] font-bold tracking-[-0.02em] mt-[6px] tabular-nums" style="color: var(--dig-green)">{{ formatUsd(defi.totalSuppliedUsd) }}</div>
          <div class="text-[12px] mt-[4px]" style="color: var(--dig-faint)">Blend</div>
        </div>
        <div class="rounded-[16px] px-[20px] py-[18px]" style="background: var(--dig-surface); border: 1px solid var(--dig-line)">
          <div class="text-[12px] font-medium" style="color: var(--dig-faint)">DeFi borrowed</div>
          <div class="text-[24px] font-bold tracking-[-0.02em] mt-[6px] tabular-nums" style="color: var(--dig-amber)">{{ formatUsd(defi.totalBorrowedUsd) }}</div>
          <div class="text-[12px] mt-[4px]" style="color: var(--dig-faint)">Blend</div>
        </div>
        <div class="rounded-[16px] px-[20px] py-[18px]" style="background: var(--dig-surface); border: 1px solid var(--dig-line)">
          <div class="text-[12px] font-medium" style="color: var(--dig-faint)">Net DeFi</div>
          <div class="text-[24px] font-bold tracking-[-0.02em] mt-[6px] tabular-nums">{{ formatUsd(defi.netDefiUsd) }}</div>
          <div class="text-[12px] mt-[4px]" style="color: var(--dig-faint)">supplied − borrowed</div>
        </div>
      </div>

      <!-- Wallet cards -->
      <div class="dig-scroll flex gap-[16px] overflow-x-auto pb-[4px]">
        <div
          v-for="(w, i) in wallets"
          :key="w.id"
          class="relative flex-shrink-0 w-[240px] rounded-[16px] p-[18px] cursor-pointer"
          :style="{ background: 'var(--dig-surface)', border: `1.5px solid ${scope === w.id ? 'var(--dig-accent)' : 'var(--dig-line)'}` }"
          @click="toggleScope(w.id); selectWallet(w)"
        >
          <div class="flex items-center gap-[9px]">
            <span class="w-[9px] h-[9px] rounded-full" :style="{ background: walletDot(w, i) }"></span>
            <span class="text-[13px] font-semibold truncate">{{ w.label || 'Wallet' }}</span>
            <span class="ml-auto text-[11.5px] font-mono-geist" style="color: var(--dig-faint)">{{ shortAddr(w.address) }}</span>
          </div>
          <div class="text-[26px] font-bold mt-[12px] tracking-[-0.02em] tabular-nums">{{ formatUsd(w.totalPortfolioUsd ?? 0) }}</div>
          <div class="flex items-center gap-[6px] mt-[6px] flex-wrap">
            <span
              v-if="w.isActiveSigner"
              class="text-[10px] font-bold px-[7px] py-[2px] rounded-full"
              style="color: var(--dig-accent); background: rgba(213,255,47,0.1); border: 1px solid rgba(213,255,47,0.3)"
            >Active signer</span>
            <span
              v-else
              class="text-[10px] font-bold px-[7px] py-[2px] rounded-full"
              style="color: var(--dig-faint); background: rgba(154,155,153,0.08); border: 1px solid rgba(154,155,153,0.3)"
            >Watch-only</span>
            <span v-if="w.isPrimary" class="text-[10px] font-bold px-[7px] py-[2px] rounded-full" style="color: var(--dig-accent); background: rgba(213,255,47,0.08)">Primary</span>
            <span v-if="!w.isActive" class="text-[10px] font-bold px-[7px] py-[2px] rounded-full" style="color: var(--dig-amber); background: rgba(201,138,30,0.1)">Inactive</span>
            <div class="ml-auto flex items-center gap-[4px]">
              <button
                type="button"
                class="text-[11px] font-semibold px-[8px] py-[3px] rounded-[7px] cursor-pointer disabled:opacity-50"
                style="color: var(--dig-faint); border: 1px solid var(--dig-line)"
                :disabled="isBusy(w.id)"
                @click.stop="refreshOneWallet(w)"
              >{{ isBusy(w.id) ? '…' : 'Refresh' }}</button>
              <button
                type="button"
                class="w-[26px] h-[24px] flex items-center justify-center rounded-[7px] cursor-pointer disabled:opacity-50"
                style="color: var(--dig-faint); border: 1px solid var(--dig-line)"
                :disabled="isBusy(w.id)"
                title="Manage wallet"
                @click.stop="toggleMenu(w.id)"
              >⋯</button>
            </div>
          </div>

          <!-- management menu (T2-D1 ops: signer / primary / active / delete) -->
          <div
            v-if="menuOpenId === w.id"
            class="absolute right-[14px] top-[64px] z-[20] w-[180px] rounded-[11px] overflow-hidden"
            style="background: var(--dig-surface-2); border: 1px solid var(--dig-line); box-shadow: 0 12px 32px rgba(0,0,0,0.5)"
            @click.stop
          >
            <button v-if="!w.isActiveSigner" type="button" class="dig-row w-full text-left px-[13px] py-[9px] text-[12.5px] cursor-pointer" style="color: var(--dig-text)" :disabled="isBusy(w.id)" @click="onSetSigner(w)">Set as active signer</button>
            <button v-if="!w.isPrimary" type="button" class="dig-row w-full text-left px-[13px] py-[9px] text-[12.5px] cursor-pointer" style="color: var(--dig-text)" :disabled="isBusy(w.id)" @click="onSetPrimary(w)">Set as primary</button>
            <button type="button" class="dig-row w-full text-left px-[13px] py-[9px] text-[12.5px] cursor-pointer" style="color: var(--dig-text)" :disabled="isBusy(w.id)" @click="onToggleActive(w)">{{ w.isActive ? 'Deactivate' : 'Activate' }}</button>
            <button type="button" class="dig-row w-full text-left px-[13px] py-[9px] text-[12.5px] cursor-pointer" style="color: var(--dig-red)" :disabled="isBusy(w.id)" @click="onDelete(w)">Delete wallet</button>
          </div>
        </div>
        <button
          type="button"
          class="dig-card-h flex-shrink-0 w-[150px] rounded-[16px] flex flex-col items-center justify-center gap-[8px] cursor-pointer"
          style="border: 1.5px dashed #34342E; color: var(--dig-faint)"
          @click="openConnect"
        >
          <span class="text-[22px]">+</span>
          <span class="text-[13px] font-semibold">Add wallet</span>
        </button>
      </div>

      <!-- Get-started card: wallet connected, no positions yet. Disappears as
           soon as a position exists (positions.length > 0). -->
      <GetStartedCard v-if="!hasAnyPosition && !overviewLoading" />

      <!-- Breakdown (by-position value share) -->
      <div v-if="breakdown.segs.length" class="rounded-[18px] p-[20px]" style="background: var(--dig-surface); border: 1px solid var(--dig-line)">
        <div class="flex items-baseline justify-between mb-[14px]">
          <div class="text-[14px] font-semibold">Position breakdown</div>
          <div class="text-[20px] font-bold tabular-nums">{{ formatUsd(breakdown.total) }}</div>
        </div>
        <div class="flex h-[14px] rounded-[7px] overflow-hidden" style="background: var(--dig-line-soft)">
          <div v-for="s in breakdown.segs" :key="s.key" :style="{ width: s.width, background: s.color }"></div>
        </div>
        <div class="flex flex-wrap gap-[16px] mt-[16px]">
          <div v-for="s in breakdown.segs" :key="s.key" class="flex items-center gap-[9px]">
            <span class="w-[10px] h-[10px] rounded-[3px]" :style="{ background: s.color }"></span>
            <div>
              <div class="text-[13px] font-semibold">{{ s.label }}</div>
              <div class="text-[11.5px]" style="color: var(--dig-faint)">{{ s.value }}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Your open positions (only once there is at least one; the get-started
           card above stands in for the empty state) -->
      <div v-if="hasAnyPosition" class="rounded-[18px] overflow-hidden" style="background: var(--dig-surface); border: 1px solid var(--dig-line)">
        <div class="flex items-center px-[20px] py-[16px] gap-[12px] flex-wrap" style="border-bottom: 1px solid var(--dig-line-soft)">
          <div class="text-[14px] font-semibold">{{ scopeTitle }}</div>
          <span class="text-[12px]" style="color: var(--dig-faint)">{{ positions.length }} positions</span>
          <div class="ml-auto flex gap-[4px] rounded-[11px] p-[3px]" style="background: var(--dig-surface-2)">
            <button
              v-for="m in (['position','wallet'] as const)"
              :key="m"
              type="button"
              class="text-[12.5px] font-semibold px-[12px] py-[6px] rounded-[9px] cursor-pointer capitalize"
              :style="{ color: viewMode === m ? '#141414' : 'var(--dig-faint)', background: viewMode === m ? 'var(--dig-accent)' : 'transparent' }"
              @click="viewMode = m"
            >By {{ m }}</button>
          </div>
        </div>

        <div v-if="!positions.length" class="px-[20px] py-[28px] text-center text-[13px]" style="color: var(--dig-faint)">
          No Blend positions across {{ scope === 'all' ? 'your tracked wallets' : 'this wallet' }}.
        </div>

        <!-- by position (flat) -->
        <template v-else-if="viewMode === 'position'">
          <div class="grid px-[20px] py-[11px] text-[11px] font-semibold uppercase tracking-[0.04em]" style="grid-template-columns: 2fr 1.3fr 1fr 1fr 90px; color: var(--dig-faint); border-bottom: 1px solid var(--dig-line-soft)">
            <div>Position</div><div>Wallet</div><div class="text-right">Supplied</div><div class="text-right">Health</div><div></div>
          </div>
          <div v-for="p in positions" :key="p.key" class="dig-row px-[20px] py-[13px]" style="border-bottom: 1px solid var(--dig-line-soft)">
            <div class="grid items-center" style="grid-template-columns: 2fr 1.3fr 1fr 1fr 90px">
              <div class="text-[14px] font-semibold truncate">{{ p.poolName }}</div>
              <div class="flex items-center gap-[7px] text-[13px]" style="color: var(--dig-faint)"><span class="w-[7px] h-[7px] rounded-full" :style="{ background: p.walletDot }"></span>{{ p.wallet }}</div>
              <div class="text-right text-[14px] font-semibold tabular-nums">{{ formatUsd(p.suppliedUsd) }}</div>
              <div class="flex justify-end"><HealthFactorGauge :health-factor="p.healthFactor" /></div>
              <div class="text-right"><button type="button" class="dig-chip text-[12px] font-semibold cursor-pointer px-[10px] py-[5px] rounded-[8px]" style="color: var(--dig-text)" :disabled="!p.poolSlug" @click="p.poolSlug && openPool(p.poolSlug)">Manage</button></div>
            </div>
            <!-- H6: what the USD figures are actually made of -->
            <PositionAssetChips :positions="p.legs" class="mt-[9px]" />
          </div>
        </template>

        <!-- by wallet (grouped) -->
        <template v-else>
          <div v-for="g in grouped" :key="g.wallet">
            <div class="flex items-center gap-[8px] px-[20px] py-[10px] text-[12px] font-semibold" style="background: var(--dig-surface-2)">
              <span class="w-[8px] h-[8px] rounded-full" :style="{ background: g.dot }"></span>{{ g.wallet }}
            </div>
            <div v-for="p in g.rows" :key="p.key" class="dig-row px-[20px] py-[13px]" style="border-bottom: 1px solid var(--dig-line-soft)">
              <div class="grid items-center" style="grid-template-columns: 2fr 1fr 1fr 90px">
                <div class="text-[14px] font-semibold truncate">{{ p.poolName }}</div>
                <div class="text-right text-[14px] font-semibold tabular-nums">{{ formatUsd(p.suppliedUsd) }}</div>
                <div class="flex justify-end"><HealthFactorGauge :health-factor="p.healthFactor" /></div>
                <div class="text-right"><button type="button" class="dig-chip text-[12px] font-semibold cursor-pointer px-[10px] py-[5px] rounded-[8px]" style="color: var(--dig-text)" :disabled="!p.poolSlug" @click="p.poolSlug && openPool(p.poolSlug)">Manage</button></div>
              </div>
              <!-- H6: what the USD figures are actually made of -->
              <PositionAssetChips :positions="p.legs" class="mt-[9px]" />
            </div>
          </div>
        </template>
      </div>
    </template>
  </div>
</template>
