<script setup lang="ts">
// App shell — Lot C (design: Dig Stellar.dc.html root layout).
// Persistent sidebar + topbar; the main scroll area swaps content by view.
// AA1 (Lot AA): below `lg` the sidebar leaves the flow and becomes the
// off-canvas AppDrawer (opened by the topbar burger); the main area is
// scroll-locked while the drawer is open.
import DashboardView from './components/views/DashboardView.vue'
import ProtocolsView from './components/views/ProtocolsView.vue'
import PoolDetailView from './components/views/PoolDetailView.vue'
import PortfolioView from './components/views/PortfolioView.vue'
import AlertsView from './components/AlertsView.vue'
import AppSidebar from './components/shell/AppSidebar.vue'
import AppTopbar from './components/shell/AppTopbar.vue'
import AppDrawer from './components/shell/AppDrawer.vue'
import ConnectModal from './components/modals/ConnectModal.vue'
import ActionModal from './components/modals/ActionModal.vue'
import { useView } from './composables/useView'
import { useModals } from './composables/useModals'
import { useDrawer } from './composables/useDrawer'
import bgUrl from './assets/design/stellar-defi-bg.png'

const { view } = useView()
const { modal, actionCtx, closeModal } = useModals()
const { drawerOpen } = useDrawer()
</script>

<template>
  <div class="flex h-screen w-screen overflow-hidden" style="background: var(--dig-bg)">
    <!-- Static sidebar: desktop only. Below lg it renders inside AppDrawer. -->
    <AppSidebar class="max-lg:hidden" />

    <div class="flex-1 h-full flex flex-col min-w-0">
      <AppTopbar />

      <main
        class="dig-scroll flex-1 overflow-y-auto"
        :style="{
          background: `var(--dig-bg) url('${bgUrl}') center top / cover no-repeat`,
          overflow: drawerOpen ? 'hidden' : undefined,
        }"
      >
        <DashboardView v-if="view === 'dashboard'" />
        <ProtocolsView v-else-if="view === 'protocols'" />
        <PoolDetailView v-else-if="view === 'pool'" />
        <PortfolioView v-else-if="view === 'portfolio'" />
        <AlertsView v-else-if="view === 'alerts'" />
      </main>
    </div>

    <!-- Mobile nav drawer (AA1) -->
    <AppDrawer v-if="drawerOpen" />

    <!-- Shell-level modals (C5) -->
    <ConnectModal v-if="modal === 'connect'" @close="closeModal" />
    <ActionModal v-if="modal === 'action' && actionCtx" :ctx="actionCtx" @close="closeModal" />
  </div>
</template>
