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
      logo: '',
    }
  )
}
</script>

<template>
  <TransitionGroup
    name="pool-tab"
    tag="div"
    class="grid grid-cols-2 md:grid-cols-4 gap-2"
  >
    <div
      v-for="pool in pools"
      :key="pool.id"
      @click="emit('selectPool', pool.id)"
      class="group cursor-pointer rounded-xl px-3 py-3 border flex flex-col gap-2 transition-colors duration-200"
      :class="pool.id === selectedPoolId
        ? 'bg-[#2A2A2A] border-[#D5FF2F]/40'
        : 'bg-[#2A2A2A] border-[#383838] hover:border-[#4a4a4a]'"
    >
      <!-- TOP -->
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-2 min-w-0">
          <img
            v-if="getProtocolMeta(pool.protocol?.id || '').logo"
            :src="getProtocolMeta(pool.protocol?.id || '').logo"
            :alt="pool.protocol?.name"
            class="w-[18px] h-[18px] rounded shrink-0"
          />
          <span
            class="text-[14px] font-semibold truncate"
            :class="pool.id === selectedPoolId ? 'text-[#D5FF2F]' : 'text-[#E2E6E1]'"
          >
            {{ pool.name }}
          </span>
        </div>
      </div>

      <!-- BOTTOM -->
      <div class="flex items-center justify-between text-[11px]">
        <span class="text-[#5E5F5D] truncate">{{ pool.protocol?.name }}</span>
        <div class="flex items-center gap-1">
          <span class="uppercase text-[9px] tracking-wider text-[#5e5f5d]">TVL</span>
          <span
            class="font-semibold"
            :class="pool.id === selectedPoolId
              ? 'text-[#D5FF2F]'
              : 'text-[#5E5F5D] group-hover:text-[#E2E6E1]'"
          >
            {{ formatUsdCompact(pool.metrics?.tvlUsd) }}
          </span>
        </div>
      </div>
    </div>
  </TransitionGroup>
</template>

<style scoped>
.pool-tab-enter-active {
  transition: all 0.25s ease-out;
}
.pool-tab-leave-active {
  transition: all 0.15s ease-in;
}
.pool-tab-enter-from {
  opacity: 0;
  transform: translateY(8px);
}
.pool-tab-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
.pool-tab-move {
  transition: transform 0.25s ease;
}
</style>
