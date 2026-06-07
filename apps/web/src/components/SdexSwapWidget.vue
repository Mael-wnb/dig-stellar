<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { WalletNetwork } from "@creit.tech/stellar-wallets-kit";
import { buildSdexSwap } from "../api/actions";
import { useWalletSession } from "../composables/useWalletSession";

const TESTNET_RPC_URL = "https://soroban-testnet.stellar.org";

const { connectedAddress, signTransaction } = useWalletSession();

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
const canSwap = computed(
  () =>
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
  const response = await fetch(TESTNET_RPC_URL, {
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
      network: "testnet",
    });

    // 2. Sign client-side via the wallet, using the Testnet passphrase explicitly.
    const { signedTxXdr } = await signTransaction(xdr, WalletNetwork.TESTNET);

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
  <div class="bg-card border border-border rounded-lg p-4 flex flex-col gap-3">
    <div class="flex items-center justify-between">
      <span class="text-xs font-semibold text-text">SDEX Swap</span>
      <span class="text-[10px] text-muted uppercase tracking-widest">Testnet</span>
    </div>

    <!-- PAIR -->
    <div class="flex items-center gap-2 text-xs">
      <div class="flex-1 bg-bg border border-border rounded-md px-3 py-2 text-muted">
        From <span class="text-text font-semibold">{{ fromAsset }}</span>
      </div>
      <span class="text-accent">→</span>
      <div class="flex-1 bg-bg border border-border rounded-md px-3 py-2 text-muted">
        To <span class="text-text font-semibold">{{ toAsset }}</span>
      </div>
    </div>

    <!-- AMOUNT -->
    <label class="flex flex-col gap-1">
      <span class="text-[11px] text-muted">Amount ({{ fromAsset }})</span>
      <input
        v-model="amount"
        type="text"
        inputmode="decimal"
        placeholder="0.0"
        class="bg-bg border border-border rounded-md px-3 py-2 text-sm text-text focus:border-accent outline-none"
      />
    </label>

    <!-- MIN RECEIVE -->
    <label class="flex flex-col gap-1">
      <span class="text-[11px] text-muted">Min. receive ({{ toAsset }})</span>
      <input
        v-model="minReceive"
        type="text"
        inputmode="decimal"
        placeholder="0.0"
        class="bg-bg border border-border rounded-md px-3 py-2 text-sm text-text focus:border-accent outline-none"
        @input="onMinReceiveInput"
      />
    </label>

    <!-- ACTION -->
    <button
      type="button"
      class="w-full px-4 py-2 rounded-lg border border-accent text-accent text-xs font-semibold tracking-wide transition hover:bg-accent/10 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
      :disabled="!canSwap"
      @click="onSwap"
    >
      <template v-if="status === 'loading'">Swapping…</template>
      <template v-else-if="!isConnected">Connect wallet first</template>
      <template v-else>Swap</template>
    </button>

    <!-- SUCCESS -->
    <div
      v-if="status === 'success'"
      class="bg-bg border border-accent/30 rounded-md p-3 text-[11px] flex flex-col gap-1"
    >
      <span class="text-accent font-semibold">Transaction submitted</span>
      <span class="text-muted break-all font-mono">{{ txHash }}</span>
      <a
        :href="`https://stellar.expert/explorer/testnet/tx/${txHash}`"
        target="_blank"
        class="text-accent hover:underline w-fit"
      >
        View on stellar.expert ↗
      </a>
      <button type="button" class="text-muted hover:text-accent w-fit mt-1" @click="reset">
        New swap
      </button>
    </div>

    <!-- ERROR -->
    <div
      v-else-if="status === 'error'"
      class="bg-bg border border-red-500/30 rounded-md p-3 text-[11px] flex flex-col gap-1"
    >
      <span class="text-red-400 font-semibold">Swap failed</span>
      <span class="text-muted break-all">{{ errorMessage }}</span>
      <button type="button" class="text-muted hover:text-accent w-fit mt-1" @click="reset">
        Try again
      </button>
    </div>
  </div>
</template>
