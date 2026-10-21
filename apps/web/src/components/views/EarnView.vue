<script setup lang="ts">
// EarnView — Lot EP (EP2, Earn v1.1 in EP4): the #earn view. Renders what
// GET /campaign, GET /campaign/me, GET /campaign/me/activity and
// GET /campaign/leaderboard return — nothing here computes points, streaks or
// multipliers (ai-guidelines layer rule). The view is reachable by URL even
// when the nav hides it (campaign inactive): it then says so plainly instead
// of promising anything. The API's disclaimer line is rendered ONCE, at the
// top, and nowhere else on the surface.
//
// EP4: PerksBlock is NOT rendered any more (founder decision 2026-10-21: perks
// are recorded by the backend and served on /me, but not surfaced in the UI
// yet). The component and its spec are kept for when they are.
import { computed, onMounted, onUnmounted, watch } from 'vue'
import { useCampaign } from '../../composables/useCampaign'
import EnrollCard from '../earn/EnrollCard.vue'
import EarnHeroCard from '../earn/EarnHeroCard.vue'
import StreakStrip from '../earn/StreakStrip.vue'
import EarnMoreCard from '../earn/EarnMoreCard.vue'
import TasksList from '../earn/TasksList.vue'
import ReferralCard from '../earn/ReferralCard.vue'
import ActivityFeed from '../earn/ActivityFeed.vue'
import LeaderboardTable from '../earn/LeaderboardTable.vue'
import EarnFaq from '../earn/EarnFaq.vue'
import type { CampaignTask, SocialTaskKey } from '../../api/campaign'

const {
  campaign,
  active,
  rules,
  disclaimer,
  me,
  meLoading,
  leaderboard,
  activity,
  identity,
  refreshCampaign,
  refreshMe,
  refreshLeaderboard,
} = useCampaign()

const POLL_MS = 60_000
let timer: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  void refreshCampaign(true)
  void refreshMe()
  void refreshLeaderboard()
  timer = setInterval(() => {
    void refreshCampaign(true)
    void refreshLeaderboard()
  }, POLL_MS)
})
onUnmounted(() => {
  if (timer) clearInterval(timer)
})

// The connected signer / app user changed → the /me payload is someone else's.
watch(identity, () => {
  void refreshMe()
  void refreshLeaderboard()
})

const state = computed<'loading' | 'inactive' | 'ready'>(() => {
  if (campaign.value === null) return 'loading'
  if (!active.value) return 'inactive'
  return 'ready'
})

const inactiveCopy = computed(() => {
  switch (campaign.value?.reason) {
    case 'campaign-not-started':
      return 'The Earn & Points campaign has not started yet.'
    case 'campaign-ended':
      return 'The Earn & Points campaign has ended.'
    default:
      return 'The Earn & Points campaign is not running right now.'
  }
})

const enrolled = computed(() => !!me.value?.enrolled)

// Not enrolled yet → the read-only catalogue from the public rules block.
const catalogueTasks = computed<CampaignTask[]>(() => {
  const r = rules.value
  if (!r) return []
  return (Object.keys(r.socialTasks) as SocialTaskKey[]).map((key) => ({
    key,
    ...r.socialTasks[key],
    claimed: false,
    claimId: null,
    claimedAt: null,
  }))
})
</script>

<template>
  <div class="max-w-[1180px] mx-auto px-[26px] py-[26px] max-md:px-[14px]" style="color: var(--dig-text)">
    <p class="mb-[4px] text-[12.5px]" style="color: var(--dig-faint)">
      Points for verified on-chain activity, streaks and social tasks
    </p>
    <!-- The API's disclaimer: ONCE at the top of the surface, nowhere else (EP4). -->
    <p v-if="state === 'ready' && disclaimer" class="mb-[14px] text-[11.5px] leading-[1.5]" style="color: var(--dig-faint)">
      {{ disclaimer }}
    </p>
    <div v-else class="mb-[10px]"></div>

    <!-- Loading / unknown -->
    <div v-if="state === 'loading'" class="flex flex-col gap-[12px]">
      <div class="h-[120px] rounded-[18px] animate-pulse" style="background: var(--dig-surface)"></div>
      <div class="h-[80px] rounded-[18px] animate-pulse" style="background: var(--dig-surface)"></div>
    </div>

    <!-- Inactive: say so, promise nothing -->
    <div
      v-else-if="state === 'inactive'"
      class="rounded-[18px] p-[22px] text-[13px]"
      style="background: var(--dig-surface); border: 1px solid var(--dig-line)"
    >
      <p class="m-0 font-semibold">{{ inactiveCopy }}</p>
      <p class="m-0 mt-[6px] text-[12px]" style="color: var(--dig-faint)">
        Nothing to do here for now. {{ disclaimer }}
      </p>
    </div>

    <template v-else>
      <!-- Hero (enrolled) or enrol -->
      <EarnHeroCard v-if="enrolled && me && rules" :me="me" :rules="rules" :rank="leaderboard?.me?.rank ?? null" />

      <EnrollCard v-else-if="!meLoading || !identity" />

      <div v-if="enrolled && me && rules" class="mt-[14px] flex flex-col gap-[14px]">
        <StreakStrip :me="me" :rules="rules" />
        <EarnMoreCard :me="me" :rules="rules" />
        <TasksList :tasks="me.tasks" enrolled />
        <ActivityFeed :activity="activity" />
        <ReferralCard v-if="me.referralCode" :code="me.referralCode" :rules="rules" />
      </div>
      <div v-else-if="rules" class="mt-[14px]">
        <TasksList :tasks="catalogueTasks" :enrolled="false" />
      </div>

      <!-- Leaderboard: public, shortened addresses only -->
      <section
        class="mt-[22px] rounded-[18px] p-[18px]"
        style="background: var(--dig-surface); border: 1px solid var(--dig-line)"
      >
        <h2 class="m-0 mb-[8px] text-[14px] font-bold tracking-[-0.02em]">Leaderboard</h2>
        <LeaderboardTable
          v-if="leaderboard"
          :rows="leaderboard.rows"
          :me="leaderboard.me"
          :as-of="leaderboard.asOf"
        />
        <p v-else class="text-[12.5px] m-0" style="color: var(--dig-faint)">Leaderboard unavailable right now.</p>
      </section>

      <div class="mt-[14px]">
        <EarnFaq :rules="rules" />
      </div>
    </template>
  </div>
</template>
