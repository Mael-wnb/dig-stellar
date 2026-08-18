<script setup lang="ts">
// DashboardView — Lot C (design: Dig Stellar.dc.html DASHBOARD block).
// Network-focused overview on real data:
//  • hero + stat strip from /v1/network/stats (with Lot B freshness),
//  • protocol totals (aggregated from /v1/pools),
//  • alerts summary (real notifications),
//  • a compact Swap/Deposit entry point → the shared ActionModal (G2, Lot G),
//  • the bridge section (existing useBridge data), restyled.
// G2 removed the inline Testnet/Mainnet actions section; the actions themselves
// (SdexSwapWidget / BlendDepositCard) are unchanged and now reached only through
// ActionModal, which self-gates + hosts the NetworkToggle. Flags regime untouched.
import { computed, onMounted } from 'vue'
import { useNetworkStats } from '../../composables/useNetworkStats'
import { useProtocol } from '../../composables/useProtocol'
import { useNotifications } from '../../composables/useNotifications'
import { useBridge } from '../../composables/useBridge'
import { useView } from '../../composables/useView'
import { useModals } from '../../composables/useModals'
import { venueTheme } from '../../data/venueTheme'
import BrandLogo from '../common/BrandLogo.vue'
import { formatUsd, formatPct, relativeTime } from '../../utils/format'

import FreshnessChip from '../FreshnessChip.vue'
import BridgeSection from '../bridge/BridgeSection.vue'
import YourPositionsPanel from '../common/YourPositionsPanel.vue'
import NetworkTvlChart from '../NetworkTvlChart.vue'
// R3 (Lot R): upfront reward-campaign card — renders only while live.
import FaucetPromoBanner from '../FaucetPromoBanner.vue'
import { useNetworkTvl } from '../../composables/useNetworkTvl'

const { setView, openPool } = useView()
const { requestAlert, openAction } = useModals()

// G4: network TVL 7-day curve for the hero (served from G0 snapshots).
const {
  series: tvlSeries,
  meta: tvlMeta,
  loading: tvlLoading,
  error: tvlError,
  load: loadTvl,
} = useNetworkTvl()

// Compact dashboard entry points → the shared ActionModal (same ctx shape the
// get-started card uses). The modal renders the real, self-gated widgets and
// owns the NetworkToggle; a swap is one click from here.
function openSwap() {
  openAction({ slug: 'sdex-swap', name: 'Swap XLM ↔ USDC', venue: 'Stellar DEX', kind: 'amm' })
}
function openDeposit() {
  openAction({ slug: 'blend', name: 'Blend pool', venue: 'Blend', kind: 'lending' })
}

// Create-alert modal lives on the alerts view (owns the create logic) — request
// it, then navigate.
function newAlertRule() {
  requestAlert()
  setView('alerts')
}

const {
  raw: netRaw,
  updatedAt: netUpdatedAt,
  isStale: netStale,
  staleAfterSeconds: netStaleAfter,
} = useNetworkStats()

const { pools, loadingProtocols, error: protocolsError, reload: reloadProtocols } = useProtocol()
const { notifications, unreadCount, load: loadNotifications } = useNotifications()

onMounted(() => void loadNotifications())

// ── network hero + stat strip ────────────────────────────────────────────────
// Hero TVL (2026-08-17 ruling): read from the SAME tvl-series response the chart
// draws — latest point of network_tvl_snapshots. One writer, one table: the hero
// and the chart's last point can never disagree. Gross headline ("Total value
// tracked") + honest secondary line ("Net TVL (supplied − borrowed)").
const heroPoint = computed(() =>
  tvlSeries.value.length ? tvlSeries.value[tvlSeries.value.length - 1] : null,
)
const heroTvl = computed(() => (heroPoint.value ? formatUsd(heroPoint.value.tvlUsd) : '—'))
const heroNetTvl = computed(() =>
  heroPoint.value?.tvlNetUsd != null ? formatUsd(heroPoint.value.tvlNetUsd) : null,
)
const xlmChange = computed(() => formatPct(netRaw.value.xlmPriceChange24hPct))
const xlmChangeColor = computed(() =>
  (netRaw.value.xlmPriceChange24hPct ?? 0) >= 0 ? 'var(--dig-green)' : 'var(--dig-red)',
)

const statTiles = computed(() => [
  {
    label: 'XLM price',
    value: netRaw.value.xlmPriceUsd !== null ? `$${netRaw.value.xlmPriceUsd.toFixed(4)}` : '—',
    delta: xlmChange.value,
    color: xlmChangeColor.value,
  },
  { label: 'Stablecoin MCap', value: formatUsd(netRaw.value.stableMcapUsd), delta: 'live', color: 'var(--dig-faint)' },
  { label: 'USDC supply', value: formatUsd(netRaw.value.usdcSupplyUsd), delta: 'live', color: 'var(--dig-faint)' },
  { label: 'Protocols tracked', value: `${netRaw.value.protocolCount ?? '—'}`, delta: 'venues', color: 'var(--dig-faint)' },
])

// ── protocol totals ──────────────────────────────────────────────────────────
const protocolRows = computed(() => {
  const map = new Map<string, { id: string; name: string; type: string; logoUrl: string | null; tvl: number; count: number; stale: boolean; topPool: string }>()
  for (const p of pools.value) {
    const id = p.protocol.id
    const cur = map.get(id) ?? { id, name: p.protocol.name, type: p.protocol.type, logoUrl: p.protocol.logoUrl ?? null, tvl: 0, count: 0, stale: false, topPool: p.id }
    cur.tvl += p.metrics.tvlUsd ?? 0
    cur.count += 1
    if (p.isStale === true) cur.stale = true
    const top = pools.value.find((x) => x.id === cur.topPool)
    if (!top || (p.metrics.tvlUsd ?? 0) > (top.metrics.tvlUsd ?? 0)) cur.topPool = p.id
    map.set(id, cur)
  }
  return [...map.values()].sort((a, b) => b.tvl - a.tvl).map((c) => ({ ...c, theme: venueTheme(c.id) }))
})

// ── alerts summary (real notifications) ──────────────────────────────────────
const recentAlerts = computed(() => notifications.value.slice(0, 3))

// ── bridge (existing data) ───────────────────────────────────────────────────
const {
  window: bridgeWindow,
  totals: bridgeTotals,
  buckets: bridgeBuckets,
  routes: bridgeRoutes,
  flows: bridgeFlows,
  chainScope: bridgeChainScope,
  daysSinceLastFlow: bridgeDaysSinceLastFlow,
  routeSort: bridgeRouteSort,
  flowSort: bridgeFlowSort,
  loading: bridgeLoading,
  error: bridgeError,
  setWindow: setBridgeWindow,
  setChainScope: setBridgeChainScope,
  clearScope: clearBridgeScope,
  sortRoutes: sortBridgeRoutes,
  sortFlows: sortBridgeFlows,
  load: loadBridge,
} = useBridge()
</script>

<template>
  <div class="max-w-[1180px] mx-auto px-[26px] py-[26px] flex flex-col gap-[16px]" style="animation: digFade .35s ease both">
    <!-- Hero + alerts summary -->
    <div class="grid gap-[16px]" style="grid-template-columns: 1.5fr 1fr">
      <div class="rounded-[18px] p-[24px]" style="background: var(--dig-surface); border: 1px solid var(--dig-line)">
        <div class="flex items-center justify-between gap-[14px]">
          <div class="text-[13px] font-medium" style="color: var(--dig-faint)">Stellar DeFi network</div>
          <FreshnessChip :updated-at="netUpdatedAt" :is-stale="netStale" :stale-after-seconds="netStaleAfter" />
        </div>
        <div class="flex items-end gap-[14px] mt-[8px]">
          <div class="text-[42px] font-bold tracking-[-0.03em] tabular-nums">{{ heroTvl }}</div>
          <div class="text-[13px] mb-[10px]" style="color: var(--dig-faint)">total value tracked</div>
        </div>
        <div v-if="heroNetTvl" class="text-[13px] mt-[2px]" style="color: var(--dig-faint)">
          Net TVL (supplied − borrowed): <span class="font-semibold tabular-nums" style="color: var(--dig-text)">{{ heroNetTvl }}</span>
        </div>

        <!-- G2: the inline Testnet/Mainnet actions section was removed; a swap is
             one click from here via the shared ActionModal (self-gated widgets +
             own NetworkToggle). The XLM price / Stablecoin MCap / Protocols stats
             that used to sit here are dropped — the four tiles below already show
             them. -->
        <div class="flex items-center gap-[10px] mt-[20px]">
          <button type="button" class="dig-btn h-[38px] px-[16px] rounded-[11px] text-[13px] font-semibold cursor-pointer flex items-center gap-[7px]" style="background: var(--dig-accent); color: #141414; border: none" @click="openSwap">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 10h14l-4-4"/><path d="M17 14H3l4 4"/></svg>
            Swap
          </button>
          <button type="button" class="dig-ghost h-[38px] px-[16px] rounded-[11px] text-[13px] font-semibold cursor-pointer flex items-center gap-[7px]" style="background: var(--dig-surface-3); border: 1px solid var(--dig-line); color: var(--dig-text)" @click="openDeposit">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M8 11l4 4 4-4"/><path d="M4 21h16"/></svg>
            Deposit
          </button>
        </div>

        <!-- G4: network-TVL 7d curve (from network_tvl_snapshots). -->
        <div class="mt-[20px]">
          <NetworkTvlChart :series="tvlSeries" :meta="tvlMeta" :loading="tvlLoading" :error="tvlError" @retry="loadTvl" />
        </div>
      </div>

      <div class="rounded-[18px] p-[22px] flex flex-col" style="background: var(--dig-surface); border: 1px solid var(--dig-line)">
        <div class="flex items-center justify-between">
          <div class="text-[14px] font-semibold flex items-center gap-[8px]">
            Alerts
            <span v-if="unreadCount > 0" class="text-[11px] font-semibold px-[7px] py-[1px] rounded-[20px]" style="background: #2A2A27; color: var(--dig-accent)">{{ unreadCount }}</span>
          </div>
          <button type="button" class="dig-chip text-[12px] font-semibold cursor-pointer px-[8px] py-[3px] rounded-[8px]" style="color: var(--dig-text)" @click="setView('alerts')">View all →</button>
        </div>
        <div v-if="recentAlerts.length" class="flex flex-col mt-[4px]">
          <button
            v-for="a in recentAlerts"
            :key="a.id"
            type="button"
            class="dig-row flex gap-[11px] px-[8px] py-[11px] rounded-[11px] cursor-pointer -mx-[8px] text-left"
            @click="setView('alerts')"
          >
            <span class="w-[30px] h-[30px] flex-shrink-0 rounded-[9px] flex items-center justify-center" :style="{ background: a.kind === 'alert_fired' ? '#371C16' : '#12301F', color: a.kind === 'alert_fired' ? '#D0522E' : 'var(--dig-green)' }">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.7 21a2 2 0 0 1-3.4 0"></path></svg>
            </span>
            <div class="min-w-0">
              <div class="text-[13px] font-semibold leading-[1.3] truncate" style="color: var(--dig-text)">{{ a.title }}</div>
              <div class="text-[12px] mt-[2px] truncate" style="color: var(--dig-faint)">{{ relativeTime(a.createdAt) }}</div>
            </div>
          </button>
        </div>
        <div v-else class="flex-1 flex items-center justify-center text-[12px] py-[20px]" style="color: var(--dig-faint)">No alerts yet.</div>
        <button type="button" class="dig-ghost mt-auto h-[40px] rounded-[11px] font-semibold text-[13px] cursor-pointer flex items-center justify-center gap-[7px]" style="background: var(--dig-surface-3); border: 1px solid var(--dig-line); color: var(--dig-faint)" @click="newAlertRule">
          <span class="text-[15px]">+</span> New alert rule
        </button>
      </div>
    </div>

    <!-- FAUCET PROMO (Lot R, R3): the offer is seen BEFORE any action.
         Self-hiding when the campaign is dark or the budget is spent. -->
    <FaucetPromoBanner />

    <!-- Stat strip -->
    <div class="grid gap-[16px]" style="grid-template-columns: repeat(4, 1fr)">
      <div v-for="s in statTiles" :key="s.label" class="rounded-[16px] px-[20px] py-[18px]" style="background: var(--dig-surface); border: 1px solid var(--dig-line)">
        <div class="text-[12px] font-medium" style="color: var(--dig-faint)">{{ s.label }}</div>
        <div class="text-[24px] font-bold tracking-[-0.02em] mt-[6px] tabular-nums">{{ s.value }}</div>
        <div class="text-[12px] font-semibold mt-[4px]" :style="{ color: s.color }">{{ s.delta }}</div>
      </div>
    </div>

    <!-- Protocols (half-width) + compact "Your positions" recap (H2, Lot H).
         The two panels stack below ~1100px; grid stretch keeps them same height. -->
    <div class="grid gap-[16px] grid-cols-1 min-[1100px]:grid-cols-2 items-stretch">
    <div class="rounded-[18px] p-[20px]" style="background: var(--dig-surface); border: 1px solid var(--dig-line)">
      <div class="flex items-center justify-between mb-[8px]">
        <div class="text-[14px] font-semibold">Protocols</div>
        <button type="button" class="dig-chip text-[12px] font-semibold cursor-pointer px-[8px] py-[3px] rounded-[8px]" style="color: var(--dig-text)" @click="setView('protocols')">All pools →</button>
      </div>
      <!-- honest empty / error states (don't render an empty header-only card) -->
      <div v-if="protocolsError && !protocolRows.length" class="py-[20px] text-center flex flex-col items-center gap-[10px]">
        <span class="text-[12px]" style="color: var(--dig-red)">Couldn't load protocol data.</span>
        <button type="button" class="dig-ghost h-[32px] px-[14px] rounded-[9px] text-[12px] font-semibold cursor-pointer" style="background: var(--dig-surface-3); border: 1px solid var(--dig-line); color: var(--dig-text)" @click="reloadProtocols">Retry</button>
      </div>
      <div v-else-if="loadingProtocols && !protocolRows.length" class="py-[20px] text-center text-[12px]" style="color: var(--dig-faint)">Loading protocols…</div>
      <div v-else-if="!protocolRows.length" class="py-[20px] text-center text-[12px]" style="color: var(--dig-faint)">No protocol data available.</div>
      <button
        v-for="p in protocolRows"
        :key="p.id"
        type="button"
        class="dig-row flex items-center gap-[12px] px-[8px] py-[12px] rounded-[11px] cursor-pointer -mx-[8px] w-[calc(100%+16px)] text-left"
        @click="openPool(p.topPool)"
      >
        <BrandLogo :primary="p.logoUrl" :fallback="p.theme.logo" :letter="p.theme.letter" :tint="p.theme.tint" :color="p.theme.color" :size="34" :radius="10" :font-size="15" :img-scale="0.72" />
        <div>
          <div class="text-[14px] font-semibold flex items-center gap-[7px]">
            {{ p.name }}
            <span v-if="p.stale" class="w-[7px] h-[7px] rounded-full" style="background: var(--dig-amber)" title="Some pools stale"></span>
          </div>
          <div class="text-[12px]" style="color: var(--dig-faint)">{{ p.type }}, {{ p.count }} pools</div>
        </div>
        <div class="ml-auto text-right">
          <div class="text-[14px] font-semibold tabular-nums">{{ formatUsd(p.tvl) }}</div>
          <div class="text-[12px]" style="color: var(--dig-faint)">TVL</div>
        </div>
      </button>
    </div>

    <YourPositionsPanel />
    </div>

    <!-- Bridge -->
    <BridgeSection
      :window="bridgeWindow"
      :totals="bridgeTotals"
      :buckets="bridgeBuckets"
      :routes="bridgeRoutes"
      :flows="bridgeFlows"
      :chain-scope="bridgeChainScope"
      :days-since-last-flow="bridgeDaysSinceLastFlow"
      :route-sort="bridgeRouteSort"
      :flow-sort="bridgeFlowSort"
      :loading="bridgeLoading"
      :error="bridgeError"
      @update:window="setBridgeWindow"
      @scope="setBridgeChainScope"
      @clearScope="clearBridgeScope"
      @sortRoutes="sortBridgeRoutes"
      @sortFlows="sortBridgeFlows"
      @retry="loadBridge"
    />
  </div>
</template>
