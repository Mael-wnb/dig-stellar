<script setup lang="ts">
// ProtocolsView — Lot C (design: Dig Stellar.dc.html PROTOCOLS block).
// Per-protocol summary cards + a sortable, filterable all-pools table, all from
// the real /v1/pools data. Lot B freshness carries over as per-pool stale badges
// and a per-protocol stale dot (restyled, not removed). Rows open the pool view.
import { computed, ref } from 'vue'
import { useProtocol } from '../../composables/useProtocol'
import { useView } from '../../composables/useView'
import { venueTheme } from '../../data/venueTheme'
import { displayPoolName, formatUsd } from '../../utils/format'
import type { PoolListItem } from '../../types/protocol'

const { pools, loadingProtocols, error, reload } = useProtocol()
const { openPool } = useView()

function pctRatio(v?: number | null): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  return `${(v * 100).toFixed(2)}%`
}

// Pool family. Drives which metrics are APPLICABLE (vs structurally N/A):
//  • lending (Blend): TVL + supply/borrow APY + utilization; no volume/fees.
//  • vault (DeFindex): TVL + supply APY; no volume/fees/utilization/borrow.
//  • amm (Aquarius/Soroswap/native): TVL + volume + fees; no APY/utilization.
// N/A metrics must render "—" (not $0/0%) — a $0 would imply a measured zero.
type PoolKind = 'lending' | 'vault' | 'amm'
function poolKind(p: PoolListItem): PoolKind {
  if (p.type === 'lending_pool') return 'lending'
  if (p.type === 'yield_vault') return 'vault'
  return 'amm'
}
const KIND_LABEL: Record<PoolKind, string> = { lending: 'Lending', vault: 'Vault', amm: 'AMM' }

// ── per-protocol summary cards ───────────────────────────────────────────────
const protocolCards = computed(() => {
  interface Acc {
    id: string; name: string; kind: PoolKind; tvl: number; vol: number; fees: number
    count: number; stale: boolean; topPool: string
    // TVL-weighted APY accumulators (only over pools where the metric applies).
    sApyW: number; sTvl: number; bApyW: number; bTvl: number
  }
  const map = new Map<string, Acc>()
  for (const p of pools.value) {
    const id = p.protocol.id
    const kind = poolKind(p)
    const tvl = p.metrics.tvlUsd ?? 0
    const cur =
      map.get(id) ??
      { id, name: p.protocol.name, kind, tvl: 0, vol: 0, fees: 0, count: 0, stale: false, topPool: p.id, sApyW: 0, sTvl: 0, bApyW: 0, bTvl: 0 }
    cur.tvl += tvl
    if (kind === 'amm') {
      cur.vol += p.metrics.volume24hUsd ?? 0
      cur.fees += p.metrics.fees24hUsd ?? 0
    }
    const sa = p.metrics.supplyApy
    if (sa != null && Number.isFinite(sa)) { cur.sApyW += sa * tvl; cur.sTvl += tvl }
    const ba = p.metrics.borrowApy
    if (ba != null && Number.isFinite(ba)) { cur.bApyW += ba * tvl; cur.bTvl += tvl }
    cur.count += 1
    if (p.isStale === true) cur.stale = true
    // Track the highest-TVL pool as the card's click target.
    const curTop = pools.value.find((x) => x.id === cur.topPool)
    if (!curTop || tvl > (curTop.metrics.tvlUsd ?? 0)) cur.topPool = p.id
    map.set(id, cur)
  }
  return [...map.values()]
    .sort((a, b) => b.tvl - a.tvl)
    .map((c) => {
      const avgSupplyApy = c.sTvl > 0 ? c.sApyW / c.sTvl : null
      const avgBorrowApy = c.bTvl > 0 ? c.bApyW / c.bTvl : null
      // Metrics shown after TVL, per type (never volume/fees on lending/vault).
      const metrics =
        c.kind === 'lending'
          ? [
              { label: 'Avg supply APY', value: pctRatio(avgSupplyApy), color: 'var(--dig-green)' },
              { label: 'Avg borrow APY', value: pctRatio(avgBorrowApy), color: 'var(--dig-red)' },
            ]
          : c.kind === 'vault'
            ? [{ label: 'Avg APY', value: pctRatio(avgSupplyApy), color: 'var(--dig-green)' }]
            : [
                { label: '24h vol', value: formatUsd(c.vol), color: 'var(--dig-text)' },
                { label: 'Fees 24h', value: formatUsd(c.fees), color: 'var(--dig-text)' },
              ]
      return { ...c, theme: venueTheme(c.id), typeLabel: KIND_LABEL[c.kind], metrics }
    })
})

// ── filter + sort the pool table ─────────────────────────────────────────────
const filter = ref<string>('all')
const filters = computed(() => [
  { key: 'all', label: 'All' },
  ...protocolCards.value.map((c) => ({ key: c.id, label: c.name })),
])

type SortKey = 'tvl' | 'apy' | 'vol' | 'fees' | 'util'
const sortKey = ref<SortKey>('tvl')
const sortDir = ref<'asc' | 'desc'>('desc')

function toggleSort(k: SortKey) {
  if (sortKey.value === k) sortDir.value = sortDir.value === 'desc' ? 'asc' : 'desc'
  else {
    sortKey.value = k
    sortDir.value = 'desc'
  }
}

function util(p: PoolListItem): number | null {
  const s = p.metrics.totalSuppliedUsd ?? 0
  const b = p.metrics.totalBorrowedUsd
  if (!s || b === null || b === undefined) return null
  return (b / s) * 100
}

// Sort keys mirror display applicability: N/A metrics are `null` so they sort as
// absent (bottom) rather than as a spurious 0.
function metricVal(p: PoolListItem, k: SortKey): number | null {
  const amm = poolKind(p) === 'amm'
  switch (k) {
    case 'tvl': return p.metrics.tvlUsd ?? null
    case 'apy': return p.metrics.supplyApy ?? null
    case 'vol': return amm ? (p.metrics.volume24hUsd ?? null) : null
    case 'fees': return amm ? (p.metrics.fees24hUsd ?? null) : null
    case 'util': return poolKind(p) === 'lending' ? util(p) : null
  }
}

const rows = computed(() => {
  const list = pools.value.filter((p) => filter.value === 'all' || p.protocol.id === filter.value)
  const dir = sortDir.value === 'asc' ? 1 : -1
  return [...list]
    .sort((a, b) => {
      const av = metricVal(a, sortKey.value)
      const bv = metricVal(b, sortKey.value)
      if (av === null && bv === null) return 0
      if (av === null) return 1
      if (bv === null) return -1
      return (av - bv) * dir
    })
    .map((p) => {
      const kind = poolKind(p)
      const amm = kind === 'amm'
      const u = util(p)
      return {
        id: p.id,
        pair: displayPoolName(p.name),
        venue: p.protocol.name,
        theme: venueTheme(p.protocol.id),
        tvl: formatUsd(p.metrics.tvlUsd),
        apy: pctRatio(p.metrics.supplyApy),
        // Volume/fees apply to AMMs only; "—" (not $0) elsewhere. A measured 0 on
        // an AMM stays "$0" (formatUsd(0) === "$0").
        vol: amm ? formatUsd(p.metrics.volume24hUsd) : '—',
        fees: amm ? formatUsd(p.metrics.fees24hUsd) : '—',
        // Utilization applies to lending only; a real 0% borrow stays "0%".
        util: kind === 'lending' ? (u === null ? '—' : `${u.toFixed(0)}%`) : '—',
        stale: p.isStale === true,
      }
    })
})

const COLS: Array<{ key: SortKey; label: string }> = [
  { key: 'tvl', label: 'TVL' },
  { key: 'apy', label: 'APY' },
  { key: 'vol', label: '24h vol' },
  { key: 'fees', label: 'Fees 24h' },
  { key: 'util', label: 'Util.' },
]

function arrow(k: SortKey): string {
  if (sortKey.value !== k) return ''
  return sortDir.value === 'asc' ? ' ↑' : ' ↓'
}
</script>

<template>
  <div class="max-w-[1180px] mx-auto px-[26px] py-[26px]" style="animation: digFade .35s ease both">
    <div v-if="loadingProtocols" class="rounded-[18px] p-[40px] text-center" style="background: var(--dig-surface); border: 1px solid var(--dig-line)">
      <span class="text-[13px]" style="color: var(--dig-faint)">Loading protocols…</span>
    </div>
    <div v-else-if="error" class="rounded-[18px] p-[40px] text-center flex flex-col items-center gap-[12px]" style="background: var(--dig-surface); border: 1px solid var(--dig-line)">
      <span class="text-[13px]" style="color: var(--dig-red)">Couldn't load protocols · {{ error }}</span>
      <button type="button" class="dig-ghost h-[36px] px-[16px] rounded-[10px] text-[13px] font-semibold cursor-pointer" style="background: var(--dig-surface-3); border: 1px solid var(--dig-line); color: var(--dig-text)" @click="reload">Retry</button>
    </div>

    <template v-else>
      <!-- Protocol cards -->
      <div class="dig-scroll flex gap-[16px] mb-[18px] overflow-x-auto pb-[4px]">
        <div
          v-for="c in protocolCards"
          :key="c.id"
          class="flex-shrink-0 w-[300px] rounded-[18px] p-[22px] cursor-pointer dig-card-h"
          style="background: var(--dig-surface); border: 1px solid var(--dig-line)"
          @click="openPool(c.topPool)"
        >
          <div class="flex items-center gap-[12px]">
            <span class="w-[42px] h-[42px] rounded-[12px] flex items-center justify-center font-bold text-[19px]" :style="{ background: c.theme.tint, color: c.theme.color }">
              <img v-if="c.theme.logo" :src="c.theme.logo" alt="" class="w-[60%] h-[60%] object-contain" />
              <template v-else>{{ c.theme.letter }}</template>
            </span>
            <div class="min-w-0">
              <div class="text-[16px] font-bold flex items-center gap-[7px]">
                {{ c.name }}
                <span v-if="c.stale" class="w-[7px] h-[7px] rounded-full" style="background: var(--dig-amber)" title="Some pools stale"></span>
              </div>
              <div class="text-[12px]" style="color: var(--dig-faint)">{{ c.typeLabel }} · {{ c.count }} pools</div>
            </div>
          </div>
          <div class="flex gap-[22px] mt-[20px]">
            <div>
              <div class="text-[12px]" style="color: var(--dig-faint)">TVL</div>
              <div class="text-[18px] font-bold mt-[2px] tabular-nums">{{ formatUsd(c.tvl) }}</div>
            </div>
            <div v-for="m in c.metrics" :key="m.label">
              <div class="text-[12px]" style="color: var(--dig-faint)">{{ m.label }}</div>
              <div class="text-[18px] font-bold mt-[2px] tabular-nums" :style="{ color: m.color }">{{ m.value }}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- All pools table -->
      <div class="rounded-[18px] overflow-hidden" style="background: var(--dig-surface); border: 1px solid var(--dig-line)">
        <div class="flex items-center gap-[10px] px-[20px] py-[16px] flex-wrap" style="border-bottom: 1px solid var(--dig-line-soft)">
          <div class="text-[14px] font-semibold">All pools</div>
          <div class="flex gap-[6px] ml-[8px] flex-wrap">
            <button
              v-for="f in filters"
              :key="f.key"
              type="button"
              class="dig-chip text-[12px] font-semibold px-[12px] py-[5px] rounded-[9px] cursor-pointer"
              :style="{
                color: filter === f.key ? '#141414' : 'var(--dig-faint)',
                background: filter === f.key ? 'var(--dig-accent)' : 'var(--dig-surface-3)',
              }"
              @click="filter = f.key"
            >
              {{ f.label }}
            </button>
          </div>
          <span class="ml-auto text-[12px]" style="color: var(--dig-faint)">{{ rows.length }} pools</span>
        </div>

        <div class="overflow-x-auto">
          <div class="min-w-[720px]">
            <div class="grid items-center px-[20px] py-[11px] text-[11px] font-semibold uppercase tracking-[0.04em]" style="grid-template-columns: 2fr 1fr 1fr 1fr 1fr 1fr 40px; color: var(--dig-faint); border-bottom: 1px solid var(--dig-line-soft)">
              <div>Pool</div>
              <button v-for="col in COLS" :key="col.key" type="button" class="text-right cursor-pointer select-none uppercase" :style="{ color: sortKey === col.key ? 'var(--dig-text)' : 'var(--dig-faint)' }" @click="toggleSort(col.key)">{{ col.label }}{{ arrow(col.key) }}</button>
              <div></div>
            </div>
            <div
              v-for="r in rows"
              :key="r.id"
              class="dig-row grid items-center px-[20px] py-[13px] cursor-pointer"
              style="grid-template-columns: 2fr 1fr 1fr 1fr 1fr 1fr 40px; border-bottom: 1px solid var(--dig-line-soft)"
              @click="openPool(r.id)"
            >
              <div class="flex items-center gap-[11px] min-w-0">
                <span class="w-[30px] h-[30px] rounded-[9px] flex items-center justify-center font-bold text-[12px] flex-shrink-0" :style="{ background: r.theme.tint, color: r.theme.color }">
                  <img v-if="r.theme.logo" :src="r.theme.logo" alt="" class="w-[62%] h-[62%] object-contain" />
                  <template v-else>{{ r.theme.letter }}</template>
                </span>
                <div class="min-w-0">
                  <div class="text-[14px] font-semibold truncate flex items-center gap-[6px]">
                    {{ r.pair }}
                    <span v-if="r.stale" class="text-[9px] font-bold uppercase px-[5px] py-[1px] rounded-[6px]" style="color: var(--dig-amber); background: rgba(201,138,30,0.12)">Stale</span>
                  </div>
                  <div class="text-[11.5px]" style="color: var(--dig-faint)">{{ r.venue }}</div>
                </div>
              </div>
              <div class="text-right text-[14px] font-semibold tabular-nums">{{ r.tvl }}</div>
              <div class="text-right text-[14px] font-semibold tabular-nums" style="color: var(--dig-green)">{{ r.apy }}</div>
              <div class="text-right text-[14px] tabular-nums" style="color: var(--dig-faint)">{{ r.vol }}</div>
              <div class="text-right text-[14px] tabular-nums" style="color: var(--dig-faint)">{{ r.fees }}</div>
              <div class="text-right text-[13px] tabular-nums" style="color: var(--dig-faint)">{{ r.util }}</div>
              <div class="text-right" style="color: #6A665E">›</div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
