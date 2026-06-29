<script setup lang="ts">
import { computed, ref } from 'vue'
import { useBridge } from '../composables/useBridge'
import { chainDisplayName } from '../constants/bridgeChains'
import { formatUsd } from '../utils/format'
import type { BridgeWindow, BridgeChainBreakdown, BridgeFlow } from '../api/bridge'

const { summary, flows, window, loading, error, setWindow } = useBridge()

const WINDOWS: BridgeWindow[] = ['24h', '7d', '30d']

// In / Out toggle for the "by source chain" block. Independent of the window
// toggle: window scopes the summary fetch, direction picks which byChain array
// to render. Default to inflow (the headline). Both arrays already arrive in
// the summary payload — no extra fetch.
type BridgeDirection = 'inflow' | 'outflow'
const DIRECTIONS: { value: BridgeDirection; label: string }[] = [
  { value: 'inflow', label: 'In' },
  { value: 'outflow', label: 'Out' },
]
const direction = ref<BridgeDirection>('inflow')

const outflowTotal = computed(() => summary.value?.outflow.totalUsd ?? 0)
const netUsd = computed(() => summary.value?.netUsd ?? 0)

// Active direction drives the block: its byChain list, total, and count. Width
// ranks against the active direction's own max so Out re-ranks on its own scale.
const activeChains = computed<BridgeChainBreakdown[]>(
  () => summary.value?.[direction.value].byChain ?? []
)
const activeTotal = computed(() => summary.value?.[direction.value].totalUsd ?? 0)
const activeCount = computed(() => summary.value?.[direction.value].count ?? 0)
const hasActive = computed(() => activeChains.value.length > 0)

const blockTitle = computed(() =>
  direction.value === 'inflow'
    ? 'Incoming — by source chain'
    : 'Outbound — by source chain'
)

const hasAnyData = computed(
  () =>
    (summary.value?.inflow.byChain.length ?? 0) > 0 ||
    (summary.value?.outflow.byChain.length ?? 0) > 0
)

function barWidth(amountUsd: number): string {
  const max = activeChains.value[0]?.amountUsd ?? 0
  if (max <= 0) return '0%'
  return `${Math.max(4, Math.round((amountUsd / max) * 100))}%`
}

// Relative time for the recent feed ("3h ago"). Web-side display only.
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return '—'
  const diffMs = Date.now() - then
  const sec = Math.max(0, Math.round(diffMs / 1000))
  if (sec < 60) return `${sec}s ago`
  const min = Math.round(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.round(hr / 24)
  return `${day}d ago`
}

function txLink(hash: string): string {
  return `https://stellar.expert/explorer/public/tx/${hash}`
}

// --- Recent-flows table: client-side sort + scroll-driven reveal -------------
// The API returns a fixed recent slice (no sort/cursor), so sorting and paging
// happen here over a COPY of the fetched array. The source `flows` ref is never
// mutated. Reveal grows as the user scrolls the fixed-height body — capped at
// the fetched slice (≤100); we never refetch.
const PAGE_SIZE = 20

type SortKey = 'direction' | 'amount' | 'time' | 'chain'
type SortDir = 'asc' | 'desc'

// Sensible default direction per column when first selected. 'direction' asc =
// inflow first ('inflow' < 'outflow' alphabetically).
const DEFAULT_SORT_DIR: Record<SortKey, SortDir> = {
  direction: 'asc',
  amount: 'desc',
  time: 'desc',
  chain: 'asc',
}

const sortKey = ref<SortKey>('time')
const sortDir = ref<SortDir>('desc')
const revealCount = ref(PAGE_SIZE)
const tableBody = ref<HTMLElement | null>(null)

// Click a header: toggle asc/desc if already active, else switch column with its
// default direction. Either way, reset the reveal to one page and scroll to top.
function setSort(key: SortKey): void {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortKey.value = key
    sortDir.value = DEFAULT_SORT_DIR[key]
  }
  revealCount.value = PAGE_SIZE
  if (tableBody.value) tableBody.value.scrollTop = 0
}

function sortIndicator(key: SortKey): string {
  if (sortKey.value !== key) return ''
  return sortDir.value === 'asc' ? '▲' : '▼'
}

const sortedFlows = computed<BridgeFlow[]>(() => {
  const copy = [...flows.value]
  const dir = sortDir.value === 'asc' ? 1 : -1
  copy.sort((a, b) => {
    let cmp = 0
    if (sortKey.value === 'direction') {
      cmp = a.direction.localeCompare(b.direction)
    } else if (sortKey.value === 'amount') {
      cmp = (a.amountUsd ?? 0) - (b.amountUsd ?? 0)
    } else if (sortKey.value === 'time') {
      cmp = new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime()
    } else {
      cmp = chainDisplayName(a.chain).localeCompare(chainDisplayName(b.chain))
    }
    return cmp * dir
  })
  return copy
})

const visibleFlows = computed(() => sortedFlows.value.slice(0, revealCount.value))

// Grow the reveal as the body scrolls near its bottom. Native @scroll → no
// listener teardown; the cap on sortedFlows.length guards against over-reveal.
function onTableScroll(e: Event): void {
  const el = e.target as HTMLElement | null
  if (!el) return
  if (el.scrollHeight - el.scrollTop - el.clientHeight > 24) return
  if (revealCount.value < sortedFlows.value.length) {
    revealCount.value = Math.min(revealCount.value + PAGE_SIZE, sortedFlows.value.length)
  }
}

const lastFlowLabel = computed(() => {
  if (!summary.value?.lastFlowAt) return null
  return relativeTime(summary.value.lastFlowAt)
})
</script>

<template>
  <section class="flex flex-col gap-3">
    <!-- SECTION HEADER -->
    <div class="flex items-center gap-3">
      <span class="text-[16px] text-[#D5FF2F] font-normal whitespace-nowrap">
        Bridge Flows
      </span>

      <div class="flex-1 h-px bg-[#7D922A]" />

      <span class="text-[14px] text-[#838583] font-light whitespace-nowrap">
        USDC bridged via Allbridge
      </span>
    </div>

    <!-- WINDOW SELECTOR -->
    <div class="flex items-center justify-between gap-2">
      <span class="text-[11px] text-[#717270]">
        <template v-if="lastFlowLabel">Last flow {{ lastFlowLabel }}</template>
        <template v-else>Incoming bridged assets, by source chain</template>
      </span>

      <div class="flex items-center gap-1">
        <button
          v-for="w in WINDOWS"
          :key="w"
          class="px-2 py-[3px] text-[11px] font-semibold rounded-[5px] transition"
          :class="
            w === window
              ? 'bg-[#373B26] border border-[#7D922A] text-[#D5FF2F]'
              : 'text-[#717270] border border-transparent hover:text-[#9a9b99]'
          "
          @click="setWindow(w)"
        >
          {{ w }}
        </button>
      </div>
    </div>

    <!-- ERROR -->
    <div
      v-if="error"
      class="bg-card border border-red-500/30 text-red-400 rounded-lg p-3 text-xs"
    >
      {{ error }}
    </div>

    <!-- LOADING SKELETON -->
    <div v-else-if="loading && !summary" class="grid grid-cols-3 gap-6 max-sm:grid-cols-1">
      <div class="col-span-2 max-sm:col-span-1 bg-[#2A2A2A] border border-[#383838] rounded-[12px] h-[260px] p-4 flex flex-col gap-3">
        <div class="w-40 h-4 bg-[#383838] rounded skeleton-pulse" />
        <div v-for="i in 4" :key="i" class="flex flex-col gap-2 mt-2">
          <div class="flex justify-between">
            <div class="w-24 h-3 bg-[#303030] rounded skeleton-pulse" />
            <div class="w-16 h-3 bg-[#303030] rounded skeleton-pulse" />
          </div>
          <div class="w-full h-2 bg-[#303030] rounded skeleton-pulse" />
        </div>
      </div>
      <div class="bg-[#2A2A2A] border border-[#383838] rounded-[12px] h-[260px] p-4 flex flex-col gap-3">
        <div class="w-24 h-4 bg-[#383838] rounded skeleton-pulse" />
        <div class="w-32 h-8 bg-[#383838] rounded skeleton-pulse mt-2" />
        <div class="w-28 h-6 bg-[#303030] rounded skeleton-pulse" />
      </div>
    </div>

    <!-- CONTENT -->
    <template v-else>
      <!-- TOP ROW: inflow headline (2/3) + outflow/net secondary (1/3) -->
      <div class="grid grid-cols-3 gap-6 max-sm:grid-cols-1">
        <!-- HEADLINE: incoming by source chain -->
        <div
          class="col-span-2 max-sm:col-span-1 bg-[#2A2A2A] border border-[#383838] rounded-[12px] p-4 flex flex-col gap-4"
        >
          <div class="flex items-center justify-between gap-3">
            <div class="flex items-center gap-3 min-w-0">
              <span class="text-[13px] font-semibold text-[#E2E6E1] truncate">
                {{ blockTitle }}
              </span>
              <!-- In / Out toggle — mirrors the window toggle styling -->
              <div class="flex items-center gap-1 shrink-0">
                <button
                  v-for="d in DIRECTIONS"
                  :key="d.value"
                  class="px-2 py-[3px] text-[11px] font-semibold rounded-[5px] transition"
                  :class="
                    d.value === direction
                      ? 'bg-[#373B26] border border-[#7D922A] text-[#D5FF2F]'
                      : 'text-[#717270] border border-transparent hover:text-[#9a9b99]'
                  "
                  @click="direction = d.value"
                >
                  {{ d.label }}
                </button>
              </div>
            </div>
            <span class="text-[13px] font-semibold text-[#D5FF2F] shrink-0">
              {{ formatUsd(activeTotal) }}
              <span class="text-[11px] text-[#717270] font-normal">
                · {{ activeCount }} flows
              </span>
            </span>
          </div>

          <!-- ranked horizontal bars -->
          <div v-if="hasActive" class="flex flex-col gap-3">
            <div
              v-for="row in activeChains"
              :key="row.chainId ?? row.chain ?? 'unknown'"
              class="flex flex-col gap-1"
            >
              <div class="flex items-center justify-between text-[12px]">
                <span class="text-[#E2E6E1] font-medium">
                  {{ chainDisplayName(row.chain) }}
                </span>
                <span class="text-[#9a9b99]">
                  {{ formatUsd(row.amountUsd) }}
                  <span class="text-[#717270]">· {{ row.count }}</span>
                </span>
              </div>
              <div class="w-full h-2 rounded-full bg-[#1f1f1f] overflow-hidden">
                <div
                  class="h-full rounded-full bg-[#D5FF2F]"
                  :style="{ width: barWidth(row.amountUsd) }"
                />
              </div>
            </div>
          </div>

          <!-- empty (no flows for the active direction in window) -->
          <div
            v-else
            class="flex-1 min-h-[120px] flex items-center justify-center text-[13px] text-[#5E5F5D] text-center px-4"
          >
            No {{ direction === 'inflow' ? 'incoming' : 'outbound' }} bridged flows in this window yet.
          </div>
        </div>

        <!-- SECONDARY: outflow + net -->
        <div
          class="bg-[#2A2A2A] border border-[#383838] rounded-[12px] p-4 flex flex-col gap-4"
        >
          <span class="text-[13px] font-semibold text-[#E2E6E1]">Outbound &amp; net</span>

          <div class="flex flex-col gap-1">
            <span class="text-[11px] uppercase tracking-[0.1em] text-[#717270]">
              Outflow
            </span>
            <span class="text-[18px] font-semibold text-[#C9CDC7]">
              {{ formatUsd(outflowTotal) }}
            </span>
            <span class="text-[11px] text-[#717270]">
              {{ summary?.outflow.count ?? 0 }} flows out
            </span>
          </div>

          <div class="h-px bg-[#383838]" />

          <div class="flex flex-col gap-1">
            <span class="text-[11px] uppercase tracking-[0.1em] text-[#717270]">
              Net (in − out)
            </span>
            <span
              class="text-[18px] font-semibold"
              :class="netUsd >= 0 ? 'text-[#D5FF2F]' : 'text-[#FF6B6B]'"
            >
              {{ netUsd >= 0 ? '+' : '' }}{{ formatUsd(netUsd) }}
            </span>
          </div>
        </div>
      </div>

      <!-- RECENT FLOWS FEED -->
      <div class="bg-[#2A2A2A] border border-[#383838] rounded-[12px] p-4 flex flex-col gap-3">
        <span class="text-[13px] font-semibold text-[#E2E6E1]">
          Recent bridged flows
        </span>

        <div v-if="sortedFlows.length" class="flex flex-col">
          <!-- HEADER ROW (outside the scroll body so columns stay visible).
               All four columns sort; Direction groups IN/OUT together. -->
          <div
            class="grid grid-cols-[auto_1fr_auto_auto] items-center gap-2 sm:gap-3 px-2 py-2 border-b border-[#383838] text-[11px] uppercase tracking-[0.06em] text-[#717270]"
          >
            <button
              type="button"
              class="flex items-center gap-1 text-left hover:text-[#9a9b99] transition"
              @click="setSort('direction')"
            >
              Flow
              <span class="text-[9px] text-[#D5FF2F] w-[8px]">{{ sortIndicator('direction') }}</span>
            </button>
            <button
              type="button"
              class="flex items-center gap-1 text-left hover:text-[#9a9b99] transition"
              @click="setSort('chain')"
            >
              Chain
              <span class="text-[9px] text-[#D5FF2F] w-[8px]">{{ sortIndicator('chain') }}</span>
            </button>
            <button
              type="button"
              class="flex items-center justify-end gap-1 hover:text-[#9a9b99] transition"
              @click="setSort('amount')"
            >
              Amount
              <span class="text-[9px] text-[#D5FF2F] w-[8px]">{{ sortIndicator('amount') }}</span>
            </button>
            <button
              type="button"
              class="flex items-center justify-end gap-1 hover:text-[#9a9b99] transition w-[58px] sm:w-[64px]"
              @click="setSort('time')"
            >
              Time
              <span class="text-[9px] text-[#D5FF2F] w-[8px]">{{ sortIndicator('time') }}</span>
            </button>
          </div>

          <!-- SCROLL BODY: fixed height (~20 rows), reveals +20 on scroll-to-bottom -->
          <div
            ref="tableBody"
            class="max-h-[680px] overflow-y-auto"
            @scroll="onTableScroll"
          >
            <!-- ROWS: whole row stays clickable to the tx explorer -->
            <a
              v-for="flow in visibleFlows"
              :key="flow.txHash"
              :href="txLink(flow.txHash)"
              target="_blank"
              rel="noopener noreferrer"
              class="grid grid-cols-[auto_1fr_auto_auto] items-center gap-2 sm:gap-3 px-2 py-2 rounded-[6px] hover:bg-[rgba(226,230,225,0.05)] transition"
            >
              <span
                class="text-[10px] font-semibold uppercase tracking-[0.08em] px-[6px] py-[2px] rounded-[4px]"
                :class="
                  flow.direction === 'inflow'
                    ? 'bg-[#373B26] text-[#D5FF2F]'
                    : 'bg-[#332A2A] text-[#C9A6A6]'
                "
              >
                {{ flow.direction === 'inflow' ? 'IN' : 'OUT' }}
              </span>
              <span class="text-[12px] text-[#E2E6E1] truncate min-w-0">
                {{ chainDisplayName(flow.chain) }}
                <span class="text-[#717270]">
                  {{ flow.direction === 'inflow' ? '→ Stellar' : '← Stellar' }}
                </span>
              </span>
              <span class="text-[12px] font-medium text-[#C9CDC7] text-right">
                {{ formatUsd(flow.amountUsd) }}
              </span>
              <span class="text-[11px] text-[#717270] text-right w-[58px] sm:w-[64px]">
                {{ relativeTime(flow.occurredAt) }}
              </span>
            </a>
          </div>
        </div>

        <!-- empty feed -->
        <div
          v-else
          class="min-h-[80px] flex items-center justify-center text-[13px] text-[#5E5F5D] text-center px-4"
        >
          {{
            hasAnyData
              ? 'No recent bridged flows to show.'
              : 'No bridged flows recorded yet — this section fills in as Allbridge activity is indexed.'
          }}
        </div>
      </div>
    </template>
  </section>
</template>
