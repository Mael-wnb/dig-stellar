<script setup lang="ts">
// AnalyticsConsentBanner — Lot AN0. One small bar at the bottom of the shell,
// shown once until answered (the answer is kept in localStorage by the lib) and
// re-openable from the sidebar "Analytics" link. Renders nothing at all when
// no measurement id is configured (local, preview, tests): there is nothing to
// consent to. Accept loads gtag.js and grants analytics_storage; Decline keeps
// everything off. Visual language: the shell's surface / line / accent tokens.
import { computed } from 'vue'
import {
  ANALYTICS_CONSENT_COPY,
  analyticsBannerOpen,
  analyticsConsent,
  isAnalyticsConfigured,
  setAnalyticsConsent,
} from '../../lib/analytics'

const configured = isAnalyticsConfigured()

const visible = computed(
  () => configured && (analyticsConsent.value === null || analyticsBannerOpen.value),
)
</script>

<template>
  <div
    v-if="visible"
    role="dialog"
    aria-live="polite"
    aria-label="Analytics consent"
    class="fixed z-40 bottom-[16px] left-[16px] right-[16px] sm:left-auto sm:right-[20px] sm:max-w-[520px] rounded-[14px] px-[16px] py-[14px] flex flex-col sm:flex-row sm:items-center gap-[12px]"
    style="background: var(--dig-surface); border: 1px solid var(--dig-line); box-shadow: 0 12px 36px -16px rgba(0,0,0,.6)"
  >
    <p class="text-[12.5px] leading-[1.45] m-0 flex-1" style="color: var(--dig-text-2)">
      {{ ANALYTICS_CONSENT_COPY }}
    </p>
    <div class="flex gap-[8px] flex-shrink-0">
      <button
        type="button"
        class="dig-ghost h-[36px] px-[14px] rounded-[10px] text-[12.5px] font-semibold cursor-pointer transition-colors"
        style="background: var(--dig-surface-3); border: 1px solid var(--dig-line); color: var(--dig-text)"
        @click="setAnalyticsConsent('denied')"
      >
        Decline
      </button>
      <button
        type="button"
        class="dig-btn h-[36px] px-[14px] rounded-[10px] text-[12.5px] font-semibold cursor-pointer"
        style="background: var(--dig-accent); color: #141414; border: none"
        @click="setAnalyticsConsent('granted')"
      >
        Accept analytics
      </button>
    </div>
  </div>
</template>
