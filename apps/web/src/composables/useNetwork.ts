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

  // The global network toggle was removed: the portfolio is always Mainnet and
  // the network selector now scopes ONLY the Testnet swap (signing). Boot
  // therefore always starts from the env default (Mainnet) and purges any legacy
  // persisted value, so an old `dig_stellar_network=testnet` can no longer trap
  // the portfolio in a testnet state on reload.
  window.localStorage.removeItem(STORAGE_NETWORK_KEY);
  network.value = ENV_DEFAULT_NETWORK;

  console.log("[network] restoreNetwork", { network: network.value });
}

function setNetwork(next: StellarNetwork): void {
  // Session-scoped only (module-level ref). Intentionally NOT persisted: a reload
  // must return to the Mainnet default so a swap-time network choice cannot
  // silently outlive its session and mislead the Mainnet portfolio.
  network.value = next;

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
