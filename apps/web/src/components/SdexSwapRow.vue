<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { buildSdexSwap, quoteSdexSwap, type SdexAssetRef } from "../api/actions";
import { useWalletSession } from "../composables/useWalletSession";
import { useActiveSigner } from "../composables/useActiveSigner";
import { useNetwork, toWalletNetwork } from "../composables/useNetwork";
import { validateSwapXdr, type SwapIntent, type AssetId } from "../lib/validateSwapXdr";
import type { TestnetSwapPair } from "../config/testnetSwapPairs";

const props = defineProps<{ pair: TestnetSwapPair }>();

const TESTNET_RPC_URL = "https://soroban-testnet.stellar.org";
const MAINNET_RPC_URL = "https://mainnet.sorobanrpc.com";

// Beta-first slippage tolerance for testnet (5%): no configurable selector.
// minReceive = estimate * (1 - SLIPPAGE) is derived from the live quote.
const SLIPPAGE = 0.05;
const QUOTE_DEBOUNCE_MS = 300;

const { connectedAddress, signTransaction } = useWalletSession();
const { activeSignerAddress } = useActiveSigner();
const { network } = useNetwork();

const fromCode = computed(() => props.pair.from.code);
const toCode = computed(() => props.pair.to.code);

// Canonical asset refs sent to the API. From side is native XLM for every vetted
// pair; the To side pins the exact (code, issuer) that made the pair fillable.
const fromRef = computed<SdexAssetRef>(() => ({ code: props.pair.from.code }));
const toRef = computed<SdexAssetRef>(() => ({
  code: props.pair.to.code,
  issuer: props.pair.to.issuer,
}));

// The same identities expressed for the client-side XDR validator (its own type).
const sendAssetId = computed<AssetId>(() =>
  props.pair.from.code === "XLM"
    ? "native"
    : { code: props.pair.from.code, issuer: "" },
);
const destAssetId = computed<AssetId>(() => ({
  code: props.pair.to.code,
  issuer: props.pair.to.issuer,
}));

const rpcUrl = computed(() =>
  network.value === "testnet" ? TESTNET_RPC_URL : MAINNET_RPC_URL,
);

const amount = ref("");

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
const isMainnet = computed(() => network.value === "mainnet");

// Signing guardrail: only the LIVE active signer may sign — a watch-only wallet
// (or no connection) is blocked.
const isActiveSignerConnected = computed(
  () =>
    !!connectedAddress.value &&
    !!activeSignerAddress.value &&
    connectedAddress.value.toLowerCase() ===
      activeSignerAddress.value.toLowerCase(),
);

const signerBlockReason = computed<string | null>(() => {
  if (!connectedAddress.value) return "Connect your active-signer wallet to sign.";
  if (!isActiveSignerConnected.value) {
    return "Connected wallet is watch-only. Connect your active signer to sign.";
  }
  return null;
});

const canSwap = computed(
  () =>
    !isMainnet.value &&
    isConnected.value &&
    isActiveSignerConnected.value &&
    status.value !== "loading" &&
    parseFloat(amount.value) > 0 &&
    (estimate.value ?? 0) > 0,
);

/** Formats a number to a Stellar-safe amount (<= 7 decimals, trimmed). */
function formatAmount(value: number): string {
  if (!isFinite(value) || value <= 0) return "";
  return value.toFixed(7).replace(/\.?0+$/, "");
}

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

// Live quote on amount change (debounced). A 422 (no direct liquidity) surfaces
// as a clean "empty" state, not a hard error.
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
        fromAsset: fromRef.value,
        toAsset: toRef.value,
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
  // Hard guard: never attempt a Mainnet swap in this beta.
  if (isMainnet.value) return;

  // Signing guardrail: never build/sign unless the connected wallet is the
  // designated active signer.
  if (signerBlockReason.value) {
    errorMessage.value = signerBlockReason.value;
    status.value = "error";
    return;
  }

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
      fromAsset: fromRef.value,
      toAsset: toRef.value,
      amount: amount.value,
      minReceive,
      network: network.value,
    });

    // 2. SECURITY GATE — validate the returned XDR against intent DERIVED FROM
    // USER INPUT (never from the API response), BEFORE the wallet is invoked.
    // Catches wrong asset/issuer, extra ops, worse slippage, or a foreign
    // source/destination. A first-time swap may legitimately include a leading
    // ChangeTrust for the dest asset, so that (and only that) is permitted.
    const passphrase = toWalletNetwork(network.value);
    const intent: SwapIntent = {
      sourceAccount: connectedAddress.value,
      sendAsset: sendAssetId.value,
      sendAmount: amount.value,
      destAsset: destAssetId.value,
      destMin: minReceive,
      networkPassphrase: passphrase,
      allowTrustlineFor: destAssetId.value,
    };
    const check = validateSwapXdr(xdr, intent);
    if (!check.ok) {
      errorMessage.value = `Refused to sign — XDR did not match your request: ${check.violations.join("; ")}`;
      status.value = "error";
      return;
    }

    // 3. Sign client-side via the wallet on the current toggle network.
    const { signedTxXdr } = await signTransaction(xdr, passphrase);

    // 4. Submit the signed XDR to the Testnet RPC.
    const result = await submitToRpc(signedTxXdr);

    if (result.status === "PENDING" || result.status === "SUCCESS") {
      txHash.value = result.hash ?? "";
      status.value = "success";
    } else {
      errorMessage.value =
        result.errorResultXdr ||
        `Transaction failed (status: ${result.status ?? "unknown"}).`;
      status.value = "error";
    }
  } catch (err: unknown) {
    errorMessage.value = err instanceof Error ? err.message : "Swap failed.";
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
  <div class="bg-[#202020] border border-[#383838] rounded-md p-3 flex flex-col gap-2">
    <!-- PAIR HEADER -->
    <div class="flex items-center justify-between">
      <span class="text-xs font-semibold text-[#e2e6e1]">{{ pair.label }}</span>
      <span class="text-[10px] text-[#9a9b99]">SDEX</span>
    </div>
    <p v-if="pair.note" class="text-[10px] text-[#9a9b99] -mt-1">{{ pair.note }}</p>

    <!-- AMOUNT -->
    <label class="flex flex-col gap-1">
      <span class="text-[11px] text-[#9a9b99]">Amount ({{ fromCode }})</span>
      <input
        v-model="amount"
        type="text"
        inputmode="decimal"
        placeholder="0.0"
        class="bg-[#2A2A2A] border border-[#383838] rounded-md px-3 py-2 text-sm text-[#e2e6e1] focus:border-[#d5ff2f] outline-none"
      />
    </label>

    <!-- LIVE QUOTE -->
    <div class="text-[11px] flex flex-col gap-1">
      <template v-if="quoteStatus === 'loading'">
        <span class="text-[#9a9b99]">Fetching live price…</span>
      </template>
      <template v-else-if="quoteStatus === 'ok' && estimate != null && rate != null">
        <div class="flex items-center justify-between">
          <span class="text-[#9a9b99]">Rate</span>
          <span class="text-[#e2e6e1]">1 {{ fromCode }} ≈ {{ formatAmount(rate) }} {{ toCode }}</span>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-[#9a9b99]">Est. receive</span>
          <span class="text-[#e2e6e1]">{{ formatAmount(estimate) }} {{ toCode }}</span>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-[#9a9b99]">Min. receive ({{ (SLIPPAGE * 100).toFixed(0) }}% slippage)</span>
          <span class="text-[#d5ff2f] font-semibold">{{ minReceiveDisplay }} {{ toCode }}</span>
        </div>
      </template>
      <template v-else-if="quoteStatus === 'empty' || quoteStatus === 'error'">
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
      <template v-if="status === 'loading'">Swapping…</template>
      <template v-else-if="!isConnected">Connect wallet first</template>
      <template v-else-if="!isActiveSignerConnected">Connect your active signer</template>
      <template v-else>Swap {{ pair.label }}</template>
    </button>

    <!-- SUCCESS -->
    <div
      v-if="status === 'success'"
      class="bg-[#2A2A2A] border border-[rgba(213,255,47,0.3)] rounded-md p-2 text-[11px] flex flex-col gap-1"
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
      class="bg-[#2A2A2A] border border-[rgba(255,123,123,0.3)] rounded-md p-2 text-[11px] flex flex-col gap-1"
    >
      <span class="text-[#ff7b7b] font-semibold">Swap failed</span>
      <span class="text-[#9a9b99] break-all">{{ errorMessage }}</span>
      <button type="button" class="text-[#9a9b99] hover:text-[#d5ff2f] w-fit mt-1" @click="reset">
        Try again
      </button>
    </div>
  </div>
</template>
