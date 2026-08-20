<script setup lang="ts">
// AppTopbar — Lot C shell topbar (design: Dig Stellar.dc.html TOPBAR block).
// Screen title/sub per view · notifications bell (real unread) · connect button
// (real Wallets-Kit flow). The bell reuses the existing self-contained
// NotificationsBell for C1; it is restyled into the design dropdown in C4.
//
// AA1 (Lot AA) — below `lg` the topbar compacts: burger (opens the nav
// drawer) + wordmark replace the title/subtitle block, padding tightens, and
// the disconnected connect label shortens below `sm`. Desktop (`lg`+) renders
// exactly as before — every AA1 change is gated behind max-lg:/lg: variants.

import { computed } from 'vue'
import { useView } from '../../composables/useView'
import { useConnectFlow } from '../../composables/useConnectFlow'
import { useModals } from '../../composables/useModals'
import { useDrawer } from '../../composables/useDrawer'
import NotificationsBell from '../NotificationsBell.vue'
import digWordmark from '../../assets/design/dig-wordmark.svg'

const { view } = useView()
const { connectLabel, isConnecting, isConnected, disconnect } = useConnectFlow()
const { openConnect } = useModals()
const { drawerOpen, toggleDrawer } = useDrawer()

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
    class="h-[64px] flex-shrink-0 flex items-center gap-[16px] px-[26px] max-lg:px-[14px] max-lg:gap-[10px] relative z-[5]"
    style="
      border-bottom: 1px solid var(--dig-line);
      backdrop-filter: blur(10px);
      background-color: #1E1E1ED1;
    "
  >
    <!-- Burger — mobile/tablet only (AA1): opens the off-canvas nav drawer. -->
    <button
      type="button"
      class="dig-ghost lg:hidden w-[44px] h-[44px] flex-shrink-0 flex items-center justify-center rounded-[11px] cursor-pointer"
      style="background: var(--dig-surface-3); border: 1px solid var(--dig-line); color: var(--dig-text)"
      aria-label="Open navigation"
      :aria-expanded="drawerOpen"
      @click="toggleDrawer"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg>
    </button>

    <!-- Wordmark — mobile/tablet only: the sidebar (which carries it on desktop)
         is off-canvas here, so the brand moves into the topbar. -->
    <img :src="digWordmark" alt="Dig" class="lg:hidden h-[24px] w-auto flex-shrink-0" />

    <div class="max-lg:hidden flex flex-col">
      <h1 class="m-0 text-[17px] font-bold tracking-[-0.02em]">{{ title }}</h1>
      <span class="text-[12px] mt-[1px]" style="color: var(--dig-faint)">{{ subtitle }}</span>
    </div>

    <div class="ml-auto flex items-center gap-[10px] min-w-0">
      <NotificationsBell />

      <button
        type="button"
        class="dig-btn h-[38px] px-[16px] max-sm:px-[13px] rounded-[11px] text-[13px] font-semibold cursor-pointer flex items-center gap-[8px] transition-[filter]"
        style="background: var(--dig-accent); color: #141414; border: none"
        :disabled="isConnecting"
        @click="onConnectClick"
      >
        <template v-if="isConnected || isConnecting">{{ connectLabel }}</template>
        <template v-else>
          <span class="max-sm:hidden">{{ connectLabel }}</span>
          <span class="sm:hidden">Connect</span>
        </template>
      </button>
    </div>
  </header>
</template>
