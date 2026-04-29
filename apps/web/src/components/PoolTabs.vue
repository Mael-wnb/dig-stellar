<script setup lang="ts">
import { PROTOCOL_META } from '../data/protocolMeta'
import type { PoolListItem } from '../types/protocol'

defineProps<{
  pools: PoolListItem[]
  selectedPoolId: string
}>()

const emit = defineEmits<{
  selectPool: [poolId: string]
}>()

function formatUsdCompact(value?: number | null): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`
  return `$${value.toFixed(0)}`
}

function getProtocolMeta(protocolId: string) {
  return (
    PROTOCOL_META[protocolId] ?? {
      icon: '•',
      iconColor: '#D5FF2F',
      iconBg: '#1a1a1a',
    }
  )
}
</script>

<template>
  <div class="grid grid-cols-2 md:grid-cols-4 gap-[6px]">

    <div
      v-for="pool in pools"
      :key="pool.id"
      @click="emit('selectPool', pool.id)"
      class="group cursor-pointer rounded-[10px] px-[12px] py-[10px] border flex flex-col gap-[8px] transition-all"

      :class="pool.id === selectedPoolId
        ? 'bg-[#1a1a1a] border-[#D5FF2F]/50'
        : 'bg-[#181818] border-[#2a2a2a] hover:border-[#3a3a3a]'"
    >

      <!-- TOP -->
      <div class="flex items-center justify-between gap-[6px]">

        <!-- NAME -->
        <span
          class="text-[14px] font-semibold truncate"
          :class="pool.id === selectedPoolId
            ? 'text-[#D5FF2F]'
            : 'text-[#E2E6E1]'"
        >
          {{ pool.name }}
        </span>

        <!-- PROTOCOL BADGE -->
        <div
          class="flex items-center gap-[4px] text-[11px] px-[6px] py-[2px] rounded-[4px]"
          :style="{
            background: getProtocolMeta(pool.protocol?.id || '').iconBg,
            color: getProtocolMeta(pool.protocol?.id || '').iconColor
          }"
        >
          <span>{{ getProtocolMeta(pool.protocol?.id || '').icon }}</span>
        </div>

      </div>

      <!-- BOTTOM -->
      <div class="flex items-center justify-between text-[11px]">

        <!-- PROTOCOL NAME -->
        <span class="text-[#9A9B99] truncate">
          {{ pool.protocol?.name }}
        </span>

        <!-- TVL -->
        <div class="flex items-center gap-[4px]">

          <span class="uppercase text-[9px] tracking-wider text-[#5e5f5d]">
            TVL
          </span>

          <span
            class="font-semibold"
            :class="pool.id === selectedPoolId
              ? 'text-[#D5FF2F]'
              : 'text-[#9A9B99] group-hover:text-[#E2E6E1]'"
          >
            {{ formatUsdCompact(pool.metrics?.tvlUsd) }}
          </span>

        </div>

      </div>

    </div>

  </div>
</template>