<script setup lang="ts">
// EarnHeroCard — Lot EP (EP4). The top card of the Earn view: balance, today's
// points, the streak progress toward the ramp cap and the pending badge. Every
// figure is the API's (/me balance, pointsToday, streak.*, pendingVerification;
// rules.streak cap / daysToCap); nothing is computed here. The bar width is
// the API's daysToCap turned into a percentage, not a streak computation.
//
// Founder precision (STOP-AND-SHOW 1, 2026-10-21): when streak.daysToCap is 0
// but multiplierForToday is still below the cap (the multiplier is fixed on
// D-1), say "×cap from tomorrow" rather than let the bar and the figure disagree.
// Deploy order (SHOW 2): without rules.streak or streak.daysToCap (older API)
// the card renders without the streak line and the bar, never throws.
import { computed } from 'vue'
import type { CampaignMe, CampaignRules } from '../../api/campaign'

const props = defineProps<{
  me: CampaignMe
  rules: CampaignRules
  /** The caller's leaderboard rank, when the leaderboard payload has it. */
  rank?: number | null
}>()

/** Both halves the streak line and the bar need; null while an older API answers. */
const ramp = computed(() => {
  const r = props.rules.streak
  const d = props.me.streak.daysToCap
  if (!r || d == null) return null
  return { cap: r.cap, total: r.daysToCap, daysToCap: d }
})

const todayLabel = computed(() => `×${props.me.streak.multiplierForToday.toFixed(2)}`)

/** Days reached toward the cap, as the API states it (daysToCap counts what is still missing). */
const daysReached = computed(() => (ramp.value ? Math.max(0, ramp.value.total - ramp.value.daysToCap) : 0))
const barPct = computed(() => {
  if (!ramp.value || ramp.value.total <= 0) return 0
  return Math.min(100, Math.round((daysReached.value / ramp.value.total) * 100))
})

const streakLine = computed(() => {
  if (!ramp.value) return null
  const { cap, total, daysToCap } = ramp.value
  const capLabel = `×${cap.toFixed(2)}`
  const day = Math.min(props.me.streak.current, total)
  const head = `Streak day ${day} / ${total} · ${todayLabel.value} today`
  if (daysToCap === 0 && props.me.streak.multiplierForToday < cap) return `${head} · ${capLabel} from tomorrow`
  if (daysToCap === 0) return `${head} · cap reached`
  return `${head} · ${capLabel} after ${total} days`
})

const pendingLabel = computed(() => {
  const n = props.me.pendingVerification
  if (n <= 0) return null
  return `${n} ${n === 1 ? 'action' : 'actions'} awaiting verification (next check within 15 min)`
})
</script>

<template>
  <section
    class="rounded-[18px] p-[22px] max-md:p-[16px]"
    style="background: var(--dig-surface); border: 1px solid var(--dig-line)"
    data-testid="earn-hero"
  >
    <div class="flex items-start gap-[20px] flex-wrap">
      <div class="flex flex-col">
        <span class="text-[10.5px] font-semibold uppercase tracking-[0.09em]" style="color: var(--dig-faint)">Your points</span>
        <span class="text-[40px] font-bold tabular-nums leading-[1.05] mt-[4px]" style="color: var(--dig-accent)" data-testid="hero-balance">
          {{ props.me.balance.toLocaleString('en-US') }}
        </span>
      </div>

      <div class="flex flex-col pt-[18px] text-[12.5px] leading-[1.6]" style="color: var(--dig-text-2)">
        <span
          v-if="props.me.pointsToday != null"
          class="font-semibold tabular-nums"
          :style="props.me.pointsToday > 0 ? 'color: var(--dig-green)' : ''"
          data-testid="hero-today"
        >
          {{ props.me.pointsToday > 0 ? '+' : '' }}{{ props.me.pointsToday.toLocaleString('en-US') }} today
        </span>
        <span v-if="props.rank" data-testid="hero-rank">Rank #{{ props.rank }} on the leaderboard</span>
      </div>

      <span
        v-if="pendingLabel"
        class="ml-auto max-md:ml-0 inline-flex items-center min-h-[26px] px-[10px] py-[3px] rounded-[13px] text-[11.5px] font-semibold leading-[1.3]"
        style="background: rgba(255,184,107,0.12); border: 1px solid rgba(255,184,107,0.4); color: var(--dig-amber)"
        data-testid="hero-pending"
      >
        {{ pendingLabel }}
      </span>
    </div>

    <div v-if="ramp && streakLine" class="mt-[16px]">
      <div class="flex items-baseline justify-between gap-[10px] flex-wrap">
        <span class="text-[12px] font-medium" style="color: var(--dig-text-2)" data-testid="hero-streak-line">{{ streakLine }}</span>
      </div>
      <div
        class="mt-[6px] h-[8px] rounded-full overflow-hidden"
        style="background: var(--dig-surface-3, #2c2c29)"
        role="progressbar"
        :aria-valuenow="daysReached"
        aria-valuemin="0"
        :aria-valuemax="ramp.total"
        aria-label="Streak progress toward the multiplier cap"
      >
        <div class="h-full rounded-full" :style="`width: ${barPct}%; background: var(--dig-accent)`" data-testid="hero-bar"></div>
      </div>
    </div>
  </section>
</template>
