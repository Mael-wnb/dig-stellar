<script setup lang="ts">
// AppTopbar — Lot C shell topbar (design: Dig Stellar.dc.html TOPBAR block).
// Screen title/sub per view · notifications bell (real unread) · connect button
// (real Wallets-Kit flow). The bell reuses the existing self-contained
// NotificationsBell for C1; it is restyled into the design dropdown in C4.

import { computed } from 'vue'
import { useView } from '../../composables/useView'
import { useConnectFlow } from '../../composables/useConnectFlow'
import { useModals } from '../../composables/useModals'
import NotificationsBell from '../NotificationsBell.vue'

const { view } = useView()
const { connectLabel, isConnecting, isConnected, disconnect } = useConnectFlow()
const { openConnect } = useModals()

// Disconnected → open the design connect/add-wallet modal. Connected → the label
// shows the address; clicking disconnects (mirrors the prior header behaviour).
function onConnectClick() {
  if (isConnected.value) disconnect()
  else openConnect()
}

const TITLES: Record<string, [string, string]> = {
  dashboard: ['Dashboard', 'Overview across your wallets'],
  protocols: ['Protocols', 'Pools and metrics by venue'],
  pool: ['Pool detail', 'On-chain metrics and activity'],
  portfolio: ['Portfolio', 'Balances and positions'],
  alerts: ['Alerts', 'Monitoring rules and activity'],
}

const title = computed(() => (TITLES[view.value] ?? TITLES.dashboard)[0])
const subtitle = computed(() => (TITLES[view.value] ?? TITLES.dashboard)[1])
</script>

<template>
  <header
    class="h-[64px] flex-shrink-0 flex items-center gap-[16px] px-[26px] relative z-[5]"
    style="
      border-bottom: 1px solid var(--dig-line);
      backdrop-filter: blur(10px);
      background-color: #1E1E1ED1;
    "
  >
    <div class="flex flex-col">
      <h1 class="m-0 text-[17px] font-bold tracking-[-0.02em]">{{ title }}</h1>
      <span class="text-[12px] mt-[1px]" style="color: var(--dig-faint)">{{ subtitle }}</span>
    </div>

    <div class="ml-auto flex items-center gap-[10px]">
      <NotificationsBell />

      <button
        type="button"
        class="dig-btn h-[38px] px-[16px] rounded-[11px] text-[13px] font-semibold cursor-pointer flex items-center gap-[8px] transition-[filter]"
        style="background: var(--dig-accent); color: #141414; border: none"
        :disabled="isConnecting"
        @click="onConnectClick"
      >
        {{ connectLabel }}
      </button>
    </div>
  </header>
</template>
