// src/composables/useNetwork.ts
import { ref } from "vue";

export type StellarNetwork = "mainnet" | "testnet";

const STORAGE_NETWORK_KEY = "dig_stellar_network";

const network = ref<StellarNetwork>("mainnet");
const initialized = ref(false);

function restoreNetwork(): void {
  if (initialized.value) return;
  initialized.value = true;

  if (typeof window === "undefined") return;

  const stored = window.localStorage.getItem(STORAGE_NETWORK_KEY);
  network.value = stored === "testnet" ? "testnet" : "mainnet";

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
