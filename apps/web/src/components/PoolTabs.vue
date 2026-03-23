<script setup lang="ts">
import type { Protocol, Pool } from '../data/protocols'

const props = defineProps<{
  protocols: Protocol[]
  selectedPoolId: string
  selectedProtocolId: string
}>()

const emit = defineEmits<{
  selectPool: [poolId: string]
  selectProtocol: [protocolId: string]
}>()

function handleClick(protocol: Protocol, pool: Pool) {
  emit('selectProtocol', protocol.id)
  emit('selectPool', pool.id)
}
</script>

<template>
  <div class="all-pools">
    <template v-for="protocol in protocols" :key="protocol.id">
      <div
        v-for="pool in protocol.pools"
        :key="pool.id"
        class="pool-tab"
        :class="{ active: pool.id === selectedPoolId }"
        :style="pool.id === selectedPoolId
          ? { borderColor: '#2a2a2a', borderLeftColor: protocol.iconColor, borderLeftWidth: '3px', background: '#1a1a1a' }
          : {}"
        @click="handleClick(protocol, pool)"
      >
        <div class="pool-header">
          <span
            class="pool-name"
            :style="pool.id === selectedPoolId ? { color: protocol.iconColor } : {}"
          >{{ pool.name }}</span>
        </div>
        <div class="pool-bottom">
          <span class="pool-proto">{{ protocol.name }}</span>
          <span class="pool-tvl-row">
            <span class="pool-type">TVL</span>
            <span
              class="pool-tvl"
              :style="pool.id === selectedPoolId ? { color: '#D5FF2F' } : {}"
            >{{ pool.tvl }}</span>
          </span>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.all-pools {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
}
@media (max-width: 700px) { .all-pools { grid-template-columns: repeat(2, 1fr); } }

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
.pool-tab:hover:not(.active) { border-color: #3a3a3a; }

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

.pool-proto { font-size: 11px; font-weight: 500; color: #9A9B99; }

.pool-tvl-row {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.pool-type { font-size: 10px; color: #555; letter-spacing: 0.08em; text-transform: uppercase; }
.pool-tvl  { font-size: 11px; font-weight: 600; color: #9A9B99; }
</style>