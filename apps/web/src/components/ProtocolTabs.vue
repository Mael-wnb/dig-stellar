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
  <div class="grid grid-cols-4 gap-[6px] max-sm:grid-cols-2">

    <!-- PROTOCOLS -->
    <div
      v-for="p in protocols"
      :key="p.id"
      class="flex items-center gap-[10px] px-[12px] py-[10px] rounded-[10px] border cursor-pointer transition-all"
      :class="p.id === selectedProtocolId
        ? 'bg-[#1a1a1a] border-[#2a2a2a] border-l-[3px]'
        : 'bg-[#181818] border-[#2a2a2a] hover:border-[#3a3a3a]'"
      :style="p.id === selectedProtocolId
        ? { borderLeftColor: getProtocolMeta(p.id).iconColor }
        : {}"
      @click="emit('select', p.id)"
    >
      <div
        class="w-[30px] h-[30px] rounded-[8px] flex items-center justify-center text-[15px]"
        :style="{
          background: getProtocolMeta(p.id).iconBg,
          color: getProtocolMeta(p.id).iconColor
        }"
      >
        {{ getProtocolMeta(p.id).icon }}
      </div>

      <div class="flex flex-col gap-[2px] flex-1 min-w-0">
        <span
          class="text-[15px] font-bold truncate"
          :style="p.id === selectedProtocolId
            ? { color: getProtocolMeta(p.id).iconColor }
            : { color: '#E2E6E1' }"
        >
          {{ p.name }}
        </span>

        <span class="text-[13px] text-[#9A9B99]">
          {{ p.type }}
        </span>
      </div>
    </div>

    <!-- 🔥 CLICKABLE COMING SOON -->
    <div
      class="group relative flex flex-col items-center justify-center px-[12px] py-[10px] rounded-[10px] border border-dashed border-[#2a2a2a] bg-[#141414] cursor-pointer transition-all hover:border-[#D5FF2F]/40 hover:bg-[#181818]"
    >

      <!-- glow on hover -->
      <div class="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity bg-[radial-gradient(circle_at_center,rgba(213,255,47,0.08),transparent_70%)]"></div>

      <div class="relative flex flex-col items-center gap-[6px]">

        <!-- + ICON -->
        <div class="w-[28px] h-[28px] flex items-center justify-center rounded-full border border-[#D5FF2F]/30 text-[#D5FF2F] text-[16px] font-bold group-hover:scale-110 transition">
          +
        </div>

        <!-- TEXT -->
        <span class="text-[13px] text-[#9A9B99] font-medium group-hover:text-[#D5FF2F] transition">
          Coming soon
        </span>

        <span class="text-[11px] text-[#5e5f5d]">
          New protocol
        </span>

      </div>

    </div>

  </div>
</template>