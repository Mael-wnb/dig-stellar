<script setup lang="ts">
// StreakStrip — Lot EP (EP2, redesigned in EP4). Seven boxes for the last 7
// UTC days (/me streak.last7), checked days marked, today highlighted. Each
// box shows the multiplier that applied ON that day under the D-1 rule
// (last7[i].multiplier, computed by the API — nothing is derived here);
// unchecked days show "—"; today keeps multiplierForToday (the same value).
// The check-in button lives inside the card. At phone width the boxes wrap to
// two rows (4 + 3). Deploy order (SHOW 2): without rules.streak or last7
// (older API) the card renders without boxes / multiplier labels, never throws.
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

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** 'YYYY-MM-DD' (UTC day) → weekday label, without touching the local time zone. */
function weekdayOf(day: string): string {
  const d = new Date(`${day}T00:00:00.000Z`)
  return Number.isFinite(d.getTime()) ? WEEKDAY[d.getUTCDay()] : day
}

const todayLabel = computed(() => `×${props.me.streak.multiplierForToday.toFixed(2)}`)

/** One box per last7 entry (oldest first), with the label the API's figures give it. */
const boxes = computed(() => {
  const last7 = props.me.streak.last7 ?? []
  return last7.map((d, i) => {
    const isToday = i === last7.length - 1
    const label = isToday
      ? todayLabel.value
      : !d.checkedIn
        ? '—'
        : typeof d.multiplier === 'number'
          ? `×${d.multiplier.toFixed(2)}`
          : ''
    return { day: d.day, weekday: weekdayOf(d.day), checkedIn: d.checkedIn, isToday, label }
  })
})

const dailyPoints = computed(() => props.rules.streak?.dailyPoints ?? props.rules.streakDailyPoints)
/** The copy line; the D-1 sentence only when rules.streak is served (older API: first sentence only). */
const copyLine = computed(() => {
  const base = 'Check in once per UTC day. Miss a day and the streak resets.'
  const r = props.rules.streak
  if (!r) return base
  return `${base} Your multiplier each day comes from the days you checked in before it: ${r.daysToCap} in a row → ×${r.cap.toFixed(2)}.`
})

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
    class="rounded-[18px] p-[18px]"
    style="background: var(--dig-surface); border: 1px solid var(--dig-line)"
    data-testid="streak-strip"
  >
    <div class="flex items-baseline justify-between flex-wrap gap-[8px]">
      <h2 class="m-0 text-[14px] font-bold tracking-[-0.02em]">Daily streak</h2>
      <span class="text-[11.5px]" style="color: var(--dig-faint)">
        {{ props.me.streak.current }} {{ props.me.streak.current === 1 ? 'day' : 'days' }} · {{ todayLabel }} on action points today
      </span>
    </div>

    <div v-if="boxes.length" class="mt-[12px] grid grid-cols-7 max-md:grid-cols-4 gap-[8px]" data-testid="streak-boxes">
      <div
        v-for="b in boxes"
        :key="b.day"
        class="flex flex-col items-center justify-between gap-[4px] rounded-[12px] px-[6px] py-[8px] min-h-[78px]"
        :style="b.isToday
          ? 'background: rgba(213,255,47,0.08); border: 1px solid var(--dig-accent)'
          : b.checkedIn
            ? 'background: var(--dig-surface-2, #242422); border: 1px solid var(--dig-line)'
            : 'background: var(--dig-surface-2, #242422); border: 1px solid var(--dig-line-soft, var(--dig-line)); opacity: .72'"
        :data-day="b.day"
        :data-checked="b.checkedIn ? 'true' : 'false'"
        :data-today="b.isToday ? 'true' : 'false'"
      >
        <span class="text-[10.5px] font-semibold uppercase tracking-[.05em]" :style="b.isToday ? 'color: var(--dig-accent)' : 'color: var(--dig-faint)'">
          {{ b.isToday ? 'Today' : b.weekday }}
        </span>
        <span
          class="inline-flex items-center justify-center w-[22px] h-[22px] rounded-full text-[12px] font-bold"
          :style="b.checkedIn
            ? 'background: var(--dig-accent); color: #141414'
            : 'background: var(--dig-surface-3, #2c2c29); color: var(--dig-faint)'"
          :aria-label="b.checkedIn ? 'Checked in' : 'No check-in'"
        >{{ b.checkedIn ? '✓' : '·' }}</span>
        <span
          class="text-[11px] font-semibold tabular-nums"
          :style="b.isToday ? 'color: var(--dig-accent)' : b.checkedIn ? 'color: var(--dig-text-2)' : 'color: var(--dig-faint)'"
          data-testid="streak-box-label"
        >{{ b.label }}</span>
      </div>
    </div>

    <div class="mt-[12px] flex items-center gap-[12px] flex-wrap">
      <button
        type="button"
        class="dig-btn h-[38px] px-[16px] rounded-[11px] text-[13px] font-semibold cursor-pointer disabled:cursor-default disabled:opacity-70"
        :style="props.me.checkedInToday
          ? 'background: var(--dig-surface-3); color: var(--dig-muted); border: 1px solid var(--dig-line)'
          : 'background: var(--dig-accent); color: #141414; border: none'"
        :disabled="props.me.checkedInToday || busy"
        data-testid="checkin-button"
        @click="onCheckin"
      >
        {{ props.me.checkedInToday ? 'Checked in today ✓' : busy ? 'Checking in…' : `Check in · +${dailyPoints} pts` }}
      </button>
      <span class="text-[11.5px] leading-[1.5]" style="color: var(--dig-faint)" data-testid="streak-copy">{{ copyLine }}</span>
      <span v-if="note" class="text-[11.5px]" style="color: var(--dig-text-2)" data-testid="checkin-note">{{ note }}</span>
    </div>
  </section>
</template>
