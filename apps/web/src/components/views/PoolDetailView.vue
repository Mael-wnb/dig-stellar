<script setup lang="ts">
// PoolDetailView — Lot C (design: Dig Stellar.dc.html POOL DETAIL block).
// The richest view. Everything here is REAL or an honest empty/stale state:
//  • type-variant stat strip (lending / AMM / native / vault) — carries over the
//    existing honest per-type logic, no AMM boilerplate on Blend/DeFindex;
//  • TVL & volume 30d: no real USD time-series exists in the DB (see Lot C DB
//    check) → honest "building history" note, never a synthesized curve;
//  • Inflows & outflows: real /v1/pools/:slug/flows aggregation, section hidden
//    when the pool has no deposit/withdraw event coverage;
//  • On-chain info + reserves + reserves-&-rates table: real;
//  • Your position: Blend-only, only when tracked wallets hold a position;
//  • Risk signals: only rows that are cheaply real (freshness + Blend util).
import { computed } from 'vue'
import { usePoolDetail, type FlowWindow } from '../../composables/usePoolDetail'
import { useView } from '../../composables/useView'
import { useSharedWallets } from '../../composables/useSharedWallets'
import { useModals } from '../../composables/useModals'
import { venueTheme } from '../../data/venueTheme'
import BrandLogo from '../common/BrandLogo.vue'
import {
  displayPoolName,
  displaySymbol,
  formatCount,
  formatUsd,
} from '../../utils/format'
import type { PoolDetailData } from '../../types/protocol'

const { setView } = useView()
const { openAction: openActionModal, requestAlert } = useModals()
const { pool, flows, series, flowWindow, loading, flowsLoading, error, setFlowWindow, reload } =
  usePoolDetail()

// Shared wallets instance — the "Your position" card (Blend-only) reads the
// user's positions without re-fetching (loaded once by useSharedWallets).
const { wallets } = useSharedWallets()

const theme = computed(() => venueTheme(pool.value?.protocol?.id))

const isLending = computed(() => pool.value?.type === 'lending_pool')
const isVault = computed(() => pool.value?.type === 'yield_vault')
const isNative = computed(() => pool.value?.protocol?.id === 'stellar-native')
const isAmm = computed(() => !isLending.value && !isVault.value)

function pct(v?: number | null): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  return `${(v * 100).toFixed(2)}%`
}

function typeLabel(t?: string | null): string {
  if (t === 'amm_pool') return 'AMM'
  if (t === 'lending_pool') return 'Lending market'
  if (t === 'yield_vault') return 'Yield vault'
  return t ?? '—'
}

function underlyingSymbol(p: PoolDetailData): string | null {
  const m = p.name?.match(/\(([A-Za-z0-9]+)\)\s*$/)
  return m ? m[1] : null
}

const pairName = computed(() =>
  pool.value ? displayPoolName(pool.value.name) : '',
)

// ── stat strip (type-variant) ───────────────────────────────────────────────
const stats = computed(() => {
  const p = pool.value
  if (!p) return []
  const m = p.metrics
  if (isLending.value) {
    return [
      { label: 'Liquidity', value: formatUsd(m.netLiquidityUsd), color: 'var(--dig-text)' },
      { label: 'Total supplied', value: formatUsd(m.totalSuppliedUsd), color: 'var(--dig-text)' },
      { label: 'Supply APY', value: pct(m.supplyApy), color: 'var(--dig-green)' },
      { label: 'Borrow APY', value: pct(m.borrowApy), color: 'var(--dig-red)' },
    ]
  }
  if (isVault.value) {
    return [
      { label: 'TVL', value: formatUsd(m.tvlUsd), color: 'var(--dig-text)' },
      { label: 'Supply APY', value: pct(m.supplyApy), color: 'var(--dig-green)' },
      { label: 'Underlying', value: displaySymbol(underlyingSymbol(p) ?? undefined), color: 'var(--dig-text)' },
      { label: 'Strategy', value: 'Auto-compound', color: 'var(--dig-text)' },
    ]
  }
  if (isNative.value) {
    return [
      { label: 'TVL', value: formatUsd(m.tvlUsd), color: 'var(--dig-text)' },
      { label: 'Volume 24h', value: formatUsd(m.volume24hUsd), color: 'var(--dig-text)' },
      { label: 'Fees 24h', value: formatUsd(m.fees24hUsd), color: 'var(--dig-green)' },
      { label: 'Trades 24h', value: formatCount(m.trades24h), color: 'var(--dig-text)' },
    ]
  }
  return [
    { label: 'TVL', value: formatUsd(m.tvlUsd), color: 'var(--dig-text)' },
    { label: 'Volume 24h', value: formatUsd(m.volume24hUsd), color: 'var(--dig-text)' },
    { label: 'Fees 24h', value: formatUsd(m.fees24hUsd), color: 'var(--dig-green)' },
    { label: 'Swaps 24h', value: formatCount(m.swaps24h), color: 'var(--dig-text)' },
    { label: 'Events 24h', value: formatCount(m.events24h), color: 'var(--dig-faint)' },
  ]
})

const description = computed(() => {
  const p = pool.value
  if (!p) return ''
  if (isVault.value) {
    const u = underlyingSymbol(p)
    const asset = u ? displaySymbol(u) : 'a single asset'
    return `This DeFindex yield vault auto-compounds ${asset} into underlying Soroban strategies. Depositors earn a variable APY as the vault's share price grows — it does not swap or borrow, so it has no 24h volume or fees.`
  }
  if (isLending.value) {
    return "This lending pool lets users supply and borrow assets on Stellar's Soroban smart-contract platform. Interest rates adjust dynamically based on utilization."
  }
  if (isNative.value) {
    return 'This AMM pool provides decentralized token swaps on the Stellar native DEX (classic liquidity pools via Horizon). Liquidity providers earn fees proportional to their share of the pool.'
  }
  return 'This AMM pool provides decentralized token swaps on Stellar. Liquidity providers earn fees proportional to their share of the pool.'
})

// ── on-chain info ────────────────────────────────────────────────────────────
function shortAddr(a?: string | null): string {
  if (!a) return '—'
  return a.length <= 14 ? a : `${a.slice(0, 6)}…${a.slice(-4)}`
}

const explorerUrl = computed(() => {
  const p = pool.value
  if (!p?.contractAddress) return null
  const base = 'https://stellar.expert/explorer/public'
  return isNative.value
    ? `${base}/liquidity-pool/${p.contractAddress}`
    : `${base}/contract/${p.contractAddress}`
})

function formatDate(v?: string | null): string {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime())
    ? v
    : d.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
}

const onchain = computed(() => {
  const p = pool.value
  if (!p) return []
  return [
    { label: 'Protocol', value: p.protocol?.name ?? '—', mono: false },
    { label: 'Type', value: typeLabel(p.type), mono: false },
    { label: 'Chain', value: p.chain ?? '—', mono: false },
    { label: 'Contract', value: shortAddr(p.contractAddress), mono: true },
    { label: 'Updated', value: formatDate(p.updatedAt), mono: false },
  ]
})

// ── freshness (real) ─────────────────────────────────────────────────────────
function ageLabel(sec?: number | null): string {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return ''
  if (sec < 60) return `${Math.round(sec)}s`
  if (sec < 3600) return `${Math.round(sec / 60)}m`
  if (sec < 86400) return `${Math.round(sec / 3600)}h`
  return `${Math.round(sec / 86400)}d`
}

const freshness = computed(() => {
  const p = pool.value
  if (!p) return { label: '—', color: 'var(--dig-faint)' }
  const age = ageLabel(p.ageSeconds)
  if (p.isStale) {
    return { label: age ? `Stale · ${age}` : 'Stale', color: 'var(--dig-amber)' }
  }
  return { label: age ? `Fresh · ${age}` : 'Fresh', color: 'var(--dig-green)' }
})

// ── reserves breakdown bars (AMM) ────────────────────────────────────────────
const reserveBars = computed(() => {
  const p = pool.value
  if (!p || !isAmm.value || !p.tokens?.length) return []
  const total = p.tokens.reduce((s, t) => s + (t.reserveUsd ?? 0), 0)
  return p.tokens.map((t) => {
    const usd = t.reserveUsd ?? 0
    const share = total > 0 ? (usd / total) * 100 : 0
    return {
      symbol: displaySymbol(t.symbol),
      logoUrl: t.logoUrl ?? null,
      amount: formatUsd(usd),
      pct: `${share.toFixed(0)}%`,
      width: `${share.toFixed(2)}%`,
    }
  })
})

// ── risk signals (only rows that are cheaply real) ───────────────────────────
const risks = computed(() => {
  const p = pool.value
  if (!p) return []
  const rows: Array<{ label: string; value: string; color: string }> = []

  // Data freshness — always real (Lot B).
  rows.push({ label: 'Data freshness', value: freshness.value.label, color: freshness.value.color })

  // Utilization — real for Blend (borrowed / supplied). Omitted elsewhere.
  if (isLending.value) {
    const sup = p.metrics.totalSuppliedUsd ?? 0
    const bor = p.metrics.totalBorrowedUsd ?? 0
    if (sup > 0) {
      const util = (bor / sup) * 100
      const color =
        util >= 90 ? 'var(--dig-red)' : util >= 80 ? 'var(--dig-amber)' : 'var(--dig-green)'
      const state = util >= 90 ? 'High' : util >= 80 ? 'Elevated' : 'Healthy'
      rows.push({ label: 'Utilization', value: `${util.toFixed(0)}% · ${state}`, color })
    }
  }
  // Oracle / trustline flags intentionally omitted — not cheaply real (never
  // rendered as decoration).
  return rows
})

// ── your position (Blend-only, real) ─────────────────────────────────────────
const myPosition = computed(() => {
  const p = pool.value
  if (!p || !isLending.value) return null
  const matches = wallets.value
    .flatMap((w) => w.pools ?? [])
    .filter((pos) => pos.poolSlug && pos.poolSlug === p.id)
  if (!matches.length) return null
  const supplied = matches.reduce((s, m) => s + (m.totalCollateralUsd ?? 0), 0)
  const borrowed = matches.reduce((s, m) => s + (m.totalDebtUsd ?? 0), 0)
  const hfs = matches
    .map((m) => m.healthFactor)
    .filter((h): h is number => h !== null && Number.isFinite(h))
  const hf = hfs.length ? Math.min(...hfs) : null
  return { supplied, borrowed, hf }
})

function hfColor(hf: number | null): string {
  if (hf === null) return 'var(--dig-faint)'
  if (hf >= 1.5) return 'var(--dig-green)'
  if (hf >= 1.2) return 'var(--dig-amber)'
  return 'var(--dig-red)'
}

// ── inflows & outflows chart (real series) ───────────────────────────────────
const FLOW_RANGES: FlowWindow[] = ['24h', '7d', '30d']

const flowChart = computed(() => {
  const f = flows.value
  if (!f || !f.covered) return { hasData: false, svg: '' }
  const s = f.series
  const hasData = s.some((d) => d.inflowUsd > 0 || d.outflowUsd > 0)
  if (!hasData) return { hasData: false, svg: '' }

  const w = 700
  const h = 190
  const n = s.length
  const bw = w / n
  const mid = h * 0.55
  const maxBar = Math.max(1, ...s.map((d) => Math.max(d.inflowUsd, d.outflowUsd)))
  const nets = s.map((d) => d.cumulativeNetUsd)
  const mn = Math.min(...nets, 0)
  const mx = Math.max(...nets, 0)
  const rng = mx - mn || 1

  let bars = ''
  s.forEach((d, i) => {
    const x = (i * bw + 3).toFixed(1)
    const bwF = (bw - 6).toFixed(1)
    const inH = (d.inflowUsd / maxBar) * (mid - 10)
    const outH = (d.outflowUsd / maxBar) * (h - mid - 10)
    bars += `<rect x="${x}" y="${(mid - inH).toFixed(1)}" width="${bwF}" height="${inH.toFixed(1)}" rx="2.5" fill="#B8E640"/>`
    bars += `<rect x="${x}" y="${mid.toFixed(1)}" width="${bwF}" height="${outH.toFixed(1)}" rx="2.5" fill="#4C4C46"/>`
  })
  const step = w / (n > 1 ? n - 1 : 1)
  const line = nets
    .map((p, i) => `${(i * step).toFixed(1)},${(h - 12 - ((p - mn) / rng) * (h - 26)).toFixed(1)}`)
    .join(' ')
  const svg = `<svg width="100%" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><line x1="0" y1="${mid}" x2="${w}" y2="${mid}" stroke="#37372F" stroke-width="1" stroke-dasharray="4 5"/>${bars}<polyline points="${line}" fill="none" stroke="#E2E6E1" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`
  return { hasData: true, svg }
})

const flowStatTiles = computed(() => {
  const f = flows.value
  if (!f) return []
  return [
    { label: `Net · ${f.window}`, value: signedUsd(f.totals.netUsd), color: f.totals.netUsd >= 0 ? 'var(--dig-green)' : 'var(--dig-red)', tint: f.totals.netUsd >= 0 ? '#12301F' : '#371C16', up: f.totals.netUsd >= 0 },
    { label: 'Total inflow', value: formatUsd(f.totals.inflowUsd), color: 'var(--dig-green)', tint: '#12301F', up: true },
    { label: 'Total outflow', value: formatUsd(f.totals.outflowUsd), color: 'var(--dig-red)', tint: '#371C16', up: false },
  ]
})

function signedUsd(v: number): string {
  const s = formatUsd(Math.abs(v))
  return `${v >= 0 ? '+' : '−'}${s}`
}

// History-since date for the honest note (earliest we can cite).
const historySince = computed(() => {
  const p = pool.value
  if (!p?.updatedAt) return null
  return formatDate(p.updatedAt)
})

// TVL history chart (Blend-only, real reserve-snapshot reconstruction). null →
// the card falls back to the honest "building history" note.
function dayLabel(d?: string | null): string {
  if (!d) return ''
  const dt = new Date(d)
  return Number.isNaN(dt.getTime())
    ? d
    : dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

const tvlChart = computed(() => {
  const s = series.value
  if (!s || !s.covered || s.points.length < 2) return null
  const vals = s.points.map((p) => p.tvlUsd)
  const w = 700
  const h = 170
  const min = Math.min(...vals)
  const max = Math.max(...vals)
  const rng = max - min || 1
  const n = vals.length
  const step = w / (n - 1)
  const line = vals
    .map((v, i) => `${(i * step).toFixed(1)},${(h - 8 - ((v - min) / rng) * (h - 24)).toFixed(1)}`)
    .join(' ')
  const area = `0,${h} ${line} ${w},${h}`
  const svg = `<svg width="100%" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><defs><linearGradient id="tvlGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#D5FF2F" stop-opacity="0.22"/><stop offset="1" stop-color="#D5FF2F" stop-opacity="0"/></linearGradient></defs><polygon points="${area}" fill="url(#tvlGrad)"/><polyline points="${line}" fill="none" stroke="#E2E6E1" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`
  return {
    svg,
    minLabel: formatUsd(min),
    maxLabel: formatUsd(max),
    first: dayLabel(s.first),
    last: dayLabel(s.last),
    count: n,
  }
})

const tvlCardTitle = computed(() =>
  tvlChart.value ? 'TVL · on-chain history' : 'TVL & volume · 30d',
)

// The real action flow: lending → Blend deposit, AMM → SDEX swap. DeFindex
// vaults have no swap/deposit widget yet, so their action is disabled ("soon").
const actionKind = computed<'lending' | 'amm' | null>(() =>
  isLending.value ? 'lending' : isVault.value ? null : 'amm',
)
const actionEnabled = computed(() => actionKind.value !== null)

const actionLabel = computed(() =>
  isLending.value ? 'Supply / Withdraw' : isVault.value ? 'Deposit' : 'Swap / Provide',
)

// Create-alert modal is owned by the alerts view (its useAlerts instance holds
// the create logic); request it, then navigate there.
function openAlert() {
  requestAlert()
  setView('alerts')
}

function openAction() {
  const p = pool.value
  if (!p || !actionKind.value) return
  openActionModal({
    slug: p.id,
    name: pairName.value,
    venue: p.protocol?.name ?? '',
    kind: actionKind.value,
  })
}
</script>

<template>
  <div class="max-w-[1180px] mx-auto px-[26px] py-[26px]" style="animation: digFade .35s ease both">
    <!-- Loading -->
    <div v-if="loading" class="rounded-[18px] p-[40px] text-center" style="background: var(--dig-surface); border: 1px solid var(--dig-line)">
      <span class="text-[13px]" style="color: var(--dig-faint)">Loading pool…</span>
    </div>

    <!-- Error -->
    <div v-else-if="error || !pool" class="rounded-[18px] p-[40px] text-center flex flex-col items-center gap-[12px]" style="background: var(--dig-surface); border: 1px solid var(--dig-line)">
      <span class="text-[13px]" style="color: var(--dig-red)">{{ error ? `Couldn't load this pool · ${error}` : 'Pool not found.' }}</span>
      <button v-if="error" type="button" class="dig-ghost h-[36px] px-[16px] rounded-[10px] text-[13px] font-semibold cursor-pointer" style="background: var(--dig-surface-3); border: 1px solid var(--dig-line); color: var(--dig-text)" @click="reload">Retry</button>
    </div>

    <template v-else>
      <!-- Back -->
      <button
        type="button"
        class="dig-chip inline-flex items-center gap-[6px] text-[13px] font-medium cursor-pointer px-[8px] py-[4px] rounded-[8px] mb-[14px] -ml-[8px]"
        style="color: var(--dig-faint)"
        @click="setView('protocols')"
      >
        ← Back to pools
      </button>

      <div class="grid grid-cols-[1.6fr_1fr] gap-[16px] max-lg:grid-cols-1">
        <!-- LEFT COLUMN -->
        <div class="flex flex-col gap-[16px] min-w-0">
          <!-- Header card -->
          <div class="rounded-[18px] p-[24px]" style="background: var(--dig-surface); border: 1px solid var(--dig-line)">
            <div class="flex items-center gap-[14px] flex-wrap">
              <BrandLogo :primary="pool.protocol?.logoUrl" :fallback="theme.logo" :letter="theme.letter" :tint="theme.tint" :color="theme.color" :size="46" :radius="13" :font-size="19" :img-scale="0.6" />
              <div class="min-w-0">
                <div class="text-[22px] font-bold tracking-[-0.02em] truncate">{{ pairName }}</div>
                <div class="text-[13px]" style="color: var(--dig-faint)">
                  {{ pool.protocol?.name }} · {{ typeLabel(pool.type) }}
                </div>
              </div>
              <div class="ml-auto flex gap-[8px]">
                <button
                  type="button"
                  class="dig-ghost h-[40px] px-[15px] rounded-[11px] text-[13px] font-semibold cursor-pointer flex items-center gap-[7px]"
                  style="background: var(--dig-surface-3); border: 1px solid var(--dig-line); color: var(--dig-faint)"
                  @click="openAlert"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"></path></svg>
                  Alert
                </button>
                <button
                  type="button"
                  class="dig-btn h-[40px] px-[18px] rounded-[11px] text-[13px] font-bold"
                  :class="actionEnabled ? 'cursor-pointer' : 'cursor-not-allowed'"
                  style="background: var(--dig-accent); color: #252525; border: none"
                  :style="{ opacity: actionEnabled ? 1 : 0.5 }"
                  :disabled="!actionEnabled"
                  :title="actionEnabled ? '' : 'Vault deposits arrive in a later update'"
                  @click="openAction"
                >
                  {{ actionLabel }}
                </button>
              </div>
            </div>

            <!-- stat strip -->
            <div
              class="flex gap-[34px] mt-[22px] pt-[20px] flex-wrap"
              style="border-top: 1px solid var(--dig-line-soft)"
            >
              <div v-for="s in stats" :key="s.label">
                <div class="text-[12px]" style="color: var(--dig-faint)">{{ s.label }}</div>
                <div class="text-[20px] font-bold mt-[3px] tabular-nums" :style="{ color: s.color }">{{ s.value }}</div>
              </div>
            </div>

            <div class="text-[13px] leading-[1.55] mt-[18px] max-w-[640px]" style="color: var(--dig-muted)">{{ description }}</div>
          </div>

          <!-- TVL history — real Blend reconstruction when available, else the
               honest "building history" note (never a synthesized curve). -->
          <div class="rounded-[18px] p-[22px]" style="background: var(--dig-surface); border: 1px solid var(--dig-line)">
            <div class="flex items-center justify-between mb-[6px]">
              <div class="text-[14px] font-semibold">{{ tvlCardTitle }}</div>
              <div v-if="tvlChart" class="flex items-center gap-[12px] text-[12px]" style="color: var(--dig-faint)">
                <span class="flex items-center gap-[6px]"><span class="w-[10px] h-[3px] rounded-[2px]" style="background: var(--dig-text)"></span>TVL</span>
                <span class="tabular-nums">{{ tvlChart.count }} snapshots</span>
              </div>
              <div v-else class="flex gap-[16px] text-[12px]">
                <span class="flex items-center gap-[6px]" style="color: var(--dig-faint)"><span class="w-[10px] h-[3px] rounded-[2px]" style="background: var(--dig-text)"></span>TVL</span>
                <span class="flex items-center gap-[6px]" style="color: var(--dig-faint)"><span class="w-[10px] h-[10px] rounded-[3px]" style="background: #37372F"></span>Volume</span>
              </div>
            </div>

            <!-- Real TVL series (Blend) -->
            <template v-if="tvlChart">
              <div class="relative">
                <div class="absolute top-0 left-0 text-[11px] tabular-nums" style="color: var(--dig-faint)">{{ tvlChart.maxLabel }}</div>
                <div v-html="tvlChart.svg" style="line-height: 0" />
                <div class="absolute bottom-[2px] left-0 text-[11px] tabular-nums" style="color: var(--dig-faint)">{{ tvlChart.minLabel }}</div>
              </div>
              <div class="flex items-center justify-between mt-[8px] text-[11px]" style="color: var(--dig-faint)">
                <span>{{ tvlChart.first }}</span>
                <span>Supplied × latest price · reconstructed from reserve snapshots</span>
                <span>{{ tvlChart.last }}</span>
              </div>
            </template>

            <!-- Honest empty state (non-Blend / no derivable series) -->
            <div
              v-else
              class="rounded-[12px] h-[190px] flex flex-col items-center justify-center gap-[8px] text-center px-[24px]"
              style="background: var(--dig-surface-2); border: 1px dashed var(--dig-line)"
            >
              <div class="flex items-center gap-[8px] text-[13px] font-semibold" style="color: var(--dig-muted)">
                <span class="w-[6px] h-[6px] rounded-full" style="background: var(--dig-accent); animation: digPulse 1.6s ease-in-out infinite"></span>
                Building history
              </div>
              <div class="text-[12px] max-w-[420px]" style="color: var(--dig-faint)">
                We snapshot on-chain state each refresh; a 30-day TVL/volume series
                will render here as history accumulates<span v-if="historySince"> (since {{ historySince }})</span>.
              </div>
            </div>
          </div>

          <!-- Inflows & outflows — real /v1/pools/:slug/flows; hidden when uncovered -->
          <div
            v-if="flows && flows.covered"
            class="rounded-[18px] p-[22px]"
            style="background: var(--dig-surface); border: 1px solid var(--dig-line)"
          >
            <div class="flex items-start justify-between mb-[16px]">
              <div>
                <div class="text-[14px] font-semibold">Inflows &amp; outflows</div>
                <div class="text-[12px] mt-[2px]" style="color: var(--dig-faint)">Deposits vs withdrawals · derived from the event stream</div>
              </div>
              <div class="flex gap-[6px]">
                <button
                  v-for="r in FLOW_RANGES"
                  :key="r"
                  type="button"
                  class="dig-chip text-[11.5px] font-semibold px-[9px] py-[4px] rounded-[8px] cursor-pointer uppercase"
                  :style="{
                    color: flowWindow === r ? 'var(--dig-text)' : 'var(--dig-faint)',
                    background: flowWindow === r ? '#2A2A27' : 'transparent',
                  }"
                  @click="setFlowWindow(r)"
                >
                  {{ r }}
                </button>
              </div>
            </div>

            <div class="grid grid-cols-3 gap-[10px] mb-[18px]">
              <div
                v-for="t in flowStatTiles"
                :key="t.label"
                class="rounded-[12px] px-[14px] py-[12px]"
                style="background: var(--dig-surface-2); border: 1px solid var(--dig-line-soft)"
              >
                <div class="text-[11.5px] font-medium" style="color: var(--dig-faint)">{{ t.label }}</div>
                <div class="flex items-center gap-[7px] mt-[6px]">
                  <span class="w-[20px] h-[20px] rounded-[6px] flex items-center justify-center" :style="{ background: t.tint, color: t.color }">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                      <path v-if="t.up" d="M12 19V5M5 12l7-7 7 7" />
                      <path v-else d="M12 5v14M5 12l7 7 7-7" />
                    </svg>
                  </span>
                  <span class="text-[17px] font-bold tabular-nums" :style="{ color: t.color }">{{ t.value }}</span>
                </div>
              </div>
            </div>

            <!-- Chart or honest empty-state -->
            <template v-if="flowChart.hasData">
              <div class="flex items-center gap-[16px] text-[12px] mb-[8px]">
                <span class="flex items-center gap-[6px]" style="color: var(--dig-faint)"><span class="w-[10px] h-[10px] rounded-[3px]" style="background: #B8E640"></span>Inflow</span>
                <span class="flex items-center gap-[6px]" style="color: var(--dig-faint)"><span class="w-[10px] h-[10px] rounded-[3px]" style="background: #4C4C46"></span>Outflow</span>
                <span class="flex items-center gap-[6px]" style="color: var(--dig-faint)"><span class="w-[12px] h-[3px] rounded-[2px]" style="background: var(--dig-text)"></span>Cumulative net</span>
              </div>
              <div v-html="flowChart.svg" style="line-height: 0" />
            </template>
            <div
              v-else
              class="rounded-[12px] py-[28px] text-center text-[12px]"
              style="background: var(--dig-surface-2); border: 1px solid var(--dig-line-soft); color: var(--dig-faint)"
            >
              <span v-if="flowsLoading">Loading flows…</span>
              <span v-else>No deposits or withdrawals in the last {{ flows.window }}.</span>
            </div>
          </div>
        </div>

        <!-- RIGHT COLUMN -->
        <div class="flex flex-col gap-[16px] min-w-0">
          <!-- On-chain info -->
          <div class="rounded-[18px] p-[22px]" style="background: var(--dig-surface); border: 1px solid var(--dig-line)">
            <div class="flex items-center justify-between mb-[14px]">
              <div class="text-[14px] font-semibold">On-chain info</div>
              <a
                v-if="explorerUrl"
                :href="explorerUrl"
                target="_blank"
                rel="noopener"
                class="dig-chip text-[12px] font-semibold cursor-pointer px-[8px] py-[3px] rounded-[8px] no-underline"
                style="color: var(--dig-accent)"
              >Explore →</a>
            </div>
            <div
              v-for="oi in onchain"
              :key="oi.label"
              class="flex items-center justify-between py-[8px]"
              style="border-bottom: 1px solid #262624"
            >
              <span class="text-[12.5px]" style="color: var(--dig-faint)">{{ oi.label }}</span>
              <span class="text-[12.5px] font-semibold" :class="oi.mono ? 'font-mono-geist' : ''" style="color: var(--dig-text)">
                <template v-if="oi.label === 'Contract' && explorerUrl">
                  <a :href="explorerUrl" target="_blank" rel="noopener" class="no-underline hover:opacity-80" style="color: var(--dig-text)">{{ oi.value }}</a>
                </template>
                <template v-else-if="oi.label === 'Updated'">
                  <span class="inline-flex items-center gap-[8px]">
                    <span class="text-[11px] font-semibold px-[7px] py-[1px] rounded-[20px]" :style="{ color: freshness.color, background: 'var(--dig-surface-2)' }">{{ freshness.label }}</span>
                    {{ oi.value }}
                  </span>
                </template>
                <template v-else>{{ oi.value }}</template>
              </span>
            </div>
          </div>

          <!-- Reserves breakdown bars (AMM) -->
          <div
            v-if="reserveBars.length"
            class="rounded-[18px] p-[22px]"
            style="background: var(--dig-surface); border: 1px solid var(--dig-line)"
          >
            <div v-for="(r, i) in reserveBars" :key="i" class="mb-[16px] last:mb-0">
              <div class="flex items-center justify-between text-[13px] mb-[7px]">
                <span class="flex items-center gap-[8px] font-semibold">
                  <BrandLogo :primary="r.logoUrl" :letter="(r.symbol || '•').charAt(0)" tint="#242422" color="#B7B3AB" :size="20" :radius="6" :font-size="10" :img-scale="0.72" />
                  {{ r.symbol }}
                </span>
                <span class="tabular-nums" style="color: var(--dig-faint)">{{ r.amount }}</span>
              </div>
              <div class="h-[7px] rounded-[5px] overflow-hidden" style="background: var(--dig-line-soft)">
                <div class="h-full rounded-[5px]" :style="{ width: r.width, background: theme.color }"></div>
              </div>
            </div>
          </div>

          <!-- Your position (Blend-only, real) -->
          <div
            v-if="myPosition"
            class="rounded-[18px] p-[22px]"
            style="background: var(--dig-surface); border: 1px solid var(--dig-line)"
          >
            <div class="text-[14px] font-semibold mb-[10px]">Your position</div>
            <div class="grid grid-cols-2 gap-[12px]">
              <div>
                <div class="text-[12px]" style="color: var(--dig-faint)">Supplied</div>
                <div class="text-[20px] font-bold tabular-nums mt-[2px]">{{ formatUsd(myPosition.supplied) }}</div>
              </div>
              <div>
                <div class="text-[12px]" style="color: var(--dig-faint)">Borrowed</div>
                <div class="text-[20px] font-bold tabular-nums mt-[2px]" style="color: var(--dig-amber)">{{ formatUsd(myPosition.borrowed) }}</div>
              </div>
            </div>
            <div class="flex items-center justify-between mt-[12px] pt-[12px]" style="border-top: 1px solid var(--dig-line-soft)">
              <span class="text-[12.5px]" style="color: var(--dig-faint)">Health factor</span>
              <span class="text-[13px] font-bold tabular-nums" :style="{ color: hfColor(myPosition.hf) }">
                {{ myPosition.hf === null ? 'No borrow' : `HF ${myPosition.hf.toFixed(2)}` }}
              </span>
            </div>
            <div class="flex gap-[9px] mt-[16px]">
              <button type="button" class="dig-btn flex-1 h-[40px] rounded-[11px] text-[13px] font-bold cursor-pointer" style="background: var(--dig-accent); color: #252525; border: none" @click="openAction">Supply</button>
              <button type="button" class="dig-ghost flex-1 h-[40px] rounded-[11px] text-[13px] font-semibold cursor-pointer" style="background: var(--dig-surface-3); border: 1px solid var(--dig-line); color: var(--dig-faint)" @click="openAction">Withdraw</button>
            </div>
          </div>

          <!-- Risk signals (only real rows) -->
          <div class="rounded-[18px] p-[22px]" style="background: var(--dig-surface); border: 1px solid var(--dig-line)">
            <div class="text-[14px] font-semibold mb-[12px]">Risk signals</div>
            <div v-for="rk in risks" :key="rk.label" class="flex items-center gap-[10px] py-[7px]">
              <span class="w-[8px] h-[8px] rounded-full" :style="{ background: rk.color }"></span>
              <span class="text-[13px]" style="color: var(--dig-faint)">{{ rk.label }}</span>
              <span class="ml-auto text-[12px] font-semibold" :style="{ color: rk.color }">{{ rk.value }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Reserves & rates (Blend) -->
      <div
        v-if="pool.reserves && pool.reserves.length"
        class="rounded-[18px] p-[22px] mt-[16px] overflow-x-auto"
        style="background: var(--dig-surface); border: 1px solid var(--dig-line)"
      >
        <div class="flex items-center justify-between mb-[14px]">
          <div class="text-[14px] font-semibold">Reserves &amp; rates</div>
          <span class="text-[12px]" style="color: var(--dig-faint)">Per-asset on-chain state · normalized</span>
        </div>
        <table class="w-full text-[13px] min-w-[720px] border-collapse">
          <thead>
            <tr class="text-[11px] uppercase tracking-[0.04em]" style="color: var(--dig-faint)">
              <th class="text-left py-[10px] font-semibold">Asset</th>
              <th class="text-right py-[10px] font-semibold">Price</th>
              <th class="text-right py-[10px] font-semibold">Supplied</th>
              <th class="text-right py-[10px] font-semibold">Borrowed</th>
              <th class="text-right py-[10px] font-semibold">Backstop</th>
              <th class="text-right py-[10px] font-semibold">Supply cap</th>
              <th class="text-right py-[10px] font-semibold">Supply APY</th>
              <th class="text-right py-[10px] font-semibold">Borrow APY</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in pool.reserves" :key="r.assetId" style="border-top: 1px solid #262624">
              <td class="py-[13px] font-semibold">
                <span class="flex items-center gap-[8px]">
                  <BrandLogo :primary="r.logoUrl" :letter="(displaySymbol(r.symbol) || '•').charAt(0)" tint="#242422" color="#B7B3AB" :size="22" :radius="6" :font-size="11" :img-scale="0.72" />
                  {{ displaySymbol(r.symbol) }}
                </span>
              </td>
              <td class="py-[13px] text-right" style="color: var(--dig-text-2)">{{ formatUsd(r.priceUsd) }}</td>
              <td class="py-[13px] text-right">{{ formatCount(r.supplied) }}</td>
              <td class="py-[13px] text-right" style="color: var(--dig-text-2)">{{ formatCount(r.borrowed) }}</td>
              <td class="py-[13px] text-right" style="color: var(--dig-text-2)">{{ formatCount(r.backstopCredit) }}</td>
              <td class="py-[13px] text-right" style="color: var(--dig-faint)">{{ formatCount(r.supplyCap) }}</td>
              <td class="py-[13px] text-right font-semibold" style="color: var(--dig-green)">{{ pct(r.supplyApy) }}</td>
              <td class="py-[13px] text-right font-semibold" style="color: var(--dig-red)">{{ pct(r.borrowApy) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>
