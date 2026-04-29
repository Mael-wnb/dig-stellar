<script setup lang="ts">
import { PROTOCOL_META } from '../data/protocolMeta'
import type { PoolListItem } from '../types/protocol'

const props = defineProps<{
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
    }
  )
}
</script>

<template>
  <div class="grid grid-cols-2 md:grid-cols-4 gap-2">

    <div
      v-for="pool in pools"
      :key="pool.id"
      @click="emit('selectPool', pool.id)"
      class="cursor-pointer rounded-xl p-3 flex flex-col gap-2 border transition-all"

      :class="[
        pool.id === selectedPoolId
          ? 'bg-cardSoft border-accent'
          : 'bg-card border-border hover:border-accent/40'
      ]"
    >

      <!-- NAME -->
      <div class="flex items-center justify-between">
        <span
          class="text-sm font-semibold truncate"
          :class="pool.id === selectedPoolId ? 'text-accent' : 'text-text'"
        >
          {{ pool.name }}
        </span>
      </div>

      <!-- BOTTOM -->
      <div class="flex items-center justify-between text-xs">

        <span class="text-muted">
          {{ pool.protocol?.name }}
        </span>

        <span class="flex items-center gap-1">
          <span class="uppercase text-[10px] text-muted tracking-wider">
            TVL
          </span>

          <span
            class="font-semibold"
            :class="pool.id === selectedPoolId ? 'text-accent' : 'text-muted'"
          >
            {{ formatUsdCompact(pool.metrics?.tvlUsd) }}
          </span>
        </span>

      </div>

    </div>

  </div>
</template>