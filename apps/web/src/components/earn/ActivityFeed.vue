<script setup lang="ts">
// ActivityFeed — Lot EP (EP4). The wallet's last ledger rows exactly as
// GET /campaign/me/activity serves them: a human label per reason, relative
// time, the points with their sign, the multiplier when it is not ×1 and the
// API's 8-char tx hash on action rows. Nothing is summed or derived here.
// EP5: the wallet's PAID XLM claims (GET /campaign/rewards/me `paid`) are
// listed in the same feed as "XLM paid · <short hash>" with the API's amount;
// the two lists are merged by time only, never by value.
import { computed } from 'vue'
import type { CampaignActivity, CampaignActivityRow, RewardsMe } from '../../api/campaign'
import { activityLabel, signedPoints, xlmLabel } from '../../lib/activityLabels'
import { relativeTime } from '../../utils/format'

const props = defineProps<{ activity: CampaignActivity | null; paid?: RewardsMe['paid'] | null }>()

type FeedRow =
  | { type: 'points'; at: string; row: CampaignActivityRow }
  | { type: 'xlm'; at: string; claimId: string; xlm: number; txHashShort: string }

const rows = computed<FeedRow[]>(() => {
  const points: FeedRow[] = (props.activity?.rows ?? []).map((row) => ({ type: 'points', at: row.createdAt, row }))
  const xlm: FeedRow[] = (props.paid ?? []).map((p) => ({ type: 'xlm', at: p.paidAt, claimId: p.claimId, xlm: p.xlm, txHashShort: p.txHash.slice(0, 8) }))
  return [...points, ...xlm].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
})
</script>

<template>
  <section
    class="rounded-[18px] p-[18px]"
    style="background: var(--dig-surface); border: 1px solid var(--dig-line)"
    data-testid="activity-feed"
  >
    <div class="flex items-baseline justify-between flex-wrap gap-[8px]">
      <h2 class="m-0 text-[14px] font-bold tracking-[-0.02em]">Activity</h2>
      <span class="text-[11.5px]" style="color: var(--dig-faint)">Your last {{ rows.length }} entries</span>
    </div>

    <p v-if="rows.length === 0" class="mt-[10px] mb-0 text-[12.5px]" style="color: var(--dig-faint)" data-testid="activity-empty">
      No activity yet. Check in or make a verified swap to start.
    </p>

    <ul v-else class="list-none m-0 p-0 mt-[10px] flex flex-col">
      <li
        v-for="(r, i) in rows"
        :key="r.type === 'points' ? `${r.at}-${i}` : `xlm-${r.claimId}`"
        class="flex items-center gap-[10px] py-[8px] text-[12.5px]"
        :style="i < rows.length - 1 ? 'border-bottom: 1px solid var(--dig-line-soft, var(--dig-line))' : ''"
        :data-reason="r.type === 'points' ? r.row.reason : 'rewards:paid'"
      >
        <template v-if="r.type === 'points'">
          <div class="flex flex-col flex-1 min-w-0">
            <span class="font-semibold truncate" data-testid="activity-label">{{ activityLabel(r.row.reason) }}</span>
            <span class="text-[11px] mt-[1px]" style="color: var(--dig-faint)">
              {{ relativeTime(r.row.createdAt) }}<template v-if="r.row.multiplier !== 1"> · ×{{ r.row.multiplier.toFixed(2) }}</template><template v-if="r.row.txHashShort"> · <span class="font-mono-geist">{{ r.row.txHashShort }}</span></template>
            </span>
          </div>
          <span
            class="font-bold tabular-nums"
            :style="r.row.points < 0 ? 'color: var(--dig-amber)' : 'color: var(--dig-accent)'"
            data-testid="activity-points"
          >{{ signedPoints(r.row.points) }} pts</span>
        </template>
        <template v-else>
          <div class="flex flex-col flex-1 min-w-0">
            <span class="font-semibold truncate" data-testid="activity-label">XLM paid</span>
            <span class="text-[11px] mt-[1px]" style="color: var(--dig-faint)">
              {{ relativeTime(r.at) }} · tx <span class="font-mono-geist">{{ r.txHashShort }}</span>
            </span>
          </div>
          <span class="font-bold tabular-nums" style="color: var(--dig-green)" data-testid="activity-xlm">+{{ xlmLabel(r.xlm) }}</span>
        </template>
      </li>
    </ul>
  </section>
</template>
