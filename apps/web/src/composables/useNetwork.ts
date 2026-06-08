// src/composables/useNetwork.ts
import { ref } from "vue";
import { WalletNetwork } from "@creit.tech/stellar-wallets-kit";

export type StellarNetwork = "mainnet" | "testnet";

const STORAGE_NETWORK_KEY = "dig_stellar_network";

// VITE_STELLAR_NETWORK is only the *initial* default when nothing has been
// stored yet. Once the user toggles, localStorage (and the toggle) win.
const ENV_DEFAULT_NETWORK: StellarNetwork =
  import.meta.env.VITE_STELLAR_NETWORK === "TESTNET" ? "testnet" : "mainnet";

const network = ref<StellarNetwork>(ENV_DEFAULT_NETWORK);
const initialized = ref(false);

// Single source of truth for the StellarNetwork -> WalletNetwork (passphrase)
// mapping. Reused by useWalletSession and any signing call site so they never
// diverge.
export function toWalletNetwork(net: StellarNetwork): WalletNetwork {
  return net === "testnet" ? WalletNetwork.TESTNET : WalletNetwork.PUBLIC;
}

function restoreNetwork(): void {
  if (initialized.value) return;
  initialized.value = true;

  if (typeof window === "undefined") return;

  const stored = window.localStorage.getItem(STORAGE_NETWORK_KEY);
  network.value =
    stored === "testnet" || stored === "mainnet" ? stored : ENV_DEFAULT_NETWORK;

  console.log("[network] restoreNetwork", { network: network.value });
}

function setNetwork(next: StellarNetwork): void {
  network.value = next;

  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_NETWORK_KEY, next);
  }

  console.log("[network] setNetwork", { network: next });
}

export function useNetwork() {
  restoreNetwork();

  return {
    network,
    setNetwork,
    restoreNetwork,
  };
}
