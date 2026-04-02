<!-- src/components/ProtocolTabs.vue -->
<script setup lang="ts">
import { PROTOCOL_META } from '../data/protocolMeta'

interface ProtocolTabItem {
  id: string
  name: string
  type: string
}

defineProps<{
  protocols: ProtocolTabItem[]
  selectedProtocolId: string
}>()

const emit = defineEmits<{ select: [id: string] }>()

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
  <div class="proto-tabs">
    <div
      v-for="p in protocols"
      :key="p.id"
      class="proto-tab"
      :class="{ active: p.id === selectedProtocolId }"
      :style="p.id === selectedProtocolId
        ? {
            borderColor: '#2a2a2a',
            borderLeftColor: getProtocolMeta(p.id).iconColor,
            borderLeftWidth: '3px',
            background: '#1a1a1a'
          }
        : {}"
      @click="emit('select', p.id)"
    >
      <div
        class="proto-icon"
        :style="{
          background: getProtocolMeta(p.id).iconBg,
          color: getProtocolMeta(p.id).iconColor
        }"
      >
        {{ getProtocolMeta(p.id).icon }}
      </div>

      <div class="proto-info">
        <div class="proto-header">
          <span
            class="proto-name"
            :style="p.id === selectedProtocolId
              ? { color: getProtocolMeta(p.id).iconColor }
              : {}"
          >
            {{ p.name }}
          </span>
        </div>
        <span class="proto-type">{{ p.type }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.proto-tabs {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
}
@media (max-width: 640px) {
  .proto-tabs {
    grid-template-columns: repeat(2, 1fr);
  }
}

.proto-tab {
  background: #181818;
  border: 1px solid #2a2a2a;
  border-radius: 10px;
  padding: 10px 12px;
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  transition: border-left-color 0.15s, background 0.15s;
}
.proto-tab:hover:not(.active) {
  border-color: #3a3a3a;
}

.proto-icon {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 15px;
  flex-shrink: 0;
}

.proto-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}

.proto-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
}

.proto-name {
  font-size: 15px;
  font-weight: 700;
  color: #E2E6E1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.proto-type {
  font-size: 13px;
  color: #9A9B99;
}
</style>