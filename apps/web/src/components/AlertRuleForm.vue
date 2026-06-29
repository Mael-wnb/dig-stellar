<script setup lang="ts">
// AlertRuleForm — create an HF alert. Product framing: "Alert me when health factor
// drops below [threshold]". operator is FIXED to 'lt' (not shown); metric is always
// 'health_factor'. Wallet required; pool defaults to "All pools" (poolEntityId=null).
//
// NOTE (STEP 0b gap): no current read endpoint exposes a wallet's pools' entity_id,
// so the pool dropdown offers only "All pools" until the back end surfaces it.

import { reactive, ref, watch } from 'vue'
import type { WalletItem } from '../types/wallet'
import { fetchWalletPositions } from '../api/wallets'
import { useAppUser } from '../composables/useAppUser'
import { useAlertRules } from '../composables/useAlertRules'

const props = defineProps<{ wallets: WalletItem[] }>()
const emit = defineEmits<{ (e: 'created'): void; (e: 'cancel'): void }>()

const { createRule } = useAlertRules()
const { userId } = useAppUser()

const COOLDOWN_OPTIONS = [
  { label: '15 minutes', value: 900 },
  { label: '1 hour', value: 3600 },
  { label: '6 hours', value: 21600 },
  { label: '24 hours', value: 86400 },
]

// --- form state ---
const walletId = ref<string>('')
const poolEntityId = ref<string | null>(null) // null = "All pools" (default)
const thresholdInput = ref<string>('1.5')
const cooldownSeconds = ref<number>(3600)
const rearmInput = ref<string>('') // empty -> null
const advancedOpen = ref(false)

// Pools for the selected wallet. Built from the wallet's positions; pools with a
// null entityId are skipped (not targetable — the evaluator drops them too).
type PoolOption = { value: string; label: string }
const poolOptions = ref<PoolOption[]>([])
const poolsLoading = ref(false)

// Re-fetch pools when the wallet changes; reset the pool selection so a stale pool
// from the previous wallet can never be submitted.
watch(walletId, async (id) => {
  poolEntityId.value = null
  poolOptions.value = []
  const uid = userId.value?.trim()
  if (!id || !uid) return
  poolsLoading.value = true
  try {
    const res = await fetchWalletPositions(id, uid)
    poolOptions.value = res.pools
      .filter((p) => p.entityId) // skip null-entity pools (not targetable)
      .map((p) => ({
        value: p.entityId as string,
        label:
          p.poolName ?? p.poolSlug ?? `pool ${(p.entityId as string).slice(0, 8)}`,
      }))
  } catch {
    poolOptions.value = [] // on failure, fall back to "All pools" only
  } finally {
    poolsLoading.value = false
  }
})

const submitting = ref(false)
const formError = ref<string | null>(null)
const fieldErrors = reactive<{ wallet?: string; threshold?: string; rearm?: string }>({})

function walletLabel(w: WalletItem): string {
  return w.label?.trim() || `${w.address.slice(0, 6)}…${w.address.slice(-4)}`
}

function validate(): boolean {
  fieldErrors.wallet = undefined
  fieldErrors.threshold = undefined
  fieldErrors.rearm = undefined

  if (!walletId.value) {
    fieldErrors.wallet = 'Select a wallet.'
  }

  const threshold = Number(thresholdInput.value)
  if (!thresholdInput.value.trim() || !Number.isFinite(threshold) || threshold <= 0) {
    fieldErrors.threshold = 'Enter a number greater than 0.'
  }

  if (rearmInput.value.trim()) {
    const rearm = Number(rearmInput.value)
    if (!Number.isFinite(rearm) || rearm < 0) {
      fieldErrors.rearm = 'Must be 0 or greater.'
    }
  }

  return !fieldErrors.wallet && !fieldErrors.threshold && !fieldErrors.rearm
}

function reset() {
  walletId.value = ''
  poolEntityId.value = null
  thresholdInput.value = '1.5'
  cooldownSeconds.value = 3600
  rearmInput.value = ''
  advancedOpen.value = false
}

async function onSubmit() {
  formError.value = null
  if (!validate()) return

  submitting.value = true
  try {
    await createRule({
      metric: 'health_factor',
      operator: 'lt', // fixed under the hood ("drops below")
      threshold: Number(thresholdInput.value),
      userWalletId: walletId.value,
      poolEntityId: poolEntityId.value,
      cooldownSeconds: cooldownSeconds.value,
      rearmHysteresis: rearmInput.value.trim() ? Number(rearmInput.value) : null,
      enabled: true,
    })
    reset()
    emit('created')
  } catch (e) {
    formError.value = e instanceof Error ? e.message : 'Failed to create alert.'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <form
    class="flex flex-col gap-4 rounded-lg border border-[#383838] bg-[#1f1f1f] p-4"
    @submit.prevent="onSubmit"
  >
    <p class="text-[13px] text-[#e2e6e1]">
      Alert me when health factor
      <span class="text-[#d5ff2f] font-semibold">drops below</span> the threshold.
    </p>

    <!-- Threshold -->
    <label class="flex flex-col gap-1">
      <span class="text-[11px] text-[#9a9b99]">Threshold</span>
      <input
        v-model="thresholdInput"
        type="number"
        step="0.01"
        min="0"
        inputmode="decimal"
        class="bg-[#202020] border border-[#383838] rounded-md px-3 py-2 text-sm text-[#e2e6e1] focus:border-[#d5ff2f] outline-none"
        :class="fieldErrors.threshold ? 'border-[#FF6B6B]' : ''"
      />
      <span v-if="fieldErrors.threshold" class="text-[11px] text-[#FF6B6B]">
        {{ fieldErrors.threshold }}
      </span>
      <span v-else class="text-[11px] text-[#717270]">
        Liquidation at 1.0 — a higher threshold warns you earlier.
      </span>
    </label>

    <!-- Wallet -->
    <label class="flex flex-col gap-1">
      <span class="text-[11px] text-[#9a9b99]">Wallet</span>
      <select
        v-model="walletId"
        class="bg-[#202020] border border-[#383838] rounded-md px-3 py-2 text-sm text-[#e2e6e1] focus:border-[#d5ff2f] outline-none"
        :class="fieldErrors.wallet ? 'border-[#FF6B6B]' : ''"
      >
        <option value="" disabled>Select a wallet…</option>
        <option v-for="w in props.wallets" :key="w.id" :value="w.id">
          {{ walletLabel(w) }}
        </option>
      </select>
      <span v-if="fieldErrors.wallet" class="text-[11px] text-[#FF6B6B]">
        {{ fieldErrors.wallet }}
      </span>
    </label>

    <!-- Pool -->
    <label class="flex flex-col gap-1">
      <span class="text-[11px] text-[#9a9b99]">Pool</span>
      <select
        v-model="poolEntityId"
        :disabled="!walletId || poolsLoading"
        class="bg-[#202020] border border-[#383838] rounded-md px-3 py-2 text-sm text-[#e2e6e1] focus:border-[#d5ff2f] outline-none disabled:opacity-50"
      >
        <option :value="null">All pools</option>
        <option v-for="p in poolOptions" :key="p.value" :value="p.value">
          {{ p.label }}
        </option>
      </select>
      <span v-if="poolsLoading" class="text-[11px] text-[#717270]">Loading pools…</span>
    </label>

    <!-- Advanced (collapsed by default) -->
    <div class="flex flex-col gap-3">
      <button
        type="button"
        class="self-start text-[12px] text-[#9a9b99] hover:text-[#d5ff2f] transition-colors"
        @click="advancedOpen = !advancedOpen"
      >
        {{ advancedOpen ? 'Advanced ▾' : 'Advanced ▸' }}
      </button>

      <div v-if="advancedOpen" class="flex flex-col gap-3 pl-1">
        <label class="flex flex-col gap-1">
          <span class="text-[11px] text-[#9a9b99]">Re-alert no sooner than</span>
          <select
            v-model.number="cooldownSeconds"
            class="bg-[#202020] border border-[#383838] rounded-md px-3 py-2 text-sm text-[#e2e6e1] focus:border-[#d5ff2f] outline-none"
          >
            <option v-for="o in COOLDOWN_OPTIONS" :key="o.value" :value="o.value">
              {{ o.label }}
            </option>
          </select>
        </label>

        <label class="flex flex-col gap-1">
          <span class="text-[11px] text-[#9a9b99]">
            Recovery margin before clearing the alert (optional)
          </span>
          <input
            v-model="rearmInput"
            type="number"
            step="0.01"
            min="0"
            inputmode="decimal"
            placeholder="e.g. 0.1"
            class="bg-[#202020] border border-[#383838] rounded-md px-3 py-2 text-sm text-[#e2e6e1] focus:border-[#d5ff2f] outline-none"
            :class="fieldErrors.rearm ? 'border-[#FF6B6B]' : ''"
          />
          <span v-if="fieldErrors.rearm" class="text-[11px] text-[#FF6B6B]">
            {{ fieldErrors.rearm }}
          </span>
        </label>
      </div>
    </div>

    <!-- Form error -->
    <p v-if="formError" class="text-[12px] text-[#FF6B6B]">{{ formError }}</p>

    <!-- Actions -->
    <div class="flex items-center gap-2">
      <button
        type="submit"
        :disabled="submitting"
        class="px-4 py-2 rounded-md bg-[#d5ff2f] text-[#1a1f0e] text-sm font-semibold hover:bg-[#c2eb20] disabled:opacity-50 transition-colors"
      >
        {{ submitting ? 'Creating…' : 'Create alert' }}
      </button>
      <button
        type="button"
        class="px-4 py-2 rounded-md border border-[#383838] text-sm text-[#9a9b99] hover:text-[#e2e6e1] hover:border-[#4b4c4b] transition-colors"
        @click="emit('cancel')"
      >
        Cancel
      </button>
    </div>
  </form>
</template>
