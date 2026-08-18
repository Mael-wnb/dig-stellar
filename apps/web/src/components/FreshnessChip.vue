<script setup lang="ts">
// Freshness indicator (T3-D1). Shows "Updated Xm ago" in the muted style, and
// flips to an explicit amber "Stale — data older than Nm" when the data is
// older than the API's freshness threshold (FRESHNESS_STALE_AFTER_MINUTES).
import { computed } from 'vue'
import { relativeTime } from '../utils/format'

const props = defineProps<{
  updatedAt?: string | null
  isStale?: boolean | null
  staleAfterSeconds?: number | null
}>()

const staleMinutes = computed(() =>
  props.staleAfterSeconds ? Math.round(props.staleAfterSeconds / 60) : 45,
)

const label = computed(() => {
  if (props.isStale === true) {
    return `Stale: data older than ${staleMinutes.value}m`
  }
  if (props.updatedAt) {
    return `Updated ${relativeTime(props.updatedAt)}`
  }
  return 'Freshness unknown'
})
</script>

<template>
  <span
    class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium whitespace-nowrap"
    :class="
      isStale === true
        ? 'bg-[rgba(245,158,11,0.12)] text-[#F59E0B] border border-[rgba(245,158,11,0.35)]'
        : 'bg-[rgba(226,230,225,0.05)] text-[#838583] border border-[#383838]'
    "
    :title="isStale === true ? 'This source has not refreshed within the expected window.' : undefined"
  >
    <span
      class="w-1.5 h-1.5 rounded-full shrink-0"
      :class="isStale === true ? 'bg-[#F59E0B]' : 'bg-[#5E5F5D]'"
    />
    {{ label }}
  </span>
</template>
