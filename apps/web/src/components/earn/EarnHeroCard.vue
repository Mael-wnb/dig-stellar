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
//
// EP5: the XLM block — "Daily pool · N XLM shared by points" from rules.rewards,
// "Claimable: X XLM" from GET /campaign/rewards/me and a Claim button the view
// wires to POST /campaign/rewards/claim. The button is disabled below the API's
// minimum and then reads "X / 1 XLM minimum". Hidden entirely unless
// rules.rewards.enabled. No amount is computed here: the only logic is the
// comparison claimable < minimum, both figures the API's. Item 9: while the
// outbox is re-reporting hashes the hero says "Verifying N recent actions…".
import { computed } from 'vue'
import type { CampaignMe, CampaignRules, RewardsMe } from '../../api/campaign'
import { xlmLabel } from '../../lib/activityLabels'

const props = defineProps<{
  me: CampaignMe
  rules: CampaignRules
  /** The caller's leaderboard rank, when the leaderboard payload has it. */
  rank?: number | null
  /** EP5: GET /campaign/rewards/me; null while loading / disabled. */
  rewards?: RewardsMe | null
  /** EP5: a claim is in flight (button disabled). */
  claiming?: boolean
  /** EP5: the last claim's outcome line, written by the view from the API's answer. */
  claimMessage?: string | null
  /** EP5 item 9: hashes being re-reported right now. */
  verifying?: number
}>()

const emit = defineEmits<{ (e: 'claim'): void }>()

/** EP5: the rewards block renders only on this one API boolean. */
const rewardsRules = computed(() => (props.rules.rewards?.enabled ? props.rules.rewards : null))
const claimable = computed(() => (rewardsRules.value && props.rewards ? props.rewards.claimableXlm : null))
const belowMinimum = computed(() => {
  if (!rewardsRules.value || claimable.value == null) return true
  return claimable.value < (props.rewards?.minClaimXlm ?? rewardsRules.value.minClaimXlm)
})
const claimLabel = computed(() => {
  if (!rewardsRules.value) return ''
  if (props.claiming) return 'Claiming…'
  if (claimable.value == null) return 'Claim'
  if (belowMinimum.value) return `${claimable.value.toLocaleString('en-US', { maximumFractionDigits: 7 })} / ${props.rewards?.minClaimXlm ?? rewardsRules.value.minClaimXlm} XLM minimum`
  return 'Claim'
})
const verifyingLabel = computed(() => {
  const n = props.verifying ?? 0
  if (n <= 0) return null
  return `Verifying ${n} recent ${n === 1 ? 'action' : 'actions'}…`
})

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
      <span
        v-if="verifyingLabel"
        class="inline-flex items-center min-h-[26px] px-[10px] py-[3px] rounded-[13px] text-[11.5px] font-semibold leading-[1.3]"
        :class="pendingLabel ? '' : 'ml-auto max-md:ml-0'"
        style="background: var(--dig-surface-2); border: 1px solid var(--dig-line-soft); color: var(--dig-text-2)"
        data-testid="hero-verifying"
      >
        {{ verifyingLabel }}
      </span>
    </div>

    <div
      v-if="rewardsRules"
      class="mt-[16px] rounded-[12px] px-[14px] py-[12px] flex items-center gap-[12px] flex-wrap"
      style="background: var(--dig-surface-2); border: 1px solid var(--dig-line-soft)"
      data-testid="hero-rewards"
    >
      <div class="flex flex-col flex-1 min-w-[200px]">
        <span class="text-[12px] font-medium" style="color: var(--dig-text-2)" data-testid="hero-pool">
          Daily pool · {{ rewardsRules.dailyPoolXlm.toLocaleString('en-US', { maximumFractionDigits: 7 }) }} XLM shared by points
        </span>
        <span class="text-[14px] font-bold tabular-nums mt-[2px]" data-testid="hero-claimable">
          Claimable: {{ claimable == null ? '…' : xlmLabel(claimable) }}
        </span>
        <span v-if="props.claimMessage" class="text-[11.5px] mt-[4px]" style="color: var(--dig-text-2)" data-testid="hero-claim-message">{{ props.claimMessage }}</span>
      </div>
      <button
        type="button"
        class="dig-btn h-[32px] px-[14px] rounded-[10px] text-[12px] font-semibold tabular-nums"
        :class="belowMinimum || props.claiming ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'"
        style="background: var(--dig-accent); color: #141414; border: none"
        :disabled="belowMinimum || props.claiming"
        data-testid="hero-claim"
        @click="emit('claim')"
      >
        {{ claimLabel }}
      </button>
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
