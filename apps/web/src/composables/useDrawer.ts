// useDrawer — AA1 (Lot AA). Module-scoped open/closed state for the mobile
// off-canvas nav drawer (the below-`lg` presentation of AppSidebar). Mirrors
// the useModals shared-ref pattern: one ref, shared by the topbar burger and
// the drawer itself. Desktop (`lg`+) never reads this — the static sidebar
// stays in flow there.
import { ref } from 'vue'

const drawerOpen = ref(false)

export function useDrawer() {
  function openDrawer() {
    drawerOpen.value = true
  }
  function closeDrawer() {
    drawerOpen.value = false
  }
  function toggleDrawer() {
    drawerOpen.value = !drawerOpen.value
  }

  return { drawerOpen, openDrawer, closeDrawer, toggleDrawer }
}
