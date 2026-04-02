<!-- src/components/PoolTabs.vue -->
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
      iconBg: '#1a1a1a',
    }
  )
}
</script>

<template>
  <div class="all-pools">
    <div
      v-for="pool in props.pools"
      :key="pool.id"
      class="pool-tab"
      :class="{ active: pool.id === selectedPoolId }"
      :style="pool.id === selectedPoolId
        ? {
            borderColor: '#2a2a2a',
            borderLeftColor: getProtocolMeta(pool.protocol.id).iconColor,
            borderLeftWidth: '3px',
            background: '#1a1a1a'
          }
        : {}"
      @click="emit('selectPool', pool.id)"
    >
      <div class="pool-header">
        <span
          class="pool-name"
          :style="pool.id === selectedPoolId
            ? { color: getProtocolMeta(pool.protocol.id).iconColor }
            : {}"
        >
          {{ pool.name }}
        </span>
      </div>

      <div class="pool-bottom">
        <span class="pool-proto">{{ pool.protocol.name }}</span>
        <span class="pool-tvl-row">
          <span class="pool-type">TVL</span>
          <span
            class="pool-tvl"
            :style="pool.id === selectedPoolId ? { color: '#D5FF2F' } : {}"
          >
            {{ formatUsdCompact(pool.metrics.tvlUsd) }}
          </span>
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.all-pools {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
}
@media (max-width: 700px) {
  .all-pools {
    grid-template-columns: repeat(2, 1fr);
  }
}

.pool-tab {
  background: #181818;
  border: 1px solid #2a2a2a;
  border-radius: 10px;
  padding: 10px 12px;
  cursor: pointer;
  transition: border-left-color 0.15s, background 0.15s;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.pool-tab:hover:not(.active) {
  border-color: #3a3a3a;
}

.pool-header {
  display: flex;
  align-items: center;
}

.pool-name {
  font-size: 13px;
  font-weight: 700;
  color: #E2E6E1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pool-bottom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
}

.pool-proto {
  font-size: 11px;
  font-weight: 500;
  color: #9A9B99;
}

.pool-tvl-row {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.pool-type {
  font-size: 10px;
  color: #555;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.pool-tvl {
  font-size: 11px;
  font-weight: 600;
  color: #9A9B99;
}
</style>