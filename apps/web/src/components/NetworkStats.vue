<script setup lang="ts">
defineProps<{
  stats: { title: string; value: string; change?: string }[]
}>()
</script>

<template>
  <div class="grid grid-cols-2 md:grid-cols-8 gap-2">
    <div
      v-for="stat in stats"
      :key="stat.title"
      class="bg-card border border-border rounded-lg p-3 flex flex-col gap-1"
    >
      <span class="text-[10px] uppercase text-muted tracking-wider">
        {{ stat.title }}
      </span>

      <span class="text-sm font-semibold text-text">
        {{ stat.value }}
      </span>

      <span
        v-if="stat.change"
        class="text-[10px]"
        :class="stat.change.startsWith('-') ? 'text-red-400' : 'text-accent'"
      >
        {{ stat.change }}
      </span>
    </div>
  </div>
</template>