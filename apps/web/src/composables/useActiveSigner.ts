// src/composables/useActiveSigner.ts
//
// Module-scoped shared state for the active-signer DESIGNATION (the persisted
// `is_active_signer` wallet, surfaced as an address). This is the persisted half
// of the T2-D1 hybrid: the live half is `connectedAddress` from
// useWalletSession. A signing context is "live" iff the connected Kit address
// equals this address.
//
// Lives at module scope (like useAppUser / useWalletSession) so that components
// which do NOT own the wallets list — notably SdexSwapWidget — can read the
// active signer without re-fetching. useWallets is the single writer (it keeps
// this in sync whenever the wallet list loads).
import { ref } from "vue";

const activeSignerAddress = ref<string | null>(null);

function setActiveSignerAddress(address: string | null): void {
  activeSignerAddress.value =
    address && address.trim().length > 0 ? address : null;
}

export function useActiveSigner() {
  return {
    activeSignerAddress,
    setActiveSignerAddress,
  };
}
