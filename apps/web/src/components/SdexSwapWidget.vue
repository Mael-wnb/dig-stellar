<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { buildSdexSwap } from "../api/actions";
import { useWalletSession } from "../composables/useWalletSession";
import { useNetwork, toWalletNetwork } from "../composables/useNetwork";

const TESTNET_RPC_URL = "https://soroban-testnet.stellar.org";
const MAINNET_RPC_URL = "https://mainnet.sorobanrpc.com";

const { connectedAddress, signTransaction } = useWalletSession();
const { network } = useNetwork();

// RPC endpoint follows the toggle so the submit target stays consistent with
// the network the XDR was built and signed for.
const rpcUrl = computed(() =>
  network.value === "testnet" ? TESTNET_RPC_URL : MAINNET_RPC_URL,
);

// Assets are fixed for this beta: XLM -> USDC.
const fromAsset = "XLM" as const;
const toAsset = "USDC" as const;

const amount = ref("");
const minReceive = ref("");
const minReceiveEdited = ref(false);

type SwapStatus = "idle" | "loading" | "success" | "error";
const status = ref<SwapStatus>("idle");
const txHash = ref("");
const errorMessage = ref("");

const isConnected = computed(() => !!connectedAddress.value);

// Swap is Testnet-only for this beta: the Mainnet backend / liquidity path is
// not validated yet. The rest of the decoupling (kit follows the toggle,
// dynamic RPC, passphrase fallback) stays in place for later.
const isMainnet = computed(() => network.value === "mainnet");

const canSwap = computed(
  () =>
    !isMainnet.value &&
    isConnected.value &&
    status.value !== "loading" &&
    parseFloat(amount.value) > 0 &&
    parseFloat(minReceive.value) > 0,
);

/** Formats a number to a Stellar-safe amount (<= 7 decimals, trimmed). */
function formatAmount(value: number): string {
  if (!isFinite(value) || value <= 0) return "";
  return value.toFixed(7).replace(/\.?0+$/, "");
}

// Auto-fill minReceive = amount * 0.95 until the user edits it manually.
watch(amount, (next) => {
  if (minReceiveEdited.value) return;
  const parsed = parseFloat(next);
  minReceive.value = isNaN(parsed) ? "" : formatAmount(parsed * 0.95);
});

function onMinReceiveInput() {
  minReceiveEdited.value = true;
}

async function submitToRpc(signedTxXdr: string): Promise<{
  status?: string;
  hash?: string;
  errorResultXdr?: string;
}> {
  const response = await fetch(rpcUrl.value, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "sendTransaction",
      params: { transaction: signedTxXdr },
    }),
  });

  const json = await response.json();

  if (json.error) {
    throw new Error(json.error.message || "RPC rejected the transaction.");
  }

  return json.result ?? {};
}

async function onSwap() {
  // Hard guard: never attempt a real Mainnet swap in this beta, even if the
  // button somehow got enabled.
  if (isMainnet.value) return;
  if (!canSwap.value || !connectedAddress.value) return;

  status.value = "loading";
  txHash.value = "";
  errorMessage.value = "";

  try {
    // 1. Build the unsigned XDR server-side (never exposes any key).
    const { xdr } = await buildSdexSwap({
      address: connectedAddress.value,
      fromAsset,
      toAsset,
      amount: amount.value,
      minReceive: minReceive.value,
      network: network.value,
    });

    // 2. Sign client-side via the wallet on the current toggle network,
    // using the shared StellarNetwork -> WalletNetwork mapping.
    const { signedTxXdr } = await signTransaction(
      xdr,
      toWalletNetwork(network.value),
    );

    // 3. Submit the signed XDR to the Testnet RPC.
    const result = await submitToRpc(signedTxXdr);

    if (result.status === "PENDING" || result.status === "SUCCESS") {
      txHash.value = result.hash ?? "";
      status.value = "success";
    } else {
      errorMessage.value =
        result.errorResultXdr || `Transaction failed (status: ${result.status ?? "unknown"}).`;
      status.value = "error";
    }
  } catch (err: unknown) {
    errorMessage.value =
      err instanceof Error ? err.message : "Swap failed.";
    status.value = "error";
  }
}

function reset() {
  status.value = "idle";
  txHash.value = "";
  errorMessage.value = "";
}
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

    <!-- PAIR -->
    <div class="flex items-center gap-2 text-xs">
      <div class="flex-1 bg-[#202020] border border-[#383838] rounded-md px-3 py-2 text-[#9a9b99]">
        From <span class="text-[#e2e6e1] font-semibold">{{ fromAsset }}</span>
      </div>
      <span class="text-[#d5ff2f]">→</span>
      <div class="flex-1 bg-[#202020] border border-[#383838] rounded-md px-3 py-2 text-[#9a9b99]">
        To <span class="text-[#e2e6e1] font-semibold">{{ toAsset }}</span>
      </div>
    </div>

    <!-- AMOUNT -->
    <label class="flex flex-col gap-1">
      <span class="text-[11px] text-[#9a9b99]">Amount ({{ fromAsset }})</span>
      <input
        v-model="amount"
        type="text"
        inputmode="decimal"
        placeholder="0.0"
        class="bg-[#202020] border border-[#383838] rounded-md px-3 py-2 text-sm text-[#e2e6e1] focus:border-[#d5ff2f] outline-none"
      />
    </label>

    <!-- MIN RECEIVE -->
    <label class="flex flex-col gap-1">
      <span class="text-[11px] text-[#9a9b99]">Min. receive ({{ toAsset }})</span>
      <input
        v-model="minReceive"
        type="text"
        inputmode="decimal"
        placeholder="0.0"
        class="bg-[#202020] border border-[#383838] rounded-md px-3 py-2 text-sm text-[#e2e6e1] focus:border-[#d5ff2f] outline-none"
        @input="onMinReceiveInput"
      />
    </label>

    <!-- ACTION -->
    <button
      type="button"
      class="w-full px-4 py-2 rounded-lg border border-[#d5ff2f] text-[#d5ff2f] text-xs font-semibold tracking-wide transition hover:bg-[rgba(213,255,47,0.1)] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
      :disabled="!canSwap"
      @click="onSwap"
    >
      <template v-if="isMainnet">Swap is Testnet-only in this beta</template>
      <template v-else-if="status === 'loading'">Swapping…</template>
      <template v-else-if="!isConnected">Connect wallet first</template>
      <template v-else>Swap</template>
    </button>

    <!-- SUCCESS -->
    <div
      v-if="status === 'success'"
      class="bg-[#202020] border border-[rgba(213,255,47,0.3)] rounded-md p-3 text-[11px] flex flex-col gap-1"
    >
      <span class="text-[#d5ff2f] font-semibold">Transaction submitted</span>
      <span class="text-[#9a9b99] break-all font-mono">{{ txHash }}</span>
      <a
        :href="`https://stellar.expert/explorer/testnet/tx/${txHash}`"
        target="_blank"
        class="text-[#d5ff2f] hover:underline w-fit"
      >
        View on stellar.expert ↗
      </a>
      <button type="button" class="text-[#9a9b99] hover:text-[#d5ff2f] w-fit mt-1" @click="reset">
        New swap
      </button>
    </div>

    <!-- ERROR -->
    <div
      v-else-if="status === 'error'"
      class="bg-[#202020] border border-[rgba(255,123,123,0.3)] rounded-md p-3 text-[11px] flex flex-col gap-1"
    >
      <span class="text-[#ff7b7b] font-semibold">Swap failed</span>
      <span class="text-[#9a9b99] break-all">{{ errorMessage }}</span>
      <button type="button" class="text-[#9a9b99] hover:text-[#d5ff2f] w-fit mt-1" @click="reset">
        Try again
      </button>
    </div>
  </div>
</template>
