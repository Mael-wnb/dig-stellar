// apps/web/src/composables/useConnectFlow.ts
//
// Shared "connect / disconnect signer wallet" action, extracted from the legacy
// DashboardHeader so the Lot C shell (topbar + sidebar) and the C5 connect modal
// all drive the SAME real flow instead of re-implementing it three times.
//
// Flow: open the Stellar Wallets Kit → prove the address → POST /wallets/connect
// WITH the session userId when one exists (W1: the backend then attaches the
// wallet to THAT account — watch-only rows promote in place — instead of forking
// a new user) → persist the returned userId. This is non-custodial: the Kit
// proves control, the backend never sees keys.

import { computed, ref } from 'vue'
import { connectWallet as connectWalletApi } from '../api/wallets'
import { useAppUser } from './useAppUser'
import { useSharedWallets } from './useSharedWallets'
import { useWalletSession } from './useWalletSession'

export function useConnectFlow() {
  const { userId, setUserId, clearUser } = useAppUser()
  const {
    connectedAddress,
    shortConnectedAddress,
    isConnecting,
    connectWallet,
    disconnectWallet,
  } = useWalletSession()

  const error = ref<string | null>(null)

  const connectLabel = computed(() => {
    if (isConnecting.value) return 'Connecting…'
    if (connectedAddress.value) return shortConnectedAddress.value ?? 'Connected'
    return 'Connect wallet'
  })

  const isConnected = computed(() => !!connectedAddress.value)

  // options.label — W2: optional connect-time label, applied server-side when
  // the connect creates a new wallet row (renames go through PATCH instead).
  async function connect(options?: { label?: string }): Promise<void> {
    error.value = null
    try {
      const session = await connectWallet()
      if (!session?.address) throw new Error('No wallet address returned.')

      const previousUserId = userId.value

      const res = await connectWalletApi({
        chain: 'stellar',
        address: session.address,
        label: options?.label?.trim() || '',
        userId: previousUserId ?? undefined,
      })

      const backendUserId = res?.userId?.trim()
      if (!backendUserId) throw new Error('Backend did not return userId.')

      setUserId(backendUserId)

      // Attaching to the SAME account leaves userId unchanged, so the
      // useSharedWallets watcher (which reloads on userId CHANGE) never fires —
      // reload explicitly so the promoted/added wallet shows up immediately.
      if (backendUserId === previousUserId) {
        await useSharedWallets().loadOverview()
      }
    } catch (err) {
      error.value =
        err instanceof Error ? err.message : 'Connection failed or cancelled.'
      console.error('[connect-flow] connect failed', err)
    }
  }

  function disconnect(): void {
    disconnectWallet()
    clearUser()
  }

  // Toggle used by the topbar/sidebar button: connect when disconnected,
  // disconnect when already connected (mirrors the old header behaviour).
  async function toggle(): Promise<void> {
    if (connectedAddress.value) disconnect()
    else await connect()
  }

  return {
    connectedAddress,
    shortConnectedAddress,
    isConnecting,
    isConnected,
    connectLabel,
    error,
    connect,
    disconnect,
    toggle,
  }
}
