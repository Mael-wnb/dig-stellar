// src/composables/useStellarWalletConnect.ts
import { computed, ref } from 'vue'
import {
  StellarWalletsKit,
  WalletNetwork,
  allowAllModules,
  XBULL_ID,
} from '@creit.tech/stellar-wallets-kit'

export interface StellarWalletConnectResult {
  address: string
}

export function useStellarWalletConnect() {
  const isConnecting = ref(false)
  const signLoading = ref(false)
  const error = ref('')

  const pendingAddress = ref('')
  const showSignModal = ref(false)

  const kit = new StellarWalletsKit({
    network: WalletNetwork.PUBLIC,
    selectedWalletId: XBULL_ID,
    modules: allowAllModules(),
  })

  const pendingSignMessage = computed(() =>
    `I confirm that I own this Stellar wallet:\n${pendingAddress.value}\n\nTimestamp: ${Date.now()}`
  )

  async function openConnectModal(existingAddresses: string[]): Promise<StellarWalletConnectResult | null> {
    error.value = ''
    isConnecting.value = true

    try {
      let selectedAddress: string | null = null

      await kit.openModal({
        onWalletSelected: async (option) => {
          kit.setWallet(option.id)
          const { address } = await kit.getAddress()

          if (!address || !/^G[A-Z2-7]{55}$/.test(address)) {
            throw new Error('Invalid Stellar address returned by wallet.')
          }

          if (existingAddresses.includes(address)) {
            throw new Error('This wallet is already added.')
          }

          selectedAddress = address
          pendingAddress.value = address
          showSignModal.value = true
        },
      })

      return selectedAddress ? { address: selectedAddress } : null
    } catch (err: unknown) {
      error.value = err instanceof Error ? err.message : 'Connection failed or cancelled.'
      return null
    } finally {
      isConnecting.value = false
    }
  }

  async function signPendingAddress(): Promise<string | null> {
    if (!pendingAddress.value) return null

    signLoading.value = true
    error.value = ''

    try {
      const { signedMessage } = await (kit as any).signMessage({
        message: pendingSignMessage.value,
        publicKey: pendingAddress.value,
      })

      return signedMessage ?? ''
    } catch (err: unknown) {
      error.value = err instanceof Error ? err.message : 'Signature failed.'
      return null
    } finally {
      signLoading.value = false
    }
  }

  function closeSignModal() {
    showSignModal.value = false
    pendingAddress.value = ''
    error.value = ''
  }

  return {
    isConnecting,
    signLoading,
    error,
    pendingAddress,
    showSignModal,
    pendingSignMessage,
    openConnectModal,
    signPendingAddress,
    closeSignModal,
  }
}