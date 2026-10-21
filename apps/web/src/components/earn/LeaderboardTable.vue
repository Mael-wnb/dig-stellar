<script setup lang="ts">
// LeaderboardTable — Lot EP (EP2), from the BridgeRoutesTable pattern (typed
// rows, grid header, tabular-nums cells). Dumb: rows in, nothing computed.
// Addresses arrive ALREADY shortened from the API (GABC…WXYZ); this component
// never sees a full key. `me` highlights the caller's own rank when present.
import { relativeTime } from '../../utils/format'

interface LeaderboardRowView { rank: number; address: string; points: number }

defineProps<{
  rows: LeaderboardRowView[]
  me: { rank: number; points: number } | null
  asOf: string | null
}>()

const COLS: Array<[string, 'left' | 'right']> = [['Rank', 'left'], ['Wallet', 'left'], ['Points', 'right']]
</script>

<template>
  <div>
    <div class="flex items-baseline justify-between flex-wrap gap-[8px] mb-[6px]">
      <p class="text-[11.5px] m-0" style="color: var(--dig-faint)">Top wallets by points · addresses shortened</p>
      <p v-if="asOf" class="text-[11px] m-0" style="color: var(--dig-faint)">Updated {{ relativeTime(asOf) }}</p>
    </div>

    <!-- header -->
    <div
      class="grid items-center px-2 py-2.5 text-[11px] font-semibold uppercase tracking-[.04em]"
      style="grid-template-columns: 0.6fr 2fr 1fr; border-bottom: 1px solid var(--dig-line-soft); color: var(--dig-faint)"
    >
      <span v-for="[label, al] in COLS" :key="label" :style="{ textAlign: al }">{{ label }}</span>
    </div>

    <!-- rows -->
    <div
      v-for="r in rows"
      :key="r.rank"
      class="grid items-center px-2 py-2.5 rounded-[10px]"
      style="grid-template-columns: 0.6fr 2fr 1fr; border-bottom: 1px solid var(--dig-line-soft)"
      :style="me && me.rank === r.rank ? 'background:#242422; box-shadow:inset 2px 0 0 #D5FF2F;' : ''"
    >
      <span class="text-[13px] font-bold tabular-nums" style="color: var(--dig-text-2)">#{{ r.rank }}</span>
      <span class="text-[13px] font-mono-geist" style="color: var(--dig-text)">
        {{ r.address }}
        <span v-if="me && me.rank === r.rank" class="ml-[6px] text-[10.5px] font-semibold uppercase tracking-[.04em]" style="color: var(--dig-accent)">you</span>
      </span>
      <span class="text-right text-[13.5px] font-semibold tabular-nums" style="color: var(--dig-accent)">{{ r.points.toLocaleString('en-US') }}</span>
    </div>

    <p v-if="!rows.length" class="px-2 py-4 text-[12.5px] m-0" style="color: var(--dig-faint)">
      No points yet. The first verified actions will appear here.
    </p>

    <p
      v-if="me && !rows.some((r) => r.rank === me!.rank)"
      class="mt-[8px] px-2 text-[12px] m-0"
      style="color: var(--dig-text-2)"
    >
      Your rank: <span class="font-bold tabular-nums">#{{ me.rank }}</span> · {{ me.points.toLocaleString('en-US') }} pts
    </p>
  </div>
</template>
