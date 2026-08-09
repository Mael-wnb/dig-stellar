// apps/web/src/composables/useConnectFlow.ts
//
// Shared "connect / disconnect signer wallet" action, extracted from the legacy
// DashboardHeader so the Lot C shell (topbar + sidebar) and the C5 connect modal
// all drive the SAME real flow instead of re-implementing it three times.
//
// Flow: open the Stellar Wallets Kit → prove the address → POST /wallets/connect
// (creates the app user + wallet server-side, designates active signer) → persist
// the returned userId. This is non-custodial: the Kit proves control, the backend
// never sees keys.

import { computed, ref } from 'vue'
import { connectWallet as connectWalletApi } from '../api/wallets'
import { useAppUser } from './useAppUser'
import { useWalletSession } from './useWalletSession'

export function useConnectFlow() {
  const { setUserId, clearUser } = useAppUser()
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

  async function connect(): Promise<void> {
    error.value = null
    try {
      const session = await connectWallet()
      if (!session?.address) throw new Error('No wallet address returned.')

      const res = await connectWalletApi({
        chain: 'stellar',
        address: session.address,
        label: '',
      })

      const backendUserId = res?.userId?.trim()
      if (!backendUserId) throw new Error('Backend did not return userId.')

      setUserId(backendUserId)
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
