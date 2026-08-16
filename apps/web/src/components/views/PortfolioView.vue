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
import {
  displaySymbol,
  formatTokenAmountCompact,
  formatTokenAmountExact,
  formatUsd,
  shortAddress,
} from '../../utils/format'
import type { WalletItem, WalletPositionItem } from '../../types/wallet'
import EmptyPortfolioState from '../common/EmptyPortfolioState.vue'
import GetStartedCard from '../common/GetStartedCard.vue'
import PositionAssetChips from '../common/PositionAssetChips.vue'
import HealthFactorGauge from '../common/HealthFactorGauge.vue'
import BrandLogo from '../common/BrandLogo.vue'

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
  renameWallet,
  removeWallet,
  clearWallets,
} = useSharedWallets()

// W2 — the label fallback everywhere a label may be empty: the short address,
// never the literal 'Wallet'.
function walletLabel(w: WalletItem): string {
  return w.label || shortAddress(w.address)
}

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
// W2 — inline rename from the card (opened from the ⋯ menu).
const renamingId = ref<string | null>(null)
const renameValue = ref('')
function startRename(w: WalletItem) {
  menuOpenId.value = null
  renamingId.value = w.id
  renameValue.value = w.label || ''
}
function cancelRename() {
  renamingId.value = null
}
async function commitRename(w: WalletItem) {
  if (renamingId.value !== w.id) return
  renamingId.value = null
  const next = renameValue.value.trim()
  if (next === (w.label || '')) return
  await renameWallet(w, next || null)
}

async function onDelete(w: WalletItem) {
  menuOpenId.value = null
  if (!window.confirm(`Delete wallet ${walletLabel(w)}?`)) return
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
        wallet: walletLabel(w),
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
  return w ? `Positions · ${walletLabel(w)}` : 'Positions'
})

// ── W3: Assets — what the wallets HOLD (liquid; kept DISTINCT from DeFi) ─────
// Aggregated across wallets by asset from the per-wallet balance snapshots the
// overview already loads (no new fetch). Honest USD: unpriced assets show "—",
// never $0 — but their AMOUNTS still render and nothing is dropped.
const ASSET_DUST_USD = 1 // visual-only grouping threshold ("Other"), never a filter

interface AssetLeg {
  walletId: string
  wallet: string
  dot: string
  amount: number
  usd: number | null
}
interface AssetRow {
  key: string
  symbol: string
  amount: number
  usd: number | null // null = unpriced
  share: number // 0..1 of the priced total (share bar)
  color: string
  legs: AssetLeg[]
}

const expandedAssets = ref<Set<string>>(new Set())
function toggleAsset(key: string) {
  const next = new Set(expandedAssets.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  expandedAssets.value = next
}

const assetsView = computed(() => {
  // Respects the wallet scope filter like the positions do: scoped → ONLY that
  // wallet's balances, and the total/assert target is THAT wallet's figure.
  const scoped = scope.value !== 'all'
  const map = new Map<
    string,
    { symbol: string; amount: number; usd: number; priced: boolean; legs: AssetLeg[] }
  >()
  wallets.value.forEach((w, i) => {
    if (scoped && w.id !== scope.value) return
    for (const b of w.balances ?? []) {
      const key = b.assetContractId || b.symbol || b.id
      const g =
        map.get(key) ??
        { symbol: displaySymbol(b.symbol), amount: 0, usd: 0, priced: false, legs: [] }
      const amount = b.balance ?? 0
      const usd = b.balanceUsd ?? null
      g.amount += amount
      if (usd !== null) {
        g.usd += usd
        g.priced = true
      }
      g.legs.push({
        walletId: w.id,
        wallet: walletLabel(w),
        dot: walletDot(w, i),
        amount,
        usd,
      })
      map.set(key, g)
    }
  })

  const all: AssetRow[] = [...map.entries()].map(([key, g], i) => ({
    key,
    symbol: g.symbol,
    amount: g.amount,
    usd: g.priced ? g.usd : null,
    share: 0,
    color: WALLET_DOTS[i % WALLET_DOTS.length],
    legs: g.legs.sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0) || b.amount - a.amount),
  }))

  const pricedSum = all.reduce((s, a) => s + (a.usd ?? 0), 0)
  for (const a of all) a.share = pricedSum > 0 && a.usd !== null ? a.usd / pricedSum : 0

  // The section total IS the liquid figure for the current scope (same source —
  // asserted, not recomputed): global hero figure on 'all', the scoped wallet's
  // own totalPortfolioUsd otherwise. Both sum the same latest balance snapshots.
  const scopeWallet = scoped
    ? wallets.value.find((w) => w.id === scope.value) ?? null
    : null
  const totalUsd = scoped
    ? scopeWallet?.totalPortfolioUsd ?? 0
    : totalPortfolioUsd.value
  if (Math.abs(pricedSum - totalUsd) > 0.01) {
    console.warn('[portfolio-assets] asset sum drifted from the scope liquid figure', {
      pricedSum,
      scopeLiquid: totalUsd,
      scope: scope.value,
    })
  }

  all.sort((a, b) => (b.usd ?? -1) - (a.usd ?? -1) || b.amount - a.amount)

  // Dust: PRICED assets under the threshold group visually under "Other" —
  // still counted in the total above. Unpriced assets stay as visible rows.
  const main = all.filter((a) => a.usd === null || a.usd >= ASSET_DUST_USD)
  const dust = all.filter((a) => a.usd !== null && a.usd < ASSET_DUST_USD)
  const other =
    dust.length > 0
      ? {
          usd: dust.reduce((s, a) => s + (a.usd ?? 0), 0),
          share: dust.reduce((s, a) => s + a.share, 0),
          rows: dust,
        }
      : null

  return {
    rows: main,
    other,
    hasAny: all.length > 0,
    scoped,
    totalUsd,
    title: scopeWallet ? `Assets · ${walletLabel(scopeWallet)}` : 'Assets',
  }
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
            <!-- W2: inline rename (from the ⋯ menu) -->
            <input
              v-if="renamingId === w.id"
              v-model="renameValue"
              autofocus
              placeholder="Label"
              class="flex-1 min-w-0 h-[26px] px-[8px] rounded-[8px] text-[13px] font-semibold outline-none"
              style="border: 1px solid var(--dig-accent); background: var(--dig-surface-2); color: var(--dig-text)"
              @click.stop
              @keydown.enter.prevent="commitRename(w)"
              @keydown.esc="cancelRename"
              @blur="commitRename(w)"
            />
            <span v-else class="text-[13px] font-semibold truncate">{{ walletLabel(w) }}</span>
            <span v-if="renamingId !== w.id" class="ml-auto text-[11.5px] font-mono-geist" style="color: var(--dig-faint)">{{ shortAddress(w.address) }}</span>
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
            <button type="button" class="dig-row w-full text-left px-[13px] py-[9px] text-[12.5px] cursor-pointer" style="color: var(--dig-text)" :disabled="isBusy(w.id)" @click="startRename(w)">Rename</button>
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

      <!-- W3: Assets — what the wallets hold (liquid; distinct from DeFi).
           Total = the SAME hero liquid figure (asserted in assetsView). -->
      <div v-if="assetsView.hasAny" class="rounded-[18px] p-[20px]" style="background: var(--dig-surface); border: 1px solid var(--dig-line)">
        <div class="flex items-baseline justify-between mb-[14px]">
          <div class="text-[14px] font-semibold">{{ assetsView.title }}</div>
          <div class="text-[20px] font-bold tabular-nums">{{ formatUsd(assetsView.totalUsd) }}</div>
        </div>

        <!-- share bar (priced assets only; dust grouped as one segment) -->
        <div class="flex h-[14px] rounded-[7px] overflow-hidden" style="background: var(--dig-line-soft)">
          <div
            v-for="a in assetsView.rows.filter((r) => r.share > 0)"
            :key="a.key"
            :style="{ width: `${a.share * 100}%`, background: a.color }"
          ></div>
          <div v-if="assetsView.other" :style="{ width: `${assetsView.other.share * 100}%`, background: 'var(--dig-faint)' }"></div>
        </div>

        <!-- one row per asset; click → per-wallet detail -->
        <div class="mt-[12px]">
          <div v-for="a in assetsView.rows" :key="a.key">
            <div
              class="dig-row flex items-center gap-[11px] py-[10px]"
              :class="{ 'cursor-pointer': !assetsView.scoped }"
              style="border-bottom: 1px solid var(--dig-line-soft)"
              @click="!assetsView.scoped && toggleAsset(a.key)"
            >
              <BrandLogo variant="asset" :primary="null" :letter="(a.symbol || '•').charAt(0).toUpperCase()" tint="#242422" color="#B7B3AB" :size="26" :font-size="12" />
              <span class="text-[13.5px] font-semibold">{{ a.symbol }}</span>
              <span class="text-[13px] tabular-nums" style="color: var(--dig-faint)" :title="formatTokenAmountExact(a.amount)">{{ formatTokenAmountCompact(a.amount) }}</span>
              <span class="ml-auto text-[13.5px] font-semibold tabular-nums">{{ a.usd === null ? '—' : formatUsd(a.usd) }}</span>
              <span class="w-[44px] text-right text-[11.5px] tabular-nums" style="color: var(--dig-faint)">{{ a.share > 0 ? `${(a.share * 100).toFixed(1)}%` : '' }}</span>
              <!-- scoped to one wallet → per-wallet expansion is redundant -->
              <span v-if="!assetsView.scoped" class="text-[11px]" style="color: var(--dig-faint)">{{ expandedAssets.has(a.key) ? '▾' : '▸' }}</span>
            </div>
            <!-- per-wallet detail (which wallet holds how much) -->
            <div v-if="!assetsView.scoped && expandedAssets.has(a.key)" style="border-bottom: 1px solid var(--dig-line-soft)">
              <div
                v-for="leg in a.legs"
                :key="`${a.key}-${leg.walletId}`"
                class="flex items-center gap-[9px] py-[7px] pl-[37px] pr-[2px]"
              >
                <span class="w-[7px] h-[7px] rounded-full flex-shrink-0" :style="{ background: leg.dot }"></span>
                <span class="text-[12.5px] truncate" style="color: var(--dig-faint)">{{ leg.wallet }}</span>
                <span class="ml-auto text-[12.5px] tabular-nums" :title="formatTokenAmountExact(leg.amount)">{{ formatTokenAmountCompact(leg.amount) }}</span>
                <span class="w-[90px] text-right text-[12.5px] tabular-nums" style="color: var(--dig-faint)">{{ leg.usd === null ? '—' : formatUsd(leg.usd) }}</span>
              </div>
            </div>
          </div>

          <!-- dust, grouped visually — never dropped from the total above -->
          <div v-if="assetsView.other">
            <div
              class="dig-row flex items-center gap-[11px] py-[10px] cursor-pointer"
              style="border-bottom: 1px solid var(--dig-line-soft)"
              @click="toggleAsset('__other__')"
            >
              <BrandLogo variant="asset" :primary="null" letter="·" tint="#242422" color="#B7B3AB" :size="26" :font-size="12" />
              <span class="text-[13.5px] font-semibold" style="color: var(--dig-faint)">Other</span>
              <span class="text-[12px]" style="color: var(--dig-faint)">{{ assetsView.other.rows.length }} small balances</span>
              <span class="ml-auto text-[13.5px] font-semibold tabular-nums">{{ formatUsd(assetsView.other.usd) }}</span>
              <span class="w-[44px] text-right text-[11.5px] tabular-nums" style="color: var(--dig-faint)">{{ assetsView.other.share > 0 ? `${(assetsView.other.share * 100).toFixed(1)}%` : '' }}</span>
              <span class="text-[11px]" style="color: var(--dig-faint)">{{ expandedAssets.has('__other__') ? '▾' : '▸' }}</span>
            </div>
            <div v-if="expandedAssets.has('__other__')" style="border-bottom: 1px solid var(--dig-line-soft)">
              <div
                v-for="a in assetsView.other.rows"
                :key="a.key"
                class="flex items-center gap-[9px] py-[7px] pl-[37px] pr-[2px]"
              >
                <span class="text-[12.5px]" style="color: var(--dig-faint)">{{ a.symbol }}</span>
                <span class="ml-auto text-[12.5px] tabular-nums" :title="formatTokenAmountExact(a.amount)">{{ formatTokenAmountCompact(a.amount) }}</span>
                <span class="w-[90px] text-right text-[12.5px] tabular-nums" style="color: var(--dig-faint)">{{ a.usd === null ? '—' : formatUsd(a.usd) }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

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
