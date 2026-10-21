<script setup lang="ts">
// ActivityFeed — Lot EP (EP4). The wallet's last ledger rows exactly as
// GET /campaign/me/activity serves them: a human label per reason, relative
// time, the points with their sign, the multiplier when it is not ×1 and the
// API's 8-char tx hash on action rows. Nothing is summed or derived here.
import { computed } from 'vue'
import type { CampaignActivity, CampaignActivityRow } from '../../api/campaign'
import { activityLabel, signedPoints } from '../../lib/activityLabels'
import { relativeTime } from '../../utils/format'

const props = defineProps<{ activity: CampaignActivity | null }>()

const rows = computed<CampaignActivityRow[]>(() => props.activity?.rows ?? [])
</script>

<template>
  <section
    class="rounded-[18px] p-[18px]"
    style="background: var(--dig-surface); border: 1px solid var(--dig-line)"
    data-testid="activity-feed"
  >
    <div class="flex items-baseline justify-between flex-wrap gap-[8px]">
      <h2 class="m-0 text-[14px] font-bold tracking-[-0.02em]">Activity</h2>
      <span class="text-[11.5px]" style="color: var(--dig-faint)">Your last {{ rows.length }} points entries</span>
    </div>

    <p v-if="rows.length === 0" class="mt-[10px] mb-0 text-[12.5px]" style="color: var(--dig-faint)" data-testid="activity-empty">
      No activity yet. Check in or make a verified swap to start.
    </p>

    <ul v-else class="list-none m-0 p-0 mt-[10px] flex flex-col">
      <li
        v-for="(r, i) in rows"
        :key="`${r.createdAt}-${i}`"
        class="flex items-center gap-[10px] py-[8px] text-[12.5px]"
        :style="i < rows.length - 1 ? 'border-bottom: 1px solid var(--dig-line-soft, var(--dig-line))' : ''"
        :data-reason="r.reason"
      >
        <div class="flex flex-col flex-1 min-w-0">
          <span class="font-semibold truncate" data-testid="activity-label">{{ activityLabel(r.reason) }}</span>
          <span class="text-[11px] mt-[1px]" style="color: var(--dig-faint)">
            {{ relativeTime(r.createdAt) }}<template v-if="r.multiplier !== 1"> · ×{{ r.multiplier.toFixed(2) }}</template><template v-if="r.txHashShort"> · <span class="font-mono-geist">{{ r.txHashShort }}</span></template>
          </span>
        </div>
        <span
          class="font-bold tabular-nums"
          :style="r.points < 0 ? 'color: var(--dig-amber)' : 'color: var(--dig-accent)'"
          data-testid="activity-points"
        >{{ signedPoints(r.points) }} pts</span>
      </li>
    </ul>
  </section>
</template>
