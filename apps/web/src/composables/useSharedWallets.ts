// useSharedWallets — Lot C (C4 consolidation). One module-scoped wallets
// instance shared by the sidebar, the portfolio view and the pool-detail
// "Your position" card, so the user's wallets/overview load once instead of
// once per consumer. Mirrors the shared-ref pattern of useAppUser/useNetwork.
import { watch } from 'vue'
import { useAppUser } from './useAppUser'
import { useWallets } from './useWallets'

const { userId } = useAppUser()
const store = useWallets(userId)

let wired = false

export function useSharedWallets() {
  // Wire the userId → overview load exactly once (first consumer). Subsequent
  // consumers just receive the same reactive store.
  if (!wired) {
    wired = true
    watch(
      () => userId.value,
      (id) => {
        if (id) void store.loadOverview()
        else store.clearWallets()
      },
      { immediate: true },
    )
  }
  return store
}
