// useModals — Lot C (C5). Module-scoped modal state for the shell-level modals
// (connect/add-wallet + the action flow). The create-alert modal stays owned by
// AlertsView (its useAlerts instance holds the create logic); other surfaces
// request it via `requestAlert()` + navigating to the alerts view.
import { ref } from 'vue'

export interface ActionContext {
  slug: string
  name: string
  venue: string
  // 'lending' → Blend deposit widget · 'amm' → SDEX swap widget.
  kind: 'lending' | 'amm'
}

type ModalKind = 'connect' | 'action' | null

const modal = ref<ModalKind>(null)
const actionCtx = ref<ActionContext | null>(null)
// Set to ask the alerts view to open its create-rule modal. Consumed on the
// alerts view's mount (callers navigate there) or by its live watcher.
const pendingAlert = ref(false)

export function useModals() {
  function openConnect() {
    modal.value = 'connect'
  }
  function openAction(ctx: ActionContext) {
    actionCtx.value = ctx
    modal.value = 'action'
  }
  function closeModal() {
    modal.value = null
    actionCtx.value = null
  }
  function requestAlert() {
    pendingAlert.value = true
  }
  // Returns true (and clears the flag) when a create-rule modal was requested.
  function consumeAlertRequest(): boolean {
    if (!pendingAlert.value) return false
    pendingAlert.value = false
    return true
  }

  return {
    modal,
    actionCtx,
    pendingAlert,
    openConnect,
    openAction,
    closeModal,
    requestAlert,
    consumeAlertRequest,
  }
}
