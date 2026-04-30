<script setup lang="ts">
defineProps<{
  stats: {
    title: string
    value: string
    change?: string
    highlight?: boolean
  }[]
}>()
</script>

<template>
  <div class="w-full rounded-xl border border-[#383838] bg-[#2A2A2A] overflow-hidden flex flex-wrap">

    <div
      v-for="(stat, i) in stats"
      :key="stat.title"
      class="flex flex-col justify-center items-center gap-1 p-3 sm:p-4 flex-1 min-w-[100px] relative"
      :class="[
        i !== stats.length - 1 ? 'border-r border-[#383838]' : '',
        stat.highlight ? 'bg-[#1a1f0e]' : ''
      ]"
    >

      <!-- TITLE -->
      <span class="text-[11px] text-[#7A7A7A]">
        {{ stat.title }}
      </span>

      <!-- VALUE -->
      <span
        class="text-[16px] font-semibold tracking-tight"
        :class="stat.highlight ? 'text-[#D5FF2F]' : 'text-[#E2E6E1]'"
      >
        {{ stat.value }}
      </span>

      <!-- CHANGE -->
      <span
        v-if="stat.change"
        class="text-[11px] font-medium"
        :class="stat.change.startsWith('-')
          ? 'text-[#FF5A5A]'
          : 'text-[#D5FF2F]'"
      >
        {{ stat.change }}
      </span>

      <!-- ACTIVE LINE -->
      <div
        v-if="stat.highlight"
        class="absolute bottom-0 left-0 w-full h-[2px] bg-[#D5FF2F]"
      />

    </div>

  </div>
</template>