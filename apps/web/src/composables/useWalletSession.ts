// src/composables/useWalletSession.ts
import { computed, ref } from "vue";
import {
  StellarWalletsKit,
  WalletNetwork,
  allowAllModules,
  XBULL_ID,
} from "@creit.tech/stellar-wallets-kit";

const STORAGE_CONNECTED_ADDRESS_KEY = "dig_stellar_connected_address";
const STORAGE_CONNECTED_PROVIDER_KEY = "dig_stellar_connected_provider";

type WalletSessionResult = {
  address: string;
  providerId: string;
};

const connectedAddress = ref<string | null>(null);
const connectedProvider = ref<string | null>(null);
const isConnecting = ref(false);
const initialized = ref(false);

const kit = new StellarWalletsKit({
  network:
    import.meta.env.VITE_STELLAR_NETWORK === "TESTNET"
      ? WalletNetwork.TESTNET
      : WalletNetwork.PUBLIC,
  selectedWalletId: XBULL_ID,
  modules: allowAllModules(),
});

function persistSession(address: string, providerId: string): void {
  connectedAddress.value = address;
  connectedProvider.value = providerId;

  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_CONNECTED_ADDRESS_KEY, address);
    window.localStorage.setItem(STORAGE_CONNECTED_PROVIDER_KEY, providerId);
  }
}

function clearSession(): void {
  connectedAddress.value = null;
  connectedProvider.value = null;

  if (typeof window !== "undefined") {
    window.localStorage.removeItem(STORAGE_CONNECTED_ADDRESS_KEY);
    window.localStorage.removeItem(STORAGE_CONNECTED_PROVIDER_KEY);
  }
}

function restoreWalletSession(): void {
  if (initialized.value) return;
  initialized.value = true;

  if (typeof window === "undefined") return;

  const storedAddress = window.localStorage.getItem(STORAGE_CONNECTED_ADDRESS_KEY);
  const storedProvider = window.localStorage.getItem(STORAGE_CONNECTED_PROVIDER_KEY);

  connectedAddress.value =
    storedAddress && storedAddress.trim().length > 0 ? storedAddress : null;
  connectedProvider.value =
    storedProvider && storedProvider.trim().length > 0 ? storedProvider : null;

  // Re-align the kit with the restored session. The kit keeps the selected
  // wallet in memory only (no internal persistence), so after a page reload it
  // falls back to its constructor default. Replay setWallet so a later
  // signTransaction targets the wallet the user actually connected with.
  if (connectedProvider.value) {
    try {
      kit.setWallet(connectedProvider.value);
    } catch (error) {
      console.warn(
        "[wallet-session] could not restore wallet provider into kit",
        error,
      );
    }
  }

  console.log("[wallet-session] restore", {
    connectedAddress: connectedAddress.value,
    connectedProvider: connectedProvider.value,
  });
}

async function connectWallet(): Promise<WalletSessionResult | null> {
  isConnecting.value = true;

  try {
    const result = await new Promise<WalletSessionResult>((resolve, reject) => {
      let resolved = false;

      void kit.openModal({
        onWalletSelected: async (option: { id: string }) => {
          try {
            kit.setWallet(option.id);

            const { address } = await kit.getAddress();

            if (!address || !/^G[A-Z2-7]{55}$/.test(address)) {
              throw new Error("Invalid Stellar address returned by wallet.");
            }

            const sessionResult: WalletSessionResult = {
              address,
              providerId: option.id,
            };

            persistSession(sessionResult.address, sessionResult.providerId);

            resolved = true;
            resolve(sessionResult);
          } catch (error) {
            reject(error);
          }
        },
      }).catch((error: unknown) => {
        if (!resolved) {
          reject(error);
        }
      });
    });

    console.log("[wallet-session] connectWallet resolved", result);
    return result;
  } catch (error) {
    console.error("[wallet-session] connectWallet failed", error);
    return null;
  } finally {
    isConnecting.value = false;
  }
}

function disconnectWallet(): void {
  clearSession();
}

async function signTransaction(
  xdr: string,
  passphrase: WalletNetwork | string,
): Promise<{ signedTxXdr: string }> {
  if (!connectedAddress.value) {
    throw new Error("No wallet connected.");
  }

  if (!connectedProvider.value) {
    throw new Error("No wallet provider selected.");
  }

  // Defensive: force the kit onto the connected wallet right before signing.
  // The kit's selected wallet lives in memory only and can drift from the
  // restored session (e.g. after a reload it defaults back to its constructor
  // wallet), so re-select it here to guarantee the correct provider signs.
  kit.setWallet(connectedProvider.value);

  const { signedTxXdr } = await kit.signTransaction(xdr, {
    networkPassphrase: passphrase,
    address: connectedAddress.value,
  });

  return { signedTxXdr };
}

const shortConnectedAddress = computed(() => {
  if (!connectedAddress.value) return null;
  return `${connectedAddress.value.slice(0, 6)}…${connectedAddress.value.slice(-4)}`;
});

export function useWalletSession() {
  restoreWalletSession();

  return {
    connectedAddress,
    connectedProvider,
    shortConnectedAddress,
    isConnecting,
    connectWallet,
    disconnectWallet,
    restoreWalletSession,
    signTransaction,
  };
}