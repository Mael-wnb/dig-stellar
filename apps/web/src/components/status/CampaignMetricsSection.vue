<script setup lang="ts">
// CampaignMetricsSection — Lot EP (EP3). Public counts of the Earn & Points
// campaign at the bottom of #status, read from GET /v1/campaign/metrics
// (cacheable 60 s). Counts only, rendered as served; the API's boundary
// string is shown verbatim. Renders NOTHING while the campaign is dark
// (`dark: true`: disabled or no start date) or when the fetch fails — the
// status page must never advertise a campaign that is not running.
import { computed, onMounted, ref } from 'vue'
import { fetchCampaignMetrics, type CampaignMetrics } from '../../api/campaign'

const metrics = ref<CampaignMetrics | null>(null)

onMounted(async () => {
  try {
    metrics.value = await fetchCampaignMetrics()
  } catch {
    metrics.value = null
  }
})

const visible = computed(() => metrics.value !== null && !metrics.value.dark)

const n = (v: number) => v.toLocaleString('en-US')
const plural = (v: number, noun: string) => `${n(v)} ${noun}${v === 1 ? '' : 's'}`

const windowLabel = computed(() => {
  const m = metrics.value
  if (!m?.window.startsAt) return ''
  const fmt = (iso: string) => new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
  return m.window.endsAt ? `${fmt(m.window.startsAt)} → ${fmt(m.window.endsAt)}` : `since ${fmt(m.window.startsAt)}`
})

const stateLabel = computed(() => {
  const m = metrics.value
  if (!m) return ''
  if (m.active) return 'running'
  if (m.reason === 'campaign-ended') return 'ended'
  if (m.reason === 'campaign-not-started') return 'not started'
  return 'not running'
})

const rows = computed(() => {
  const m = metrics.value
  if (!m) return []
  const a = m.verifiedActionsByKind
  return [
    { label: 'Wallets registered (window)', value: n(m.walletsRegisteredInWindow) },
    { label: 'Wallets with an ownership proof (window)', value: n(m.walletsProvenInWindow) },
    { label: 'Wallets enrolled', value: n(m.walletsEnrolled) },
    { label: 'Wallets with a verified action (window)', value: n(m.walletsWithVerifiedActionInWindow) },
    {
      label: 'Verified actions (window)',
      value: `${plural(a['sdex-swap'], 'swap')} · ${plural(a['blend-deposit'], 'Blend deposit')} · ${plural(a['blend-withdraw'], 'Blend withdraw')}`,
    },
    { label: 'Referrals credited', value: n(m.referralsCredited) },
    { label: 'Social claims (self-declared, active)', value: n(m.socialClaimsActive) },
    { label: 'Points issued', value: n(m.pointsIssued) },
    {
      label: 'Perks granted',
      value: `${n(m.perksGranted['early-access'])} early access · ${n(m.perksGranted['beta-features'])} beta features · ${n(m.perksGranted['priority-rwa'])} priority RWA`,
    },
  ]
})
</script>

<template>
  <section v-if="visible && metrics" class="mt-[26px]" data-testid="campaign-metrics">
    <h2
      class="text-[10.5px] font-semibold uppercase tracking-[0.09em] mb-[8px]"
      style="color: var(--dig-faint)"
    >
      Campaign metrics · Earn &amp; Points · {{ stateLabel }} · {{ windowLabel }}
    </h2>

    <div
      class="rounded-[14px] divide-y"
      style="background: var(--dig-surface); border: 1px solid var(--dig-line); --tw-divide-opacity: 1"
    >
      <div
        v-for="r in rows"
        :key="r.label"
        class="px-[16px] py-[8px] flex items-center gap-[10px] flex-wrap"
        style="border-color: var(--dig-line-soft)"
      >
        <span class="text-[13px] font-semibold min-w-[150px]">{{ r.label }}</span>
        <span class="ml-auto text-[12.5px] tabular-nums" style="color: var(--dig-text-2)">{{ r.value }}</span>
      </div>
    </div>

    <p class="mt-[10px] text-[12px] leading-[1.6]" style="color: var(--dig-faint)">
      {{ metrics.boundary }} {{ metrics.disclaimer }}
    </p>
  </section>
</template>
