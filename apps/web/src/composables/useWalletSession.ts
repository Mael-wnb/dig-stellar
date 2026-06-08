// src/composables/useWalletSession.ts
import { computed, ref, watch } from "vue";
import {
  StellarWalletsKit,
  WalletNetwork,
  allowAllModules,
  XBULL_ID,
} from "@creit.tech/stellar-wallets-kit";
import { useNetwork, toWalletNetwork } from "./useNetwork";

// useNetwork is the single source of truth for the active network. Resolve it
// once at module scope (this also runs restoreNetwork() so the value already
// reflects localStorage / the env default) so the kit can be built on the
// current network and a single watcher can keep it in sync.
const { network } = useNetwork();

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
  network: toWalletNetwork(network.value),
  selectedWalletId: XBULL_ID,
  modules: allowAllModules(),
});

// Keep the kit aligned with the toggle. Registered ONCE at module scope (next
// to the kit instance), NOT inside useWalletSession() — otherwise every mounted
// component would add its own watcher. `immediate` reasserts the network the
// kit was already built with, which is harmless and guards against drift.
watch(
  network,
  (next) => {
    kit.setNetwork(toWalletNetwork(next));
    console.log("[wallet-session] kit network synced", { network: next });
  },
  { immediate: true },
);

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
  passphrase?: WalletNetwork | string,
): Promise<{ signedTxXdr: string }> {
  if (!connectedAddress.value) {
    throw new Error("No wallet connected.");
  }

  if (!connectedProvider.value) {
    throw new Error("No wallet provider selected.");
  }

  // Default to the current toggle network. Callers passing an explicit
  // passphrase (legacy call sites) keep working unchanged.
  const networkPassphrase = passphrase ?? toWalletNetwork(network.value);

  // Defensive: force the kit onto the connected wallet right before signing.
  // The kit's selected wallet lives in memory only and can drift from the
  // restored session (e.g. after a reload it defaults back to its constructor
  // wallet), so re-select it here to guarantee the correct provider signs.
  kit.setWallet(connectedProvider.value);

  const { signedTxXdr } = await kit.signTransaction(xdr, {
    networkPassphrase,
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