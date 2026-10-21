<script setup lang="ts">
// PerksBlock — Lot EP (EP3). The wallet's NON-MONETARY perks (badges) and the
// next tier with the points still missing. Every value is the API's (/me perks
// + nextPerk, rules.perks thresholds); nothing is computed here. A perk once
// granted stays listed even if the balance later drops: the API says so, the
// block only renders. Nothing is gated on a perk yet (flags.beta is exposed by
// useCampaign for later).
import { computed } from 'vue'
import type { CampaignMe, CampaignRules, PerkKey } from '../../api/campaign'

const props = defineProps<{ me: CampaignMe; rules: CampaignRules }>()

// Copy per tier (founder wording, 2026-10-21). Keys only here; thresholds from the API.
const PERK_META: Record<PerkKey, { label: string; description: string }> = {
  'early-access': { label: 'Early access', description: 'badge + early access to new views' },
  'beta-features': { label: 'Beta features', description: 'beta flag for features under test' },
  'priority-rwa': { label: 'Priority RWA', description: 'priority access to upcoming RWA products' },
}

const granted = computed(() => new Map(props.me.perks.map((p) => [p.key, p.grantedAt])))

// Tiers from the API rules block, ascending as served.
const tiers = computed(() => props.rules.perks)

function grantedOn(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

const nextCopy = computed(() => {
  const n = props.me.nextPerk
  if (!n) return 'Every perk unlocked.'
  const label = PERK_META[n.key]?.label ?? n.key
  if (n.pointsRemaining === 0) return `${label} reached · granted at the next sync (within ~15 min).`
  return `Next: ${label} at ${n.threshold.toLocaleString('en-US')} pts · ${n.pointsRemaining.toLocaleString('en-US')} pts to go.`
})
</script>

<template>
  <section
    class="rounded-[18px] p-[18px]"
    style="background: var(--dig-surface); border: 1px solid var(--dig-line)"
    data-testid="perks-block"
  >
    <div class="flex items-baseline gap-[10px] flex-wrap mb-[10px]">
      <h2 class="m-0 text-[14px] font-bold tracking-[-0.02em]">Perks</h2>
      <span class="text-[11.5px]" style="color: var(--dig-faint)">Non-monetary · badges, beta flags, early access</span>
    </div>

    <div class="flex flex-wrap gap-[8px]">
      <div
        v-for="t in tiers"
        :key="t.key"
        class="flex flex-col gap-[2px] px-[12px] py-[8px] rounded-[12px] min-w-[180px] flex-1"
        :style="granted.has(t.key)
          ? 'background: var(--dig-surface-2, #242422); border: 1px solid var(--dig-accent)'
          : 'background: var(--dig-surface-2, #242422); border: 1px solid var(--dig-line); opacity: .72'"
        :data-perk="t.key"
        :data-granted="granted.has(t.key) ? 'true' : 'false'"
      >
        <div class="flex items-center gap-[8px]">
          <span class="text-[13px] font-semibold">{{ PERK_META[t.key]?.label ?? t.key }}</span>
          <span
            class="ml-auto text-[10.5px] font-semibold uppercase tracking-[.04em] px-[7px] py-px rounded-full"
            :style="granted.has(t.key)
              ? 'background: var(--dig-accent); color: #141414'
              : 'background: var(--dig-surface-3, #2c2c29); color: var(--dig-faint)'"
          >
            {{ granted.has(t.key) ? 'Granted' : `${t.threshold.toLocaleString('en-US')} pts` }}
          </span>
        </div>
        <span class="text-[11.5px] leading-[1.5]" style="color: var(--dig-text-2)">{{ PERK_META[t.key]?.description ?? '' }}</span>
        <span v-if="granted.has(t.key)" class="text-[11px]" style="color: var(--dig-faint)">
          Granted {{ grantedOn(granted.get(t.key)!) }}
        </span>
      </div>
    </div>

    <p class="m-0 mt-[10px] text-[12px]" style="color: var(--dig-text-2)" data-testid="perks-next">{{ nextCopy }}</p>
  </section>
</template>
