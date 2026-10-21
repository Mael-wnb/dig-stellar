<script setup lang="ts">
// StreakStrip — Lot EP (EP2). Current streak, today's multiplier and the
// check-in button. Every number is the API's (/me streak, rules
// streakDailyPoints / streakMultipliers); nothing is derived here.
import { computed, ref } from 'vue'
import type { CampaignMe, CampaignRules, CampaignWriteReason } from '../../api/campaign'
import { useCampaign } from '../../composables/useCampaign'

const props = defineProps<{ me: CampaignMe; rules: CampaignRules }>()
const { checkin } = useCampaign()

const busy = ref(false)
const note = ref<string | null>(null)

const REASON_COPY: Partial<Record<CampaignWriteReason, string>> = {
  'already-checked-in': 'Already checked in today (UTC). Come back tomorrow.',
  'not-enrolled': 'Join the campaign first.',
  'ownership-proof-required': 'We could not verify this wallet. Please re-join.',
  'campaign-disabled': 'The campaign is not running right now.',
  'campaign-not-started': 'The campaign has not started yet.',
  'campaign-ended': 'The campaign has ended.',
}

// Tiers above ×1, ascending, straight from the API rules block.
const tiers = computed(() =>
  [...props.rules.streakMultipliers].filter((t) => t.multiplier > 1).sort((a, b) => a.minDays - b.minDays),
)

async function onCheckin() {
  note.value = null
  busy.value = true
  try {
    const res = await checkin()
    note.value = res.checkedIn
      ? `Checked in: +${res.points} pts.`
      : (REASON_COPY[res.reason] ?? 'Could not check in right now.')
  } catch (err) {
    note.value = err instanceof Error ? err.message : 'Could not check in right now.'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section
    class="rounded-[18px] p-[18px] flex items-center gap-[18px] flex-wrap"
    style="background: var(--dig-surface); border: 1px solid var(--dig-line)"
  >
    <div class="flex flex-col min-w-[120px]">
      <span class="text-[10.5px] font-semibold uppercase tracking-[0.09em]" style="color: var(--dig-faint)">Daily streak</span>
      <span class="text-[26px] font-bold tabular-nums leading-[1.1] mt-[4px]">
        {{ props.me.streak.current }}<span class="text-[13px] font-semibold ml-[5px]" style="color: var(--dig-faint)">{{ props.me.streak.current === 1 ? 'day' : 'days' }}</span>
      </span>
    </div>

    <div class="flex flex-col min-w-[140px]">
      <span class="text-[10.5px] font-semibold uppercase tracking-[0.09em]" style="color: var(--dig-faint)">Multiplier today</span>
      <span class="text-[26px] font-bold tabular-nums leading-[1.1] mt-[4px]" style="color: var(--dig-accent)">
        ×{{ props.me.streak.multiplierForToday.toFixed(2) }}
      </span>
      <span class="text-[11px] mt-[3px]" style="color: var(--dig-faint)">on action points</span>
    </div>

    <div class="flex flex-col text-[11.5px] leading-[1.6] flex-1 min-w-[200px]" style="color: var(--dig-faint)">
      <span>Check in once per UTC day for +{{ props.rules.streakDailyPoints }} pts.</span>
      <span v-if="tiers.length">
        Streak bonus:
        <template v-for="(t, i) in tiers" :key="t.minDays">
          {{ t.minDays }} days → ×{{ t.multiplier.toFixed(2) }}<span v-if="i < tiers.length - 1"> · </span>
        </template>
      </span>
    </div>

    <div class="flex flex-col items-end gap-[6px] ml-auto">
      <button
        type="button"
        class="dig-btn h-[38px] px-[16px] rounded-[11px] text-[13px] font-semibold cursor-pointer disabled:cursor-default disabled:opacity-70"
        :style="props.me.checkedInToday
          ? 'background: var(--dig-surface-3); color: var(--dig-muted); border: 1px solid var(--dig-line)'
          : 'background: var(--dig-accent); color: #141414; border: none'"
        :disabled="props.me.checkedInToday || busy"
        @click="onCheckin"
      >
        {{ props.me.checkedInToday ? 'Checked in today ✓' : busy ? 'Checking in…' : `Check in · +${props.rules.streakDailyPoints} pts` }}
      </button>
      <span v-if="note" class="text-[11.5px]" style="color: var(--dig-text-2)">{{ note }}</span>
    </div>
  </section>
</template>
