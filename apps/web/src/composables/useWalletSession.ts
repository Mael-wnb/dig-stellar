// src/composables/useWalletSession.ts
import { computed, ref, watch } from "vue";
import {
  StellarWalletsKit,
  WalletNetwork,
  allowAllModules,
  XBULL_ID,
} from "@creit.tech/stellar-wallets-kit";
import { useNetwork, toWalletNetwork } from "./useNetwork";
import {
  requestAuthChallenge,
  verifyAuthChallenge,
  type AuthVerifyResult,
} from "../api/campaign";

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

/**
 * Lot EP (EP1): wallet-ownership proof. Challenge → kit.signMessage → verify.
 * The message is plain text from the API stating that this is NOT a
 * transaction (nothing is built, simulated or submitted; no XDR exists, so the
 * §2 XDR gates do not apply). The signature is verified server-side with the
 * public key only. `userId` binds the proof to the current app user; omit it
 * for the unbound recovery proof. Returns the API result unchanged.
 * Requires the address to be the currently connected wallet.
 */
// Module-level export on purpose (NOT a property of the useWalletSession()
// return object): an unused named export is tree-shaken out of the production
// bundle together with the /auth/* client calls, whereas an object key would
// survive minification. Only the DEV-only panel imports it in EP1.
export async function signProof(
  address: string,
  userId: string | null,
): Promise<{ challenge: { nonce: string; message: string; expiresAt: string }; result: AuthVerifyResult }> {
  if (!connectedAddress.value || connectedAddress.value !== address) {
    throw new Error("The address to prove must be the connected wallet.");
  }
  if (!connectedProvider.value) {
    throw new Error("No wallet provider selected.");
  }

  const challenge = await requestAuthChallenge(address);

  // Same defensive re-select as signTransaction: the kit's selected wallet is
  // in-memory only and can drift after a reload.
  kit.setWallet(connectedProvider.value);
  const { signedMessage } = await kit.signMessage(challenge.message, {
    networkPassphrase: toWalletNetwork(network.value),
    address,
  });

  const result = await verifyAuthChallenge({
    address,
    nonce: challenge.nonce,
    signedMessage,
    provider: connectedProvider.value,
    userId,
  });

  return {
    challenge: { nonce: challenge.nonce, message: challenge.message, expiresAt: challenge.expiresAt },
    result,
  };
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