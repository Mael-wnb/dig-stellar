<script setup lang="ts">
// apps/web/src/components/AlertRuleModal.vue
// SCF T2-D2 — "New alert rule" modal. Reconstructed 1:1 from Paul's Claude Design mock.
// Steps: 1) What to watch  2) Which target  3) Condition  4) Severity.
//
// Scope discipline: the full builder is shown (Paul's vision), but only rule families the
// engine actually evaluates today are creatable (see SUPPORTED_METRICS in useAlerts).
// Unsupported metrics are visibly marked "soon" and disabled, so the product never lets a
// user arm an alert that won't fire.

import { computed, ref } from 'vue'
import {
  isSupported,
  type AlertScope, type AlertMetric, type AlertOperator, type AlertSeverity,
  type CreateRulePayload,
} from '../composables/useAlerts'

const emit = defineEmits<{ (e: 'close'): void; (e: 'create', payload: CreateRulePayload): void }>()

// Wallet targets normally come from the wallet store; fall back to a sample if
// not passed. Asset targets (N1, price rules) and pool targets (N3, TVL rules)
// come from the vetted backend lists — NO fallback samples: an empty list shows
// an honest empty state instead of decorative fakes.
const props = withDefaults(defineProps<{
  wallets?: Array<{ address: string; label: string }>
  assets?: Array<{ id: string; label: string; sub: string }>
  // apy/borrowApy flags (N4): which APY sides this pool actually has.
  pools?: Array<{ id: string; label: string; sub: string; apy?: boolean; borrowApy?: boolean }>
}>(), { wallets: () => [], assets: () => [], pools: () => [] })

// ── Definitions (faithful to Paul's builder; Lot N adds the Asset scope) ────
const SCOPES: Array<{ key: AlertScope; label: string; sub: string; icon: string[] }> = [
  { key: 'venue', label: 'Pool / venue', sub: 'A specific market', icon: ['M12 2 2 7l10 5 10-5-10-5z', 'M2 17l10 5 10-5', 'M2 12l10 5 10-5'] },
  { key: 'wallet', label: 'Wallet', sub: 'Balance & exposure', icon: ['M3 7h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h11', 'M16 13h.01'] },
  { key: 'asset', label: 'Asset', sub: 'Market price', icon: ['M12 1v22', 'M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6'] },
  { key: 'protocol', label: 'Protocol', sub: 'Whole venue', icon: ['M3 3h7v7H3z', 'M14 3h7v7h-7z', 'M14 14h7v7h-7z', 'M3 14h7v7H3z'] },
]

// 'price' moved from the venue scope to the asset scope (Lot N): the evaluator
// prices assets, not venues — a venue-price family will never exist.
const METRICS_BY_SCOPE: Record<AlertScope, Array<[AlertMetric, string]>> = {
  venue: [['apy', 'Supply APY'], ['borrowapy', 'Borrow APY'], ['tvl', 'TVL delta'], ['util', 'Utilization'], ['netflow', 'Netflow']],
  wallet: [['balance', 'Balance change'], ['exposure', 'Net exposure'], ['health', 'Health factor'], ['posvalue', 'Position value']],
  asset: [['price', 'Price']],
  protocol: [['tvl', 'TVL delta'], ['volume', 'Volume spike'], ['netflow', 'Netflow'], ['health', 'Protocol health']],
}

const SCOPE_NOUN: Record<AlertScope, string> = { venue: 'pool', wallet: 'wallet', asset: 'asset', protocol: 'protocol' }

const METRIC_LABEL: Record<AlertMetric, string> = {
  apy: 'Supply APY', borrowapy: 'Borrow APY', health: 'Health factor', netflow: '1h netflow',
  tvl: 'TVL', util: 'Utilization',
  price: 'Price', balance: 'Balance', exposure: 'Net exposure', posvalue: 'Position value', volume: '24h volume',
}
const UNIT: Record<AlertMetric, string> = {
  apy: '%', borrowapy: '%', health: '', netflow: '$', tvl: '%', util: '%', price: '$',
  balance: '%', exposure: '$', posvalue: '$', volume: '%',
}

const OPERATORS: Array<[AlertOperator, string]> = [['lt', 'falls below'], ['gt', 'rises above'], ['pct', 'changes by']]
const SEVERITIES: Array<[AlertSeverity, string, string]> = [
  ['info', 'Info', '#2E9E63'], ['warning', 'Warning', '#C98A1E'], ['critical', 'Critical', '#D0522E'],
]

// Static venue/protocol targets (visual — creation gated by scope discipline).
// Wallet targets come from the store (props.wallets) or a labelled sample.
const SAMPLE_WALLETS = [
  { address: 'GDXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX7QF', label: 'Main' },
  { address: 'GBMXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXK2A', label: 'Cold storage' },
  { address: 'GCUXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX9PL', label: 'Trading' },
]
const walletList = computed(() => (props.wallets.length ? props.wallets : SAMPLE_WALLETS))

function targetsFor(scope: AlertScope): Array<{ id: string; label: string; sub: string; tint: string; color: string; apy?: boolean; borrowApy?: boolean }> {
  if (scope === 'wallet') {
    const w = walletList.value.map(x => ({
      // W2: short-address fallback when the wallet has no label.
      id: x.address, label: x.label || `${x.address.slice(0, 3)}…${x.address.slice(-3)}`,
      sub: `${x.address.slice(0, 3)}…${x.address.slice(-3)}`, tint: '#171E30', color: '#63A7FF',
    }))
    return [...w, { id: 'all', label: 'All wallets', sub: 'Consolidated', tint: '#2E3A14', color: '#D5FF2F' }]
  }
  if (scope === 'asset') {
    // Vetted list only — the assets the pricing pipeline actually tracks.
    return props.assets.map(a => ({
      id: a.id, label: a.label, sub: a.sub, tint: '#2E3A14', color: '#D5FF2F',
    }))
  }
  if (scope === 'protocol') {
    return [
      { id: 'blend', label: 'Blend', sub: 'Lending', tint: '#17233A', color: '#2E6FD6' },
      { id: 'aquarius', label: 'Aquarius', sub: 'AMM + rewards', tint: '#0F302C', color: '#159A8C' },
      { id: 'soroswap', label: 'Soroswap', sub: 'AMM', tint: '#37231A', color: '#D86A3E' },
      { id: 'stellar-native', label: 'Stellar Native DEX', sub: 'Classic AMM', tint: '#241633', color: '#7B45D6' },
    ]
  }
  // venue scope (N3/N4): the vetted pool list — real pools with reserve-batch
  // history (APY side flags carried for the per-target metric gate).
  return props.pools.map(p => ({
    id: p.id, label: p.label, sub: p.sub, tint: '#17233A', color: '#2E6FD6',
    apy: p.apy === true, borrowApy: p.borrowApy === true,
  }))
}

// ── State (default to the wallet · health family) ───────────────────────────
const scope = ref<AlertScope>('wallet')
const targetId = ref<string>(targetsFor('wallet')[0].id)
const metric = ref<AlertMetric>('health')
const operator = ref<AlertOperator>('lt')
const threshold = ref<string>('1.25')
const severity = ref<AlertSeverity>('warning')

// Sensible starting threshold per family (the user always edits it).
const DEFAULT_THRESHOLD: Partial<Record<AlertMetric, string>> = {
  health: '1.25',
  tvl: '10',
  apy: '5',
  borrowapy: '10',
}

function pickMetric(m: AlertMetric) {
  metric.value = m
  // TVL drop has a single one-direction operator; other families start at 'lt'.
  operator.value = m === 'tvl' ? 'pct' : 'lt'
  threshold.value = DEFAULT_THRESHOLD[m] ?? ''
}

function pickScope(s: AlertScope) {
  scope.value = s
  // A scope can have zero targets (e.g. no priced assets yet) — keep an empty
  // selection; canCreate stays false and the template shows the honest note.
  targetId.value = targetsFor(s)[0]?.id ?? ''
  // prefer a supported metric if one exists in this scope, else the first
  const metrics = METRICS_BY_SCOPE[s]
  const supported = metrics.find(([m]) => isSupported(s, m))
  pickMetric((supported ?? metrics[0])[0])
}

const targets = computed(() => targetsFor(scope.value))
const metrics = computed(() => METRICS_BY_SCOPE[scope.value])
const scopeNoun = computed(() => SCOPE_NOUN[scope.value])
const selectedTarget = computed(() => targets.value.find(t => t.id === targetId.value) ?? targets.value[0])
const selectedMetricLabel = computed(() => METRIC_LABEL[metric.value])
const unit = computed(() => (operator.value === 'pct' ? '%' : UNIT[metric.value]))
const supported = computed(() => isSupported(scope.value, metric.value))
// For a creatable family only the operators the backend evaluates are offered.
// TVL drop is a one-direction family: the backend fires when the 24h drop
// exceeds the threshold, so the only honest wording is "drops by more than".
const operators = computed<Array<[AlertOperator, string]>>(() => {
  if (metric.value === 'tvl') return [['pct', 'drops by more than']]
  return supported.value ? OPERATORS.filter(([op]) => op !== 'pct') : OPERATORS
})
// N4: APY metrics are per-target — a pool without the chosen APY side (AMM
// pools; borrow on supply-only pools) cannot arm the rule.
const targetSupportsMetric = computed(() => {
  if (metric.value === 'apy') return selectedTarget.value?.apy === true
  if (metric.value === 'borrowapy') return selectedTarget.value?.borrowApy === true
  return true
})
const canCreate = computed(() =>
  supported.value &&
  targetSupportsMetric.value &&
  selectedTarget.value !== undefined &&
  threshold.value.trim() !== '' &&
  !Number.isNaN(Number(threshold.value)),
)

function submit() {
  if (!canCreate.value || !selectedTarget.value) return
  emit('create', {
    name: `${selectedTarget.value.label} - ${selectedMetricLabel.value}`,
    scope: scope.value,
    scope_ref: selectedTarget.value.id,
    metric: metric.value,
    operator: operator.value,
    threshold: Number(threshold.value),
    severity: severity.value,
  })
}
</script>

<template>
  <!-- overlay — teleported to <body>: the alerts view wrapper keeps a transform
       (digFade, fill-mode both), which would otherwise become the containing
       block for this fixed overlay and center it in the content column instead
       of the viewport. -->
  <Teleport to="body">
  <div
    class="fixed inset-0 z-50 flex items-center justify-center p-6 max-sm:items-end max-sm:p-0"
    style="background:rgba(38,36,32,.34); backdrop-filter:blur(3px); animation:digOverlay .2s ease;"
    @click.self="emit('close')"
  >
    <div
      class="bg-[#1E1E1E] rounded-[20px] flex flex-col max-h-[90vh] overflow-hidden w-full max-w-[560px] text-[#E2E6E1] max-sm:max-w-full max-sm:rounded-b-none max-sm:max-h-[100dvh]"
      style="box-shadow:0 30px 80px -30px rgba(38,36,32,.5); animation:digSheet .3s cubic-bezier(.2,.8,.2,1) both;"
    >
      <div class="dig-scroll px-[26px] pt-6 pb-[26px] overflow-y-auto">
        <div class="flex items-center justify-between mb-0.5">
          <h2 class="text-lg font-bold">New alert rule</h2>
          <button
            class="cursor-pointer text-[#5E5F5D] text-xl w-[30px] h-[30px] flex items-center justify-center rounded-lg hover:bg-[#2A2A27]"
            @click="emit('close')"
          >×</button>
        </div>
        <p class="text-[13px] text-[#5E5F5D] mb-[22px]">
          Get notified in-app the moment on-chain state crosses your threshold.
        </p>

        <!-- 1 · What to watch -->
        <p class="text-xs font-semibold text-[#5E5F5D] mb-[9px]">1. What to watch</p>
        <!-- AA3: 2×2 below sm — four-across clipped the last card at 390. -->
        <div class="grid grid-cols-4 gap-[9px] mb-5 max-sm:grid-cols-2">
          <button
            v-for="sc in SCOPES"
            :key="sc.key"
            class="p-3.5 rounded-[13px] cursor-pointer text-left border-[1.5px] transition-all"
            :style="scope === sc.key
              ? 'border-color:#D5FF2F; background:#202312; color:#D5FF2F;'
              : 'border-color:#2F2F2C; background:#242422; color:#5E5F5D;'"
            @click="pickScope(sc.key)"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
                 stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path v-for="d in sc.icon" :key="d" :d="d" />
            </svg>
            <div class="text-[13px] font-semibold mt-2 text-[#E2E6E1]">{{ sc.label }}</div>
            <div class="text-[11.5px] text-[#5E5F5D] mt-0.5">{{ sc.sub }}</div>
          </button>
        </div>

        <!-- 2 · Which target -->
        <p class="text-xs font-semibold text-[#5E5F5D] mb-[9px] capitalize">2. Which {{ scopeNoun }}</p>
        <p v-if="!targets.length" class="text-[12px] text-[#C98A1E] mb-5">
          {{ scope === 'asset'
            ? 'No priced assets available right now. The tracked-asset list comes from the data pipeline.'
            : 'No eligible targets available right now. The list comes from the data pipeline.' }}
        </p>
        <!-- AA3: themed scrollbar + a max-height that cuts mid-row below sm, so
             a longer wallet list visibly continues instead of looking clipped. -->
        <div v-else class="dig-scroll grid grid-cols-2 gap-2 mb-5 max-h-[150px] overflow-y-auto max-sm:max-h-[176px]">
          <button
            v-for="t in targets"
            :key="t.id"
            class="flex items-center gap-[9px] pl-2 pr-[11px] py-2 rounded-[11px] cursor-pointer border-[1.5px]"
            :style="targetId === t.id ? 'border-color:#D5FF2F; background:#202312;' : 'border-color:#2F2F2C; background:#242422;'"
            @click="targetId = t.id"
          >
            <!-- Q1: token targets are circles, everything else keeps the square tile -->
            <span class="w-6 h-6 flex-shrink-0" :class="scope === 'asset' ? 'rounded-full' : 'rounded-[7px]'"
                  :style="{ background: t.tint, boxShadow: `inset 0 0 0 1.5px ${t.color}` }" />
            <span class="min-w-0 text-left">
              <span class="block text-[12.5px] font-semibold" :style="{ color: targetId === t.id ? '#E2E6E1' : '#B7B3AB' }">{{ t.label }}</span>
              <span class="block text-[11px] text-[#5E5F5D] truncate">{{ t.sub }}</span>
            </span>
          </button>
        </div>

        <!-- 3 · Condition -->
        <p class="text-xs font-semibold text-[#5E5F5D] mb-[9px]">3. Condition</p>
        <div class="flex gap-1.5 flex-wrap mb-3.5">
          <button
            v-for="[m, label] in metrics"
            :key="m"
            class="relative text-[12.5px] font-semibold px-[13px] py-[7px] rounded-[9px] cursor-pointer border"
            :disabled="!isSupported(scope, m)"
            :style="metric === m
              ? 'border-color:#D5FF2F; color:#D5FF2F; background:#202312;'
              : (isSupported(scope, m)
                  ? 'border-color:#2F2F2C; color:#5E5F5D; background:#242422;'
                  : 'border-color:#2A2A27; color:#4A4B47; background:#1E1E1E; cursor:not-allowed;')"
            @click="isSupported(scope, m) && pickMetric(m)"
          >
            {{ label }}
            <span v-if="!isSupported(scope, m)"
                  class="ml-1.5 text-[9px] uppercase tracking-wide text-[#5E5F5D]">soon</span>
          </button>
        </div>

        <!-- "Notify me when …" builder bar -->
        <div class="flex items-center gap-2.5 flex-wrap px-[18px] py-4 bg-[#1C1C1A] border border-[#2C2C29] rounded-[13px] mb-2">
          <span class="text-[13.5px] text-[#5E5F5D]">Notify me when</span>
          <span class="text-[13.5px] font-bold text-[#D5FF2F]">{{ selectedTarget?.label ?? '—' }}</span>
          <span class="text-[13.5px] text-[#5E5F5D]">-</span>
          <span class="text-[13.5px] font-semibold text-[#E2E6E1]">{{ selectedMetricLabel }}</span>
          <span class="flex gap-1.5">
            <button
              v-for="[op, label] in operators"
              :key="op"
              class="text-[12.5px] font-semibold px-[11px] py-1.5 rounded-lg cursor-pointer"
              :style="operator === op ? 'background:#D5FF2F; color:#141414;' : 'background:#37372F; color:#5E5F5D;'"
              @click="operator = op"
            >{{ label }}</button>
          </span>
          <input
            v-model="threshold"
            inputmode="decimal"
            class="w-24 h-9 px-3 border border-[#34342E] rounded-[9px] text-sm font-semibold text-right bg-[#1C1C1A] text-[#E2E6E1] outline-none"
            style="font-family:'Geist Mono',monospace;"
          >
          <span class="text-[13.5px] font-semibold text-[#5E5F5D]">{{ unit }}</span>
        </div>

        <!-- honest scope note -->
        <p v-if="!supported" class="text-[12px] text-[#C98A1E] mb-5">
          This alert type isn't evaluated by the engine yet (coming soon). Pick a supported metric to create a rule.
        </p>
        <p v-else-if="!targetSupportsMetric" class="text-[12px] text-[#C98A1E] mb-5">
          {{ selectedTarget?.label ?? 'This pool' }} doesn't have a {{ metric === 'borrowapy' ? 'borrow' : 'supply' }} APY. Pick a lending pool for APY alerts.
        </p>
        <!-- honest cadence note: rules ride the periodic sweep, not a live stream -->
        <p v-else class="text-[12px] text-[#5E5F5D] mb-5">
          Rules are checked every ~15 minutes by the monitoring sweep, not in real time.
        </p>

        <!-- 4 · Severity -->
        <p class="text-xs font-semibold text-[#5E5F5D] mb-[9px]">4. Severity</p>
        <div class="flex gap-[9px] mb-6">
          <button
            v-for="[sv, label, dot] in SEVERITIES"
            :key="sv"
            class="flex-1 flex items-center justify-center gap-[7px] p-[11px] rounded-[11px] cursor-pointer text-[13px] font-semibold border-[1.5px] bg-[#242422]"
            :style="{ borderColor: severity === sv ? dot : '#2F2F2C', color: severity === sv ? '#E2E6E1' : '#5E5F5D' }"
            @click="severity = sv"
          >
            <span class="w-2 h-2 rounded-full" :style="{ background: dot }" />
            {{ label }}
          </button>
        </div>

        <!-- footer -->
        <div class="flex gap-[11px]">
          <button
            class="flex-1 h-[46px] rounded-xl bg-[#262624] border border-[#2F2F2C] text-[#5E5F5D] font-semibold text-sm cursor-pointer hover:bg-[#2A2A27]"
            @click="emit('close')"
          >Cancel</button>
          <button
            class="flex-[2] h-[46px] rounded-xl bg-[#D5FF2F] text-[#252525] font-bold text-sm cursor-pointer hover:brightness-105 disabled:opacity-40 disabled:cursor-not-allowed"
            :disabled="!canCreate"
            @click="submit"
          >Create alert rule</button>
        </div>
      </div>
    </div>
  </div>
  </Teleport>
</template>