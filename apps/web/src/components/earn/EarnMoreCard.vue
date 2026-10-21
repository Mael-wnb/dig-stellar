<script setup lang="ts">
// EarnMoreCard — Lot EP (EP4). One row per on-chain action that earns points:
// the points per verified action come from rules.actions[kind].basePoints,
// today's count and cap from /me actionsToday[kind], the pending pill from
// /me pendingByKind[kind]. NOTHING is computed here (EarnMoreCard.spec.ts
// asserts the figures are the payload's). The buttons open the existing
// action modal (useModals.openAction) with the SAME contexts as the Get-started
// card (lib/advertisedBlendPool): the deposit acts on the advertised Blend pool
// picked by the shared useAdvertisedBlendPool (network default when unknown).
import { computed, onMounted } from 'vue'
import type { AwardableActionKind, CampaignMe, CampaignRules } from '../../api/campaign'
import { useAdvertisedBlendPool } from '../../composables/useAdvertisedBlendPool'
import { useModals } from '../../composables/useModals'
import { blendDepositActionContext, sdexSwapActionContext } from '../../lib/advertisedBlendPool'

const props = defineProps<{ me: CampaignMe; rules: CampaignRules }>()
const { openAction } = useModals()
const { advertisedPool, load: loadAdvertisedPool } = useAdvertisedBlendPool()

onMounted(() => {
  void loadAdvertisedPool()
})

/** The exact context "Open deposit" opens; rendered as data-pool-slug so the spec can see it. */
const depositContext = computed(() => blendDepositActionContext(advertisedPool.value))

const ROW_META: Record<AwardableActionKind, { label: string; unit: string; cta: string }> = {
  'sdex-swap': { label: 'Swap', unit: 'per verified swap', cta: 'Open swap' },
  'blend-deposit': { label: 'Deposit on Blend', unit: 'per verified deposit', cta: 'Open deposit' },
}

const rows = computed(() =>
  (Object.keys(ROW_META) as AwardableActionKind[]).map((kind) => ({
    kind,
    ...ROW_META[kind],
    points: props.rules.actions[kind].basePoints,
    // Older API (deploy order): no today counts → the row shows the points only.
    line: props.me.actionsToday?.[kind]
      ? `+${props.rules.actions[kind].basePoints} pts ${ROW_META[kind].unit} · ${props.me.actionsToday[kind].counted}/${props.me.actionsToday[kind].cap} today`
      : `+${props.rules.actions[kind].basePoints} pts ${ROW_META[kind].unit}`,
    pending: props.me.pendingByKind?.[kind] ?? 0,
  })),
)

function open(kind: AwardableActionKind) {
  openAction(kind === 'sdex-swap' ? sdexSwapActionContext() : depositContext.value)
}
</script>

<template>
  <section
    class="rounded-[18px] p-[18px]"
    style="background: var(--dig-surface); border: 1px solid var(--dig-line)"
    data-testid="earn-more"
  >
    <div class="flex items-baseline justify-between flex-wrap gap-[8px]">
      <h2 class="m-0 text-[14px] font-bold tracking-[-0.02em]">Earn more</h2>
      <span class="text-[11.5px]" style="color: var(--dig-faint)">Verified on-chain actions · daily caps per UTC day</span>
    </div>

    <ul class="list-none m-0 p-0 mt-[12px] flex flex-col gap-[8px]">
      <li
        v-for="r in rows"
        :key="r.kind"
        class="rounded-[12px] px-[14px] py-[11px] flex items-center gap-[12px] flex-wrap"
        style="background: var(--dig-surface-2); border: 1px solid var(--dig-line-soft)"
        :data-kind="r.kind"
      >
        <div class="flex flex-col flex-1 min-w-[200px]">
          <span class="text-[13px] font-semibold">{{ r.label }}</span>
          <span class="text-[11.5px] mt-[2px] tabular-nums" style="color: var(--dig-faint)" data-testid="earn-more-line">
            {{ r.line }}
          </span>
        </div>

        <span
          v-if="r.pending > 0"
          class="inline-flex items-center h-[22px] px-[9px] rounded-full text-[11px] font-semibold tabular-nums"
          style="background: rgba(255,184,107,0.12); border: 1px solid rgba(255,184,107,0.4); color: var(--dig-amber)"
          data-testid="earn-more-pending"
        >
          {{ r.pending }} pending
        </span>

        <button
          type="button"
          class="dig-btn h-[32px] px-[14px] rounded-[10px] text-[12px] font-semibold cursor-pointer"
          style="background: var(--dig-accent); color: #141414; border: none"
          :data-pool-slug="r.kind === 'blend-deposit' ? (depositContext.poolSlug ?? '') : undefined"
          @click="open(r.kind)"
        >
          {{ r.cta }}
        </button>
      </li>
    </ul>

    <p class="mt-[10px] mb-0 text-[11px] leading-[1.5]" style="color: var(--dig-faint)">
      Points are credited by a periodic verification run, within about 15 minutes.
      Very small amounts below the minimum are not counted.
    </p>
  </section>
</template>
