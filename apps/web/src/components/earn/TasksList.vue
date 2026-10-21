<script setup lang="ts">
// TasksList — Lot EP (EP2). Self-declared social tasks: one handle per wallet,
// one claim per task; the API decides everything (claimed state, points, cap).
// The handle is sent to the API and never shown back (the API never returns
// it). Labels and the follow/join links below are UI copy; points, the
// x-repost URL and availability come from the payload (CAMPAIGN_X_REPOST_URL
// on the API: unset = "coming soon", not claimable, no hard-coded fallback).
// Removing a claim is a two-step inline confirm (no browser dialog).
import { computed, ref } from 'vue'
import type { CampaignTask, SocialClaimReason, SocialTaskKey } from '../../api/campaign'
import { useCampaign } from '../../composables/useCampaign'

const props = defineProps<{
  tasks: CampaignTask[]
  /** False → read-only catalogue (not enrolled yet). */
  enrolled: boolean
}>()

const { claimSocial, removeSocial } = useCampaign()

const TASK_META: Record<SocialTaskKey, { label: string; hint: string; href: string | null; cta: string }> = {
  'x-follow': {
    label: 'Follow Dig on X',
    hint: 'Follow @Dig_Agentic, then declare your X handle.',
    href: 'https://x.com/Dig_Agentic',
    cta: 'Open X ↗',
  },
  'x-repost': {
    label: 'Repost the Earn & Points post',
    hint: 'Repost the campaign post, then declare the same handle.',
    href: null, // the post URL comes from the API (task.url)
    cta: 'Open the post ↗',
  },
  'community-join': {
    label: 'Join the Dig Discord',
    hint: 'Join the server, then declare the same handle as above.',
    href: 'https://discord.gg/sDpqGfmDgF',
    cta: 'Open Discord ↗',
  },
}

/** The link for a task: the API's url when it serves one (x-repost), else the UI copy's. */
function taskHref(t: CampaignTask): string | null {
  return t.url ?? TASK_META[t.key]?.href ?? null
}

const REASON_COPY: Partial<Record<SocialClaimReason, string>> = {
  'already-claimed': 'This task is already claimed for this wallet.',
  'handle-mismatch': 'Use the same handle you declared for your other tasks (one handle per wallet).',
  'handle-already-used': 'This handle is already linked to another wallet.',
  'social-daily-cap-reached': 'Daily limit for social tasks reached. Try again tomorrow (UTC).',
  'unknown-task': 'Unknown task.',
  'task-unavailable': 'This task is not open yet.',
  'not-enrolled': 'Join the campaign first.',
  'ownership-proof-required': 'We could not verify this wallet. Please re-join.',
  'campaign-disabled': 'The campaign is not running right now.',
  'campaign-not-started': 'The campaign has not started yet.',
  'campaign-ended': 'The campaign has ended.',
}

const handle = ref('')
const busyTask = ref<SocialTaskKey | null>(null)
const confirmRemove = ref<SocialTaskKey | null>(null)
const notes = ref<Partial<Record<SocialTaskKey, string>>>({})

const handleLooksValid = computed(() => /^@?[A-Za-z0-9_.]{1,32}$/.test(handle.value.trim()))
const anyClaimed = computed(() => props.tasks.some((t) => t.claimed))

async function onClaim(task: CampaignTask) {
  notes.value = { ...notes.value, [task.key]: undefined }
  busyTask.value = task.key
  try {
    const res = await claimSocial(task.key, handle.value.trim())
    notes.value = {
      ...notes.value,
      [task.key]: res.claimed ? `Claimed: +${res.points} pts.` : (REASON_COPY[res.reason] ?? 'Could not claim right now.'),
    }
  } catch (err) {
    notes.value = { ...notes.value, [task.key]: err instanceof Error ? err.message : 'Could not claim right now.' }
  } finally {
    busyTask.value = null
  }
}

async function onRemove(task: CampaignTask) {
  if (!task.claimId) return
  busyTask.value = task.key
  confirmRemove.value = null
  try {
    const res = await removeSocial(task.claimId)
    notes.value = {
      ...notes.value,
      [task.key]: res.deleted
        ? `Removed. ${res.pointsReversed} pts reversed.`
        : res.reason === 'not-found'
          ? 'This claim was already removed.'
          : 'We could not verify this wallet. Please re-join.',
    }
  } catch (err) {
    notes.value = { ...notes.value, [task.key]: err instanceof Error ? err.message : 'Could not remove right now.' }
  } finally {
    busyTask.value = null
  }
}
</script>

<template>
  <section
    class="rounded-[18px] p-[18px]"
    style="background: var(--dig-surface); border: 1px solid var(--dig-line)"
  >
    <div class="flex items-baseline justify-between flex-wrap gap-[8px]">
      <h2 class="m-0 text-[14px] font-bold tracking-[-0.02em]">Social tasks</h2>
      <span class="text-[11.5px]" style="color: var(--dig-faint)">Self-declared · one handle per wallet · one claim per task</span>
    </div>

    <div v-if="props.enrolled" class="mt-[12px] flex items-center gap-[10px] flex-wrap">
      <label class="text-[12px] font-medium" style="color: var(--dig-text-2)" for="earn-handle">Your handle</label>
      <input
        id="earn-handle"
        v-model="handle"
        type="text"
        autocomplete="off"
        spellcheck="false"
        placeholder="@yourhandle"
        maxlength="33"
        class="h-[34px] px-[12px] rounded-[10px] text-[13px] font-mono-geist outline-none w-[220px] max-w-full"
        style="background: var(--dig-surface-2); border: 1px solid var(--dig-line); color: var(--dig-text)"
      />
      <span class="text-[11px]" style="color: var(--dig-faint)">
        {{ anyClaimed ? 'Use the same handle you already declared.' : 'Letters, digits, "_" or "." — the @ is optional.' }}
      </span>
    </div>

    <ul class="list-none m-0 p-0 mt-[12px] flex flex-col gap-[8px]">
      <li
        v-for="t in props.tasks"
        :key="t.key"
        class="rounded-[12px] px-[14px] py-[11px] flex items-center gap-[12px] flex-wrap"
        style="background: var(--dig-surface-2); border: 1px solid var(--dig-line-soft)"
      >
        <div class="flex flex-col flex-1 min-w-[200px]">
          <span class="text-[13px] font-semibold">{{ TASK_META[t.key]?.label ?? t.key }}</span>
          <span class="text-[11.5px] mt-[2px]" style="color: var(--dig-faint)">{{ TASK_META[t.key]?.hint }}</span>
          <span v-if="notes[t.key]" class="text-[11.5px] mt-[4px]" style="color: var(--dig-text-2)">{{ notes[t.key] }}</span>
        </div>

        <a
          v-if="t.available && taskHref(t)"
          :href="taskHref(t) ?? undefined"
          target="_blank"
          rel="noopener"
          class="text-[12px] font-semibold hover:underline"
          style="color: var(--dig-text-2)"
        >{{ TASK_META[t.key]?.cta ?? 'Open ↗' }}</a>

        <span
          class="inline-flex items-center h-[22px] px-[9px] rounded-full text-[11.5px] font-bold tabular-nums"
          style="background: rgba(213,255,47,0.12); border: 1px solid rgba(213,255,47,0.35); color: var(--dig-accent)"
        >
          +{{ t.points }} pts
        </span>

        <template v-if="!t.available">
          <span
            class="text-[10.5px] font-semibold uppercase tracking-[.04em] px-[7px] py-px rounded-full"
            style="background: var(--dig-surface-3); color: var(--dig-faint)"
          >Coming soon</span>
        </template>
        <template v-else-if="!props.enrolled">
          <span class="text-[11.5px]" style="color: var(--dig-faint)">Join to claim</span>
        </template>
        <template v-else-if="t.claimed">
          <span class="text-[12px] font-semibold" style="color: var(--dig-green)">Claimed ✓</span>
          <template v-if="confirmRemove === t.key">
            <span class="text-[11.5px]" style="color: var(--dig-faint)">Remove this claim? Its points are reversed.</span>
            <button type="button" class="text-[12px] font-semibold cursor-pointer hover:underline" style="color: var(--dig-red)" :disabled="busyTask !== null" @click="onRemove(t)">Confirm</button>
            <button type="button" class="text-[12px] cursor-pointer hover:underline" style="color: var(--dig-faint)" @click="confirmRemove = null">Cancel</button>
          </template>
          <button
            v-else
            type="button"
            class="text-[12px] cursor-pointer hover:underline"
            style="color: var(--dig-faint)"
            :disabled="busyTask !== null"
            @click="confirmRemove = t.key"
          >
            Remove
          </button>
        </template>
        <template v-else>
          <button
            type="button"
            class="dig-btn h-[32px] px-[14px] rounded-[10px] text-[12px] font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-default"
            style="background: var(--dig-accent); color: #141414; border: none"
            :disabled="busyTask !== null || !handleLooksValid"
            @click="onClaim(t)"
          >
            {{ busyTask === t.key ? 'Claiming…' : 'I did this' }}
          </button>
        </template>
      </li>
    </ul>

    <p class="mt-[10px] text-[11px] leading-[1.5]" style="color: var(--dig-faint)">
      Social tasks are self-declared: we take your word for it and may review claims. Your handle is stored to prevent
      duplicates, is never shown publicly, and is deleted when you remove a claim.
    </p>
  </section>
</template>
