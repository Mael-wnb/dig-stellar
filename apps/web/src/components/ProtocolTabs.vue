<script setup lang="ts">
import { PROTOCOL_META } from '../data/protocolMeta'
import type { PoolListItem } from '../types/protocol'

interface ProtocolTabItem {
  id: string
  name: string
  type: string
}

const props = defineProps<{
  protocols: ProtocolTabItem[]
  selectedProtocolId: string
  pools: PoolListItem[]
}>()

const emit = defineEmits<{ select: [id: string] }>()

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

function getProtocolTvl(protocolId: string): string {
  const total = props.pools
    .filter((p) => p.protocol.id === protocolId)
    .reduce((sum, p) => sum + (p.metrics?.tvlUsd ?? 0), 0)

  if (!total) return '—'
  if (total >= 1_000_000_000) return `$${(total / 1_000_000_000).toFixed(1)}B`
  if (total >= 1_000_000) return `$${(total / 1_000_000).toFixed(1)}M`
  if (total >= 1_000) return `$${(total / 1_000).toFixed(1)}K`
  return `$${total.toFixed(0)}`
}
</script>

<template>
  <div class="grid grid-cols-2 gap-6 max-sm:grid-cols-1">
    <div
      v-for="p in protocols"
      :key="p.id"
      class="flex items-center justify-between px-4 py-4 rounded-xl border cursor-pointer transition-all"
      :class="p.id === selectedProtocolId
        ? 'bg-[#2A2A2A] border-transparent'
        : 'bg-[#2A2A2A] border-[#383838] hover:border-[#4a4a4a]'"
      :style="p.id === selectedProtocolId
        ? { borderColor: getProtocolMeta(p.id).iconColor + '66' }
        : {}"
      @click="emit('select', p.id)"
    >
      <!-- Left: logo + text -->
      <div class="flex items-center gap-4">
        <img
          v-if="getProtocolMeta(p.id).logo"
          :src="getProtocolMeta(p.id).logo"
          :alt="p.name"
          class="w-[38px] h-[38px] rounded-lg shrink-0"
        />
        <div
          v-else
          class="w-[38px] h-[38px] rounded-lg flex items-center justify-center text-[18px] shrink-0"
          :style="{
            background: getProtocolMeta(p.id).iconBg,
            color: getProtocolMeta(p.id).iconColor,
          }"
        >
          {{ getProtocolMeta(p.id).icon }}
        </div>

        <div class="flex flex-col">
          <span
            class="text-[20px] font-bold leading-tight"
            style="font-family: 'Clash Display', sans-serif; letter-spacing: 0.01em"
            :style="{ color: p.id === selectedProtocolId ? '#E2E6E1' : '#838583' }"
          >
            {{ p.name }}
          </span>
          <span class="text-[16px] text-[#5E5F5D]">
            {{ p.type }}
          </span>
        </div>
      </div>

      <!-- Right: TVL -->
      <div class="flex flex-col items-end">
        <span
          class="text-[14px] font-semibold"
          :style="{ color: p.id === selectedProtocolId ? '#D5FF2F' : '#5E5F5D' }"
        >
          {{ getProtocolTvl(p.id) }}
        </span>
        <span class="text-[16px] text-[#5E5F5D]">TVL</span>
      </div>
    </div>
  </div>
</template>
