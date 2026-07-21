<script setup lang="ts">
import { computed } from "vue";
import { useWalletSession } from "../composables/useWalletSession";
import { useActiveSigner } from "../composables/useActiveSigner";
import { useNetwork } from "../composables/useNetwork";
import { TESTNET_SWAP_PAIRS } from "../config/testnetSwapPairs";
import SdexSwapRow from "./SdexSwapRow.vue";

const { connectedAddress } = useWalletSession();
const { activeSignerAddress } = useActiveSigner();
const { network } = useNetwork();

const isMainnet = computed(() => network.value === "mainnet");
const isConnected = computed(() => !!connectedAddress.value);

const isActiveSignerConnected = computed(
  () =>
    !!connectedAddress.value &&
    !!activeSignerAddress.value &&
    connectedAddress.value.toLowerCase() ===
      activeSignerAddress.value.toLowerCase(),
);

// One shared guardrail banner for all rows (each row still enforces the same
// check defensively before signing).
const signerBlockReason = computed<string | null>(() => {
  if (!connectedAddress.value) return "Connect your active-signer wallet to sign.";
  if (!isActiveSignerConnected.value) {
    return "You're connected with a watch-only wallet. Connect your active signer to sign.";
  }
  return null;
});
</script>

<template>
  <div class="bg-[#2A2A2A] border border-[#383838] rounded-lg p-4 flex flex-col gap-3">
    <div class="flex items-center justify-between">
      <span class="text-xs font-semibold text-[#e2e6e1]">SDEX Swap</span>
      <span class="text-[10px] text-[#9a9b99] uppercase tracking-widest">{{ network }}</span>
    </div>

    <!-- MAINNET NOTICE (Testnet-only beta) -->
    <div
      v-if="isMainnet"
      class="bg-[#202020] border border-[rgba(213,255,47,0.3)] rounded-md p-3 text-[11px] text-[#9a9b99]"
    >
      Swap is <span class="text-[#d5ff2f] font-semibold">Testnet-only</span> in this beta.
      Switch the network toggle to Testnet to swap.
    </div>

    <template v-else>
      <!-- SIGNER GUARDRAIL: connected but not the active signer (watch-only) -->
      <div
        v-if="isConnected && signerBlockReason"
        class="bg-[#202020] border border-[rgba(255,184,107,0.4)] rounded-md p-3 text-[11px] text-[#ffb86b]"
      >
        {{ signerBlockReason }}
      </div>

      <p class="text-[11px] text-[#9a9b99]">
        Vetted testnet pairs (liquidity-checked). 5% auto-slippage, non-custodial —
        each swap is validated client-side before signing.
      </p>

      <!-- One row per vetted pair -->
      <SdexSwapRow v-for="pair in TESTNET_SWAP_PAIRS" :key="pair.id" :pair="pair" />
    </template>
  </div>
</template>
