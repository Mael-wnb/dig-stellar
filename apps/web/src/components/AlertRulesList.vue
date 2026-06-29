<script setup lang="ts">
// AlertRulesList — the user's configured alert rules with enable/disable toggle and
// delete. Human framing: "HF < 1.5 · <wallet> · <pool or All pools>".

import { computed, ref, watch } from 'vue'
import type { WalletItem } from '../types/wallet'
import { fetchWalletPositions } from '../api/wallets'
import { useAppUser } from '../composables/useAppUser'
import { useAlertRules } from '../composables/useAlertRules'
import type { AlertRule } from '../api/alertRules'

const props = defineProps<{ wallets: WalletItem[] }>()

const { rules, loading, error, toggleRule, deleteRule } = useAlertRules()
const { userId } = useAppUser()

// entityId -> pool name, resolved from the positions of wallets referenced by
// pool-scoped rules. Falls back to a short id when unknown.
const poolNames = ref<Map<string, string>>(new Map())

watch(
  () => rules.value,
  async (list) => {
    const uid = userId.value?.trim()
    if (!uid) return
    const walletIds = new Set(
      list
        .filter((r) => r.userWalletId && r.poolEntityId)
        .map((r) => r.userWalletId as string)
    )
    if (walletIds.size === 0) return
    const map = new Map(poolNames.value)
    await Promise.all(
      Array.from(walletIds).map(async (wid) => {
        try {
          const res = await fetchWalletPositions(wid, uid)
          for (const p of res.pools) {
            if (p.entityId) {
              map.set(p.entityId, p.poolName ?? p.poolSlug ?? `pool ${p.entityId.slice(0, 8)}`)
            }
          }
        } catch {
          /* ignore — poolLabel falls back to a short id */
        }
      })
    )
    poolNames.value = map
  },
  { immediate: true }
)

const walletsById = computed(() => {
  const map = new Map<string, WalletItem>()
  for (const w of props.wallets) map.set(w.id, w)
  return map
})

function walletLabel(id: string | null): string {
  if (!id) return 'All wallets'
  const w = walletsById.value.get(id)
  if (!w) return `wallet ${id.slice(0, 8)}`
  return w.label?.trim() || `${w.address.slice(0, 6)}…${w.address.slice(-4)}`
}

function poolLabel(rule: AlertRule): string {
  if (!rule.poolEntityId) return 'All pools'
  return poolNames.value.get(rule.poolEntityId) ?? `pool ${rule.poolEntityId.slice(0, 8)}`
}

function framing(rule: AlertRule): string {
  return `HF < ${rule.threshold} · ${walletLabel(rule.userWalletId)} · ${poolLabel(rule)}`
}

function onDelete(rule: AlertRule) {
  if (window.confirm('Delete this alert? This cannot be undone.')) {
    void deleteRule(rule.id)
  }
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <!-- Loading -->
    <div v-if="loading && rules.length === 0" class="text-[13px] text-[#717270] py-4">
      Loading alerts…
    </div>

    <!-- Error -->
    <div v-else-if="error" class="text-[13px] text-[#FF6B6B] py-2">{{ error }}</div>

    <!-- Empty -->
    <div v-else-if="rules.length === 0" class="text-[13px] text-[#717270] py-4">
      No alerts configured
    </div>

    <!-- List -->
    <ul v-else class="flex flex-col gap-2">
      <li
        v-for="rule in rules"
        :key="rule.id"
        class="flex items-center justify-between gap-3 rounded-lg border border-[#383838] bg-[#1f1f1f] px-4 py-3"
      >
        <div class="min-w-0">
          <p
            class="text-[13px] truncate"
            :class="rule.enabled ? 'text-[#e2e6e1]' : 'text-[#717270]'"
          >
            {{ framing(rule) }}
          </p>
          <span class="text-[11px] text-[#5E5F5D]">
            {{ rule.enabled ? 'Active' : 'Disabled' }}
          </span>
        </div>

        <div class="flex items-center gap-2 shrink-0">
          <!-- Enable / disable toggle -->
          <button
            type="button"
            class="relative w-9 h-5 rounded-full transition-colors"
            :class="rule.enabled ? 'bg-[#373B26] border border-[#d5ff2f]' : 'bg-[#2A2A2A] border border-[#383838]'"
            :aria-pressed="rule.enabled"
            aria-label="Toggle alert"
            @click="toggleRule(rule.id, !rule.enabled)"
          >
            <span
              class="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full transition-all"
              :class="rule.enabled ? 'left-[18px] bg-[#d5ff2f]' : 'left-[3px] bg-[#717270]'"
            />
          </button>

          <!-- Delete -->
          <button
            type="button"
            class="p-1.5 rounded-md text-[#717270] hover:text-[#FF6B6B] hover:bg-[#2A2A2A] transition-colors"
            aria-label="Delete alert"
            @click="onDelete(rule)"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="w-4 h-4"
            >
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              <line x1="10" y1="11" x2="10" y2="17" />
              <line x1="14" y1="11" x2="14" y2="17" />
            </svg>
          </button>
        </div>
      </li>
    </ul>
  </div>
</template>
