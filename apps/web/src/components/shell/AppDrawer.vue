<script setup lang="ts">
// AppDrawer — AA1 (Lot AA). Off-canvas presentation of the existing AppSidebar
// below `lg`: overlay backdrop + left slide-in panel, opened by the topbar
// burger. The sidebar component renders INSIDE unchanged — same nav, wallets,
// footer; only its container differs. Closes on backdrop click, Esc, and any
// button/link tap inside the panel (nav taps included, so "close on
// navigation" also covers re-tapping the already-active view).
//
// Mounted only while open (v-if in App.vue), so the Esc listener lives with
// the component lifecycle. z-[40] keeps it under the shell modals (z-[50]) —
// "+ Add wallet" opens ConnectModal above, and the tap that opened it has
// already closed the drawer.
import { onBeforeUnmount, onMounted } from 'vue'
import AppSidebar from './AppSidebar.vue'
import { useDrawer } from '../../composables/useDrawer'

const { closeDrawer } = useDrawer()

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') closeDrawer()
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

// Event delegation: any actionable tap inside the panel dismisses the drawer.
function onPanelClick(e: MouseEvent) {
  const target = e.target as HTMLElement | null
  if (target?.closest('button, a')) closeDrawer()
}
</script>

<template>
  <!-- Teleported to <body> like the shell modals (H1 rule): no transformed
       ancestor can become the containing block for the fixed overlay. -->
  <Teleport to="body">
    <div class="fixed inset-0 z-[40] lg:hidden">
      <!-- Backdrop -->
      <div
        class="absolute inset-0"
        style="background: rgba(38,36,32,0.34); backdrop-filter: blur(3px); animation: digOverlay .2s ease"
        @click="closeDrawer"
      />
      <!-- Panel: the real sidebar, full height, its own width (w-[236px]) -->
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
        class="dig-drawer absolute inset-y-0 left-0 h-full"
        style="animation: digDrawer .25s cubic-bezier(.2,.8,.2,1) both; box-shadow: 24px 0 60px -30px rgba(0,0,0,.6)"
        @click="onPanelClick"
      >
        <AppSidebar />
      </div>
    </div>
  </Teleport>
</template>
