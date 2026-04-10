// src/composables/useWalletSession.ts
import { computed, ref } from "vue";
import {
  StellarWalletsKit,
  WalletNetwork,
  allowAllModules,
  XBULL_ID,
} from "@creit.tech/stellar-wallets-kit";

type WalletConnectResult = {
  address: string;
  providerId: string | null;
} | null;

const STORAGE_ADDRESS_KEY = "dig_stellar_connected_address";
const STORAGE_PROVIDER_KEY = "dig_stellar_connected_provider";

const isTestnet = import.meta.env.VITE_STELLAR_NETWORK === "TESTNET";

const connectedAddress = ref<string | null>(null);
const connectedProviderId = ref<string | null>(null);
const isConnecting = ref(false);
const initialized = ref(false);

const kit = new StellarWalletsKit({
  network: isTestnet ? WalletNetwork.TESTNET : WalletNetwork.PUBLIC,
  selectedWalletId: XBULL_ID,
  modules: allowAllModules(),
});

function restoreWalletSession(): void {
  if (initialized.value) return;
  if (typeof window === "undefined") return;

  connectedAddress.value = localStorage.getItem(STORAGE_ADDRESS_KEY);
  connectedProviderId.value = localStorage.getItem(STORAGE_PROVIDER_KEY);
  initialized.value = true;
}

function persistWalletSession(address: string, providerId: string | null): void {
  connectedAddress.value = address;
  connectedProviderId.value = providerId;

  if (typeof window === "undefined") return;

  localStorage.setItem(STORAGE_ADDRESS_KEY, address);

  if (providerId) {
    localStorage.setItem(STORAGE_PROVIDER_KEY, providerId);
  } else {
    localStorage.removeItem(STORAGE_PROVIDER_KEY);
  }
}

function disconnectWallet(): void {
  connectedAddress.value = null;
  connectedProviderId.value = null;

  if (typeof window === "undefined") return;

  localStorage.removeItem(STORAGE_ADDRESS_KEY);
  localStorage.removeItem(STORAGE_PROVIDER_KEY);
}

async function connectWallet(): Promise<WalletConnectResult> {
  restoreWalletSession();
  isConnecting.value = true;

  try {
    let result: WalletConnectResult = null;

    await kit.openModal({
      onWalletSelected: async (option: { id: string }) => {
        kit.setWallet(option.id);

        const { address } = await kit.getAddress();

        if (!address || !/^G[A-Z2-7]{55}$/.test(address)) {
          throw new Error("Invalid Stellar address returned by wallet.");
        }

        persistWalletSession(address, option.id);

        result = {
          address,
          providerId: option.id,
        };
      },
    });

    return result;
  } finally {
    isConnecting.value = false;
  }
}

const shortConnectedAddress = computed(() => {
  if (!connectedAddress.value) return null;
  return `${connectedAddress.value.slice(0, 6)}…${connectedAddress.value.slice(-4)}`;
});

export function useWalletSession() {
  restoreWalletSession();

  return {
    kit,
    connectedAddress,
    connectedProviderId,
    shortConnectedAddress,
    isConnecting,
    connectWallet,
    disconnectWallet,
    restoreWalletSession,
  };
}