<script setup lang="ts">
import { computed } from 'vue'
import { useBridge } from '../composables/useBridge'
import { chainDisplayName } from '../constants/bridgeChains'
import { formatUsd } from '../utils/format'
import type { BridgeWindow, BridgeChainBreakdown } from '../api/bridge'

const { summary, flows, window, loading, error, setWindow } = useBridge()

const WINDOWS: BridgeWindow[] = ['24h', '7d', '30d']

// Inflow is the headline; share of total drives the bar widths.
const inflowChains = computed<BridgeChainBreakdown[]>(
  () => summary.value?.inflow.byChain ?? []
)
const inflowTotal = computed(() => summary.value?.inflow.totalUsd ?? 0)
const outflowTotal = computed(() => summary.value?.outflow.totalUsd ?? 0)
const netUsd = computed(() => summary.value?.netUsd ?? 0)

const hasInflows = computed(() => inflowChains.value.length > 0)
const hasAnyData = computed(
  () => hasInflows.value || (summary.value?.outflow.byChain.length ?? 0) > 0
)

function barWidth(amountUsd: number): string {
  const max = inflowChains.value[0]?.amountUsd ?? 0
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
          <div class="flex items-center justify-between">
            <span class="text-[13px] font-semibold text-[#E2E6E1]">
              Incoming — by source chain
            </span>
            <span class="text-[13px] font-semibold text-[#D5FF2F]">
              {{ formatUsd(inflowTotal) }}
              <span class="text-[11px] text-[#717270] font-normal">
                · {{ summary?.inflow.count ?? 0 }} flows
              </span>
            </span>
          </div>

          <!-- ranked horizontal bars -->
          <div v-if="hasInflows" class="flex flex-col gap-3">
            <div
              v-for="row in inflowChains"
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

          <!-- empty (no inflows in window) -->
          <div
            v-else
            class="flex-1 min-h-[120px] flex items-center justify-center text-[13px] text-[#5E5F5D] text-center px-4"
          >
            No incoming bridged flows in this window yet.
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

        <div v-if="flows.length" class="flex flex-col">
          <a
            v-for="flow in flows"
            :key="flow.txHash"
            :href="txLink(flow.txHash)"
            target="_blank"
            rel="noopener noreferrer"
            class="flex items-center justify-between gap-3 px-2 py-2 rounded-[6px] hover:bg-[rgba(226,230,225,0.05)] transition"
          >
            <div class="flex items-center gap-2 min-w-0">
              <span
                class="text-[10px] font-semibold uppercase tracking-[0.08em] px-[6px] py-[2px] rounded-[4px] shrink-0"
                :class="
                  flow.direction === 'inflow'
                    ? 'bg-[#373B26] text-[#D5FF2F]'
                    : 'bg-[#332A2A] text-[#C9A6A6]'
                "
              >
                {{ flow.direction === 'inflow' ? 'IN' : 'OUT' }}
              </span>
              <span class="text-[12px] text-[#E2E6E1] truncate">
                {{ chainDisplayName(flow.chain) }}
                <span class="text-[#717270]">
                  {{ flow.direction === 'inflow' ? '→ Stellar' : '← Stellar' }}
                </span>
              </span>
            </div>

            <div class="flex items-center gap-3 shrink-0">
              <span class="text-[12px] font-medium text-[#C9CDC7]">
                {{ formatUsd(flow.amountUsd) }}
              </span>
              <span class="text-[11px] text-[#717270] w-[58px] text-right">
                {{ relativeTime(flow.occurredAt) }}
              </span>
            </div>
          </a>
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
