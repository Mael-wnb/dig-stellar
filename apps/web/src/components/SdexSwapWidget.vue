<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { buildSdexSwap, quoteSdexSwap } from "../api/actions";
import { useWalletSession } from "../composables/useWalletSession";
import { useNetwork, toWalletNetwork } from "../composables/useNetwork";

const TESTNET_RPC_URL = "https://soroban-testnet.stellar.org";
const MAINNET_RPC_URL = "https://mainnet.sorobanrpc.com";

// Beta-first slippage tolerance for testnet (5%): no configurable selector.
// minReceive = estimate * (1 - SLIPPAGE) is derived from the live quote.
const SLIPPAGE = 0.05;
const QUOTE_DEBOUNCE_MS = 300;

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

// Live quote state. `estimate` is the expected received amount (toAsset),
// `rate` is toAsset per 1 fromAsset. minReceive is no longer user-entered.
type QuoteStatus = "idle" | "loading" | "ok" | "empty" | "error";
const quoteStatus = ref<QuoteStatus>("idle");
const estimate = ref<number | null>(null);
const rate = ref<number | null>(null);
const quoteError = ref("");

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
    (estimate.value ?? 0) > 0,
);

/** Formats a number to a Stellar-safe amount (<= 7 decimals, trimmed). */
function formatAmount(value: number): string {
  if (!isFinite(value) || value <= 0) return "";
  return value.toFixed(7).replace(/\.?0+$/, "");
}

/** minReceive applied to the swap = live estimate minus slippage tolerance. */
const minReceiveDisplay = computed(() =>
  estimate.value != null ? formatAmount(estimate.value * (1 - SLIPPAGE)) : "",
);

/** Pulls a human message out of an apiFetch error (Nest returns JSON in the body). */
function readApiError(err: unknown, fallback: string): string {
  if (!(err instanceof Error)) return fallback;
  try {
    const parsed = JSON.parse(err.message) as { message?: string };
    if (typeof parsed.message === "string") return parsed.message;
  } catch {
    // not JSON — fall through to the raw message
  }
  return err.message || fallback;
}

// Live quote on amount change (debounced). A 422 from the API (no direct
// liquidity) is surfaced as a clean "empty" state, not a hard error.
let quoteTimer: ReturnType<typeof setTimeout> | undefined;
let quoteSeq = 0;

function clearQuote() {
  estimate.value = null;
  rate.value = null;
  quoteError.value = "";
  quoteStatus.value = "idle";
}

watch(amount, (next) => {
  if (quoteTimer) clearTimeout(quoteTimer);
  const parsed = parseFloat(next);
  if (isNaN(parsed) || parsed <= 0 || isMainnet.value) {
    clearQuote();
    return;
  }
  quoteStatus.value = "loading";
  quoteError.value = "";
  const seq = ++quoteSeq;
  quoteTimer = setTimeout(async () => {
    try {
      const quote = await quoteSdexSwap({
        fromAsset,
        toAsset,
        amount: next,
        network: network.value,
      });
      if (seq !== quoteSeq) return; // a newer amount superseded this request
      estimate.value = parseFloat(quote.destAmount);
      rate.value = quote.rate;
      quoteStatus.value = "ok";
    } catch (err: unknown) {
      if (seq !== quoteSeq) return;
      estimate.value = null;
      rate.value = null;
      const message = readApiError(err, "Quote failed.");
      // The API returns 422 with a "No direct liquidity" message for empty routes.
      if (/liquidity/i.test(message)) {
        quoteStatus.value = "empty";
        quoteError.value = "No liquidity for this amount on testnet.";
      } else {
        quoteStatus.value = "error";
        quoteError.value = message;
      }
    }
  }, QUOTE_DEBOUNCE_MS);
});

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

  // Derive minReceive from the live estimate at submit time, applying slippage.
  const minReceive = minReceiveDisplay.value;
  if (!minReceive || parseFloat(minReceive) <= 0) return;

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
      minReceive,
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

    <!-- LIVE QUOTE (read-only): rate + min. receive after slippage -->
    <div
      v-if="!isMainnet"
      class="bg-[#202020] border border-[#383838] rounded-md px-3 py-2 text-[11px] flex flex-col gap-1"
    >
      <template v-if="quoteStatus === 'loading'">
        <span class="text-[#9a9b99]">Fetching live price…</span>
      </template>
      <template v-else-if="quoteStatus === 'ok' && estimate != null && rate != null">
        <div class="flex items-center justify-between">
          <span class="text-[#9a9b99]">Rate</span>
          <span class="text-[#e2e6e1]">1 {{ fromAsset }} ≈ {{ formatAmount(rate) }} {{ toAsset }}</span>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-[#9a9b99]">Est. receive</span>
          <span class="text-[#e2e6e1]">{{ formatAmount(estimate) }} {{ toAsset }}</span>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-[#9a9b99]">Min. receive ({{ (SLIPPAGE * 100).toFixed(0) }}% slippage)</span>
          <span class="text-[#d5ff2f] font-semibold">{{ minReceiveDisplay }} {{ toAsset }}</span>
        </div>
      </template>
      <template v-else-if="quoteStatus === 'empty'">
        <span class="text-[#ff7b7b]">{{ quoteError }}</span>
      </template>
      <template v-else-if="quoteStatus === 'error'">
        <span class="text-[#ff7b7b]">{{ quoteError }}</span>
      </template>
      <template v-else>
        <span class="text-[#9a9b99]">Enter an amount to see the live price.</span>
      </template>
    </div>

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
