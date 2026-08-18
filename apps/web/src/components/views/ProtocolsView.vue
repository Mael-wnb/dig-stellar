<script setup lang="ts">
// ProtocolsView — Lot C (design: Dig Stellar.dc.html PROTOCOLS block).
// Per-protocol summary cards + a sortable, filterable all-pools table, all from
// the real /v1/pools data. Lot B freshness carries over as per-pool stale badges
// and a per-protocol stale dot (restyled, not removed). Rows open the pool view.
import { computed, ref, watch } from 'vue'
import { useProtocol } from '../../composables/useProtocol'
import { useView } from '../../composables/useView'
import { venueTheme } from '../../data/venueTheme'
import { displayPoolName, displaySymbol, formatUsd, formatCount } from '../../utils/format'
import type { PoolListItem, ProtocolAssetMark } from '../../types/protocol'
import { fetchProtocols } from '../../api/protocols'
import BrandLogo from '../common/BrandLogo.vue'
import PairLogo from '../common/PairLogo.vue'

const { pools, loadingProtocols, error, reload } = useProtocol()

// Q4 (Lot Q): per-venue top assets by TVL (+ honest total count) from
// /v1/protocols. Additive enhancement — the cards render without asset chips
// until (or unless) the payload arrives.
const protocolAssets = ref<Map<string, { topAssets: ProtocolAssetMark[]; assetCount: number }>>(new Map())
fetchProtocols()
  .then((list) => {
    protocolAssets.value = new Map(
      list.map((v) => [v.id, { topAssets: v.topAssets ?? [], assetCount: v.assetCount ?? 0 }]),
    )
  })
  .catch(() => {
    /* cards stay chip-less; the pools table is unaffected */
  })

// Q4: honest venue-level Type from venue_type (served as protocol.type on
// pools). stellar-native is venue_type 'amm' in the registry but the venue is
// the classic DEX — labelled per the founder's enumeration.
const VENUE_TYPE_LABEL: Record<string, string> = {
  lending: 'Lending',
  amm: 'AMM',
  vault: 'Yield vaults',
  bridge: 'Bridge',
}
function venueTypeLabel(venueId: string, venueType: string, fallback: string): string {
  if (venueId === 'stellar-native') return 'DEX (orderbook)'
  return VENUE_TYPE_LABEL[venueType] ?? fallback
}

// F5 (Lot F): pair-asset marks for a pool. AMM → both legs; vault → underlying.
// Symbol/logoUrl come from /v1/pools (F3); an absent logo falls back to the
// symbol monogram inside BrandLogo.
function assetMarks(p: PoolListItem): Array<{ primary: string | null; letter: string }> {
  return (p.tokens ?? []).map((t) => ({
    primary: t.logoUrl ?? null,
    // Q2: monogram from the DISPLAY symbol ('native' → XLM → 'X', never 'N').
    letter: (displaySymbol(t.symbol) || '•').charAt(0).toUpperCase(),
  }))
}
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
    id: string; name: string; kind: PoolKind; vtype: string; logoUrl: string | null; tvl: number; vol: number; fees: number
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
      { id, name: p.protocol.name, kind, vtype: p.protocol.type, logoUrl: p.protocol.logoUrl ?? null, tvl: 0, vol: 0, fees: 0, count: 0, stale: false, topPool: p.id, sApyW: 0, sTvl: 0, bApyW: 0, bTvl: 0 }
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
      // Rigid 3-slot grid: TVL (rendered first) + exactly two type-specific slots,
      // so every card aligns on the same baselines regardless of type. Never
      // volume/fees on lending/vault; vault fills its third slot with pool count.
      const metrics =
        c.kind === 'lending'
          ? [
              { label: 'Avg supply APY', value: pctRatio(avgSupplyApy), color: 'var(--dig-green)' },
              { label: 'Avg borrow APY', value: pctRatio(avgBorrowApy), color: 'var(--dig-red)' },
            ]
          : c.kind === 'vault'
            ? [
                { label: 'Avg APY', value: pctRatio(avgSupplyApy), color: 'var(--dig-green)' },
                { label: 'Pools', value: String(c.count), color: 'var(--dig-text)' },
              ]
            : [
                { label: '24h vol', value: formatUsd(c.vol), color: 'var(--dig-text)' },
                { label: 'Fees 24h', value: formatUsd(c.fees), color: 'var(--dig-text)' },
              ]
      // Q4: up to 3 top-TVL underlying assets as circular marks + honest "+N".
      const va = protocolAssets.value.get(c.id)
      const assets = (va?.topAssets ?? []).map((a) => ({
        primary: a.logoUrl ?? null,
        letter: (displaySymbol(a.symbol) || '•').charAt(0).toUpperCase(),
      }))
      const moreAssets = Math.max(0, (va?.assetCount ?? 0) - assets.length)
      return {
        ...c,
        theme: venueTheme(c.id),
        typeLabel: venueTypeLabel(c.id, c.vtype, KIND_LABEL[c.kind]),
        metrics,
        assets,
        moreAssets,
      }
    })
})

// ── filter + sort the pool table ─────────────────────────────────────────────
const filter = ref<string>('all')
const filters = computed(() => [
  { key: 'all', label: 'All' },
  ...protocolCards.value.map((c) => ({ key: c.id, label: c.name })),
])

// G3: adaptive columns per tab. "All" is generic (Protocol · TVL · a single
// type-aware Key metric); selecting a protocol tab shows that type's full column
// set. No more half-dash rows: a column only appears where every row in view can
// fill it.
type SortKey = 'tvl' | 'apy' | 'borrow' | 'vol' | 'fees' | 'swaps' | 'util' | 'key'
const sortKey = ref<SortKey>('tvl')
const sortDir = ref<'asc' | 'desc'>('desc')

// The selected protocol's kind (null on "All"). Every pool in a venue shares a kind.
const selectedKind = computed<PoolKind | null>(() => {
  if (filter.value === 'all') return null
  return protocolCards.value.find((c) => c.id === filter.value)?.kind ?? null
})

// Switching tabs swaps the column set, so a sort key from the old set may no longer
// exist — reset to TVL (present in every set and comparable across all types).
watch(filter, () => {
  sortKey.value = 'tvl'
  sortDir.value = 'desc'
})

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

// The single metric surfaced on the "All" tab, chosen by type: lending → Supply
// APY, vault → APY, amm → 24h volume. Carries its own per-row label + sort value
// so the mixed column never pretends an APY and a volume are comparable numbers.
function keyMetric(p: PoolListItem): { value: string; label: string; sort: number | null } {
  if (poolKind(p) === 'amm') {
    return { value: formatUsd(p.metrics.volume24hUsd), label: '24h vol', sort: p.metrics.volume24hUsd ?? null }
  }
  const apy = p.metrics.supplyApy
  return { value: pctRatio(apy), label: poolKind(p) === 'lending' ? 'Supply APY' : 'APY', sort: apy ?? null }
}

// Sort keys mirror display applicability: N/A metrics are `null` so they sort as
// absent (bottom) rather than as a spurious 0.
function metricVal(p: PoolListItem, k: SortKey): number | null {
  const kind = poolKind(p)
  switch (k) {
    case 'tvl': return p.metrics.tvlUsd ?? null
    case 'apy': return p.metrics.supplyApy ?? null
    case 'borrow': return kind === 'lending' ? (p.metrics.borrowApy ?? null) : null
    case 'vol': return kind === 'amm' ? (p.metrics.volume24hUsd ?? null) : null
    case 'fees': return kind === 'amm' ? (p.metrics.fees24hUsd ?? null) : null
    case 'swaps': return kind === 'amm' ? (p.metrics.swaps24h ?? null) : null
    case 'util': return kind === 'lending' ? util(p) : null
    case 'key': return keyMetric(p).sort
  }
}

// Fixed group order for the "All" key-metric sort — see rows() below.
const KIND_ORDER: Record<PoolKind, number> = { lending: 0, amm: 1, vault: 2 }

const rows = computed(() => {
  const list = pools.value.filter((p) => filter.value === 'all' || p.protocol.id === filter.value)
  const dir = sortDir.value === 'asc' ? 1 : -1
  // On "All", sorting the Key-metric column groups by type first, then sorts each
  // group by its own metric — APY and volume are ranked within their kind, never
  // against each other. TVL (and every protocol-tab sort) is a plain comparison.
  const groupByKind = filter.value === 'all' && sortKey.value === 'key'
  return [...list]
    .sort((a, b) => {
      if (groupByKind) {
        const ka = KIND_ORDER[poolKind(a)]
        const kb = KIND_ORDER[poolKind(b)]
        if (ka !== kb) return ka - kb
      }
      const av = metricVal(a, sortKey.value)
      const bv = metricVal(b, sortKey.value)
      if (av === null && bv === null) return 0
      if (av === null) return 1
      if (bv === null) return -1
      return (av - bv) * dir
    })
    .map((p) => {
      const kind = poolKind(p)
      const u = util(p)
      const km = keyMetric(p)
      return {
        id: p.id,
        pair: displayPoolName(p.name),
        venue: p.protocol.name,
        logoUrl: p.protocol.logoUrl ?? null,
        theme: venueTheme(p.protocol.id),
        // F5: overlapped pair marks for AMM (2 legs) / vault (1 underlying);
        // lending keeps the single protocol logo below.
        assets: kind === 'amm' ? assetMarks(p).slice(0, 2) : kind === 'vault' ? assetMarks(p).slice(0, 1) : [],
        tvl: formatUsd(p.metrics.tvlUsd),
        apy: pctRatio(p.metrics.supplyApy),
        borrow: pctRatio(p.metrics.borrowApy),
        vol: formatUsd(p.metrics.volume24hUsd),
        fees: formatUsd(p.metrics.fees24hUsd),
        swaps: formatCount(p.metrics.swaps24h),
        // Utilization applies to lending only; a real 0% borrow stays "0%".
        util: u === null ? '—' : `${u.toFixed(0)}%`,
        keyValue: km.value,
        keyLabel: km.label,
        stale: p.isStale === true,
      }
    })
})

// Column set per tab. `value` cols read row[field]; `protocol` shows the venue;
// `key` shows the value + its per-row label. Only columns every visible row can
// fill are present — that is what kills the half-dash rows.
type ColType = 'value' | 'protocol' | 'key'
interface Col { key: SortKey | null; label: string; field?: string; align: 'left' | 'right'; type: ColType }

const columns = computed<Col[]>(() => {
  switch (selectedKind.value) {
    case 'lending':
      return [
        { key: 'tvl', label: 'TVL', field: 'tvl', align: 'right', type: 'value' },
        { key: 'apy', label: 'Supply APY', field: 'apy', align: 'right', type: 'value' },
        { key: 'borrow', label: 'Borrow APY', field: 'borrow', align: 'right', type: 'value' },
        { key: 'util', label: 'Utilization', field: 'util', align: 'right', type: 'value' },
      ]
    case 'amm':
      return [
        { key: 'tvl', label: 'TVL', field: 'tvl', align: 'right', type: 'value' },
        { key: 'vol', label: '24h vol', field: 'vol', align: 'right', type: 'value' },
        { key: 'fees', label: '24h fees', field: 'fees', align: 'right', type: 'value' },
        { key: 'swaps', label: '24h swaps', field: 'swaps', align: 'right', type: 'value' },
      ]
    case 'vault':
      return [
        { key: 'tvl', label: 'TVL', field: 'tvl', align: 'right', type: 'value' },
        { key: 'apy', label: 'APY', field: 'apy', align: 'right', type: 'value' },
      ]
    default: // "All" — generic
      return [
        { key: null, label: 'Protocol', align: 'left', type: 'protocol' },
        { key: 'tvl', label: 'TVL', field: 'tvl', align: 'right', type: 'value' },
        { key: 'key', label: 'Key metric', align: 'right', type: 'key' },
      ]
  }
})

// Grid track sizing: Pool (wide) · each column · chevron. Protocol/Key metric get
// a touch more room than a plain numeric column.
const gridTemplate = computed(
  () =>
    `2fr ${columns.value
      .map((c) => (c.type === 'key' ? '1.4fr' : c.type === 'protocol' ? '1.2fr' : '1fr'))
      .join(' ')} 40px`,
)

function arrow(k: SortKey | null): string {
  if (k === null || sortKey.value !== k) return ''
  return sortDir.value === 'asc' ? ' ↑' : ' ↓'
}
</script>

<template>
  <div class="max-w-[1180px] mx-auto px-[26px] py-[26px]" style="animation: digFade .35s ease both">
    <div v-if="loadingProtocols" class="rounded-[18px] p-[40px] text-center" style="background: var(--dig-surface); border: 1px solid var(--dig-line)">
      <span class="text-[13px]" style="color: var(--dig-faint)">Loading protocols…</span>
    </div>
    <div v-else-if="error" class="rounded-[18px] p-[40px] text-center flex flex-col items-center gap-[12px]" style="background: var(--dig-surface); border: 1px solid var(--dig-line)">
      <span class="text-[13px]" style="color: var(--dig-red)">Couldn't load protocols: {{ error }}</span>
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
            <BrandLogo :primary="c.logoUrl" :fallback="c.theme.logo" :letter="c.theme.letter" :tint="c.theme.tint" :color="c.theme.color" :size="42" :radius="12" :font-size="19" :img-scale="0.72" />
            <div class="min-w-0 flex-1">
              <div class="text-[16px] font-bold flex items-center gap-[7px]">
                {{ c.name }}
                <span v-if="c.stale" class="w-[7px] h-[7px] rounded-full" style="background: var(--dig-amber)" title="Some pools stale"></span>
              </div>
              <div class="text-[12px]" style="color: var(--dig-faint)">{{ c.typeLabel }}, {{ c.count }} pools</div>
            </div>
            <!-- Q4: top underlying assets by TVL (circular, per Q1) + honest "+N" -->
            <div v-if="c.assets.length" class="flex items-center gap-[6px] flex-shrink-0">
              <PairLogo :assets="c.assets" :size="22" :font-size="10" />
              <span
                v-if="c.moreAssets > 0"
                class="text-[11px] font-semibold px-[6px] py-[2px] rounded-full"
                style="background: var(--dig-surface-3); color: var(--dig-faint)"
                :title="`${c.moreAssets} more assets`"
              >+{{ c.moreAssets }}</span>
            </div>
          </div>
          <div class="grid grid-cols-3 gap-[14px] mt-[20px]">
            <div class="min-w-0">
              <div class="text-[12px] truncate" style="color: var(--dig-faint)">TVL</div>
              <div class="text-[18px] font-bold mt-[2px] tabular-nums truncate">{{ formatUsd(c.tvl) }}</div>
            </div>
            <div v-for="m in c.metrics" :key="m.label" class="min-w-0">
              <div class="text-[12px] truncate" style="color: var(--dig-faint)">{{ m.label }}</div>
              <div class="text-[18px] font-bold mt-[2px] tabular-nums truncate" :style="{ color: m.color }">{{ m.value }}</div>
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
            <div class="grid items-center px-[20px] py-[11px] text-[11px] font-semibold uppercase tracking-[0.04em]" :style="{ gridTemplateColumns: gridTemplate, color: 'var(--dig-faint)', borderBottom: '1px solid var(--dig-line-soft)' }">
              <div>Pool</div>
              <template v-for="col in columns" :key="col.label">
                <button v-if="col.key" type="button" class="cursor-pointer select-none uppercase bg-transparent" :style="{ textAlign: col.align, color: sortKey === col.key ? 'var(--dig-text)' : 'var(--dig-faint)' }" @click="toggleSort(col.key)">{{ col.label }}{{ arrow(col.key) }}</button>
                <div v-else :style="{ textAlign: col.align }">{{ col.label }}</div>
              </template>
              <div></div>
            </div>
            <div
              v-for="r in rows"
              :key="r.id"
              class="dig-row grid items-center px-[20px] py-[13px] cursor-pointer"
              :style="{ gridTemplateColumns: gridTemplate, borderBottom: '1px solid var(--dig-line-soft)' }"
              @click="openPool(r.id)"
            >
              <div class="flex items-center gap-[11px] min-w-0">
                <PairLogo
                  v-if="r.assets.length"
                  :assets="r.assets"
                  :size="30"
                  :font-size="12"
                />
                <BrandLogo v-else :primary="r.logoUrl" :fallback="r.theme.logo" :letter="r.theme.letter" :tint="r.theme.tint" :color="r.theme.color" :size="30" :radius="9" :font-size="12" :img-scale="0.72" />
                <div class="min-w-0">
                  <div class="text-[14px] font-semibold truncate flex items-center gap-[6px]">
                    {{ r.pair }}
                    <span v-if="r.stale" class="text-[9px] font-bold uppercase px-[5px] py-[1px] rounded-[6px]" style="color: var(--dig-amber); background: rgba(201,138,30,0.12)">Stale</span>
                  </div>
                </div>
              </div>
              <template v-for="col in columns" :key="col.label">
                <!-- Protocol (All tab): venue name -->
                <div v-if="col.type === 'protocol'" class="text-[13.5px] font-semibold truncate" style="color: var(--dig-text)">{{ r.venue }}</div>
                <!-- Key metric (All tab): value + its per-row label, so the mixed column stays honest -->
                <div v-else-if="col.type === 'key'" class="text-right">
                  <div class="text-[14px] font-semibold tabular-nums" :style="{ color: r.keyLabel === '24h vol' ? 'var(--dig-text)' : 'var(--dig-green)' }">{{ r.keyValue }}</div>
                  <div class="text-[10.5px] leading-tight" style="color: var(--dig-faint)">{{ r.keyLabel }}</div>
                </div>
                <!-- Value column: read the row field; TVL/APY styled, others muted -->
                <div v-else class="text-[14px] tabular-nums" :class="col.align === 'right' ? 'text-right' : ''"
                     :style="{ color: col.field === 'apy' ? 'var(--dig-green)' : col.field === 'tvl' ? 'var(--dig-text)' : 'var(--dig-faint)', fontWeight: (col.field === 'tvl' || col.field === 'apy') ? 600 : 400 }">{{ col.field ? (r as any)[col.field] : '' }}</div>
              </template>
              <div class="text-right" style="color: #6A665E">›</div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
