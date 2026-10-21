<script setup lang="ts">
// ReferralCard — Lot EP (EP2). The wallet's own referral code (from /me) with
// copy buttons and the #earn?ref=CODE link. Points shown are the API's
// rules.referral values; the credit itself is decided by the award job.
import { computed, ref } from 'vue'
import type { CampaignRules } from '../../api/campaign'
import { inviteLink } from '../../lib/inviteLink'

const props = defineProps<{ code: string; rules: CampaignRules }>()

// Origin only (never the pathname): https://stellar.getdig.ai/#earn?ref=CODE in production.
const link = computed(() => {
  if (typeof window === 'undefined') return `/#earn?ref=${props.code}`
  return inviteLink(window.location.origin, props.code)
})

const copied = ref<'code' | 'link' | null>(null)
let timer: ReturnType<typeof setTimeout> | null = null

async function copy(kind: 'code' | 'link') {
  const text = kind === 'code' ? props.code : link.value
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    // Clipboard API unavailable (insecure context / permission): fall back to a selection copy.
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    try { document.execCommand('copy') } catch { /* nothing more we can do */ }
    document.body.removeChild(ta)
  }
  copied.value = kind
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => { copied.value = null }, 1800)
}
</script>

<template>
  <section
    class="rounded-[18px] p-[18px]"
    style="background: var(--dig-surface); border: 1px solid var(--dig-line)"
  >
    <div class="flex items-baseline justify-between flex-wrap gap-[8px]">
      <h2 class="m-0 text-[14px] font-bold tracking-[-0.02em]">Invite a friend</h2>
      <span class="text-[11.5px]" style="color: var(--dig-faint)">
        +{{ props.rules.referral.referrer }} pts for you · +{{ props.rules.referral.referee }} pts for them
      </span>
    </div>

    <p class="mt-[8px] text-[12px] leading-[1.6]" style="color: var(--dig-text-2)">
      Points are credited to both of you after your friend joins with your code and completes
      their first verified swap or Blend deposit.
    </p>

    <div class="mt-[12px] flex items-center gap-[10px] flex-wrap">
      <span
        class="font-mono-geist text-[16px] font-bold tracking-[0.12em] px-[14px] h-[38px] inline-flex items-center rounded-[11px]"
        style="background: var(--dig-surface-2); border: 1px solid var(--dig-line); color: var(--dig-accent)"
      >{{ props.code }}</span>
      <button
        type="button"
        class="dig-chip h-[38px] px-[14px] rounded-[11px] text-[12.5px] font-semibold cursor-pointer"
        style="background: var(--dig-surface-3); border: 1px solid var(--dig-line); color: var(--dig-text)"
        @click="copy('code')"
      >
        {{ copied === 'code' ? 'Copied ✓' : 'Copy code' }}
      </button>
      <button
        type="button"
        class="dig-chip h-[38px] px-[14px] rounded-[11px] text-[12.5px] font-semibold cursor-pointer"
        style="background: var(--dig-surface-3); border: 1px solid var(--dig-line); color: var(--dig-text)"
        @click="copy('link')"
      >
        {{ copied === 'link' ? 'Copied ✓' : 'Copy invite link' }}
      </button>
    </div>

    <p class="mt-[8px] text-[11px] font-mono-geist break-all" style="color: var(--dig-faint)">{{ link }}</p>
  </section>
</template>
