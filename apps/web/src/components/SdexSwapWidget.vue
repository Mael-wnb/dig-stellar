<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { buildSdexSwap, quoteSdexSwap, type SdexAssetRef } from "../api/actions";
import { useWalletSession } from "../composables/useWalletSession";
import { useActiveSigner } from "../composables/useActiveSigner";
import { useNetwork, toWalletNetwork } from "../composables/useNetwork";
import { validateSwapXdr, type SwapIntent, type AssetId } from "../lib/validateSwapXdr";
import {
  TESTNET_SWAP_ASSETS,
  swapAssetKey,
  type TestnetSwapAsset,
} from "../config/testnetSwapPairs";

const TESTNET_RPC_URL = "https://soroban-testnet.stellar.org";
const MAINNET_RPC_URL = "https://mainnet.sorobanrpc.com";
const TESTNET_HORIZON_URL = "https://horizon-testnet.stellar.org";

// Beta-first slippage tolerance for testnet (5%): no configurable selector.
const SLIPPAGE = 0.05;
const QUOTE_DEBOUNCE_MS = 300;
// Keep a little XLM back for fees / base reserve when MAX-ing the native asset.
const XLM_RESERVE = 1;

const { connectedAddress, signTransaction } = useWalletSession();
const { activeSignerAddress } = useActiveSigner();
const { network } = useNetwork();

const rpcUrl = computed(() =>
  network.value === "testnet" ? TESTNET_RPC_URL : MAINNET_RPC_URL,
);

// --- Asset selection (Uniswap-style From / To) ----------------------------
const assets = TESTNET_SWAP_ASSETS;
const fromKey = ref(swapAssetKey(assets[0])); // XLM
const toKey = ref(swapAssetKey(assets[1] ?? assets[0])); // first vetted target

const fromAsset = computed<TestnetSwapAsset>(
  () => assets.find((a) => swapAssetKey(a) === fromKey.value) ?? assets[0],
);
const toAsset = computed<TestnetSwapAsset>(
  () => assets.find((a) => swapAssetKey(a) === toKey.value) ?? assets[0],
);
const fromCode = computed(() => fromAsset.value.code);
const toCode = computed(() => toAsset.value.code);

// Keep From ≠ To. If a selection collides, bump the OTHER side (the one the user
// didn't just change) to the next free asset.
watch([fromKey, toKey], ([f, t], [pf]) => {
  if (f !== t) return;
  const free = assets.find((a) => swapAssetKey(a) !== f);
  if (!free) return;
  if (f !== pf) toKey.value = swapAssetKey(free); // From changed → move To
  else fromKey.value = swapAssetKey(free); // To changed → move From
});

function invert() {
  const f = fromKey.value;
  fromKey.value = toKey.value;
  toKey.value = f;
}

// API refs + validator identities for each side.
function toApiRef(a: TestnetSwapAsset): SdexAssetRef {
  return a.code === "XLM" ? { code: "XLM" } : { code: a.code, issuer: a.issuer };
}
function toAssetId(a: TestnetSwapAsset): AssetId {
  return a.code === "XLM" ? "native" : { code: a.code, issuer: a.issuer ?? "" };
}
const fromRef = computed<SdexAssetRef>(() => toApiRef(fromAsset.value));
const toRef = computed<SdexAssetRef>(() => toApiRef(toAsset.value));

// --- Testnet balances (Horizon /accounts/:id) -----------------------------
const balances = ref<Record<string, string>>({});

async function loadBalances() {
  balances.value = {};
  const addr = connectedAddress.value;
  if (!addr || network.value !== "testnet") return;
  try {
    const res = await fetch(`${TESTNET_HORIZON_URL}/accounts/${addr}`);
    if (!res.ok) return; // unfunded / not found → all balances stay 0
    const data = await res.json();
    const map: Record<string, string> = {};
    for (const b of data.balances ?? []) {
      if (b.asset_type === "native") map["XLM"] = b.balance;
      else if (b.asset_code && b.asset_issuer) {
        map[`${b.asset_code}:${b.asset_issuer}`] = b.balance;
      }
    }
    balances.value = map;
  } catch {
    // network hiccup — leave balances empty (shown as 0)
  }
}

/** Human balance for an asset — 0 when unknown / no trustline. */
function balanceFor(a: TestnetSwapAsset): string {
  return balances.value[swapAssetKey(a)] ?? "0";
}

onMounted(loadBalances);
watch(connectedAddress, loadBalances);

// --- Amount / quote --------------------------------------------------------
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
    return "You're connected with a watch-only wallet. Connect your active signer to sign.";
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

function formatAmount(value: number): string {
  if (!isFinite(value) || value <= 0) return "";
  return value.toFixed(7).replace(/\.?0+$/, "");
}

/** Trims a balance string for compact display (up to 4 dp). */
function displayBalance(v: string): string {
  const n = parseFloat(v);
  if (!isFinite(n)) return "0";
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

const minReceiveDisplay = computed(() =>
  estimate.value != null ? formatAmount(estimate.value * (1 - SLIPPAGE)) : "",
);

function setMax() {
  const bal = parseFloat(balanceFor(fromAsset.value)) || 0;
  const reserve = fromAsset.value.code === "XLM" ? XLM_RESERVE : 0;
  const max = Math.max(0, bal - reserve);
  amount.value = max > 0 ? formatAmount(max) : "0";
}

function readApiError(err: unknown, fallback: string): string {
  if (!(err instanceof Error)) return fallback;
  try {
    const parsed = JSON.parse(err.message) as { message?: string };
    if (typeof parsed.message === "string") return parsed.message;
  } catch {
    // not JSON
  }
  return err.message || fallback;
}

// Live quote on any change to (from, to, amount), debounced. A 422 (no direct
// liquidity for this direction) is a clean "empty" state, never a raw error.
let quoteTimer: ReturnType<typeof setTimeout> | undefined;
let quoteSeq = 0;

function clearQuote() {
  estimate.value = null;
  rate.value = null;
  quoteError.value = "";
  quoteStatus.value = "idle";
}

watch([fromKey, toKey, amount], () => {
  if (quoteTimer) clearTimeout(quoteTimer);
  const parsed = parseFloat(amount.value);
  if (isNaN(parsed) || parsed <= 0 || isMainnet.value) {
    clearQuote();
    return;
  }
  quoteStatus.value = "loading";
  quoteError.value = "";
  const seq = ++quoteSeq;
  const amt = amount.value;
  quoteTimer = setTimeout(async () => {
    try {
      const quote = await quoteSdexSwap({
        fromAsset: fromRef.value,
        toAsset: toRef.value,
        amount: amt,
        network: network.value,
      });
      if (seq !== quoteSeq) return;
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
        quoteError.value = "No liquidity for this direction on testnet.";
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
  if (json.error) throw new Error(json.error.message || "RPC rejected the transaction.");
  return json.result ?? {};
}

async function onSwap() {
  if (isMainnet.value) return;
  if (signerBlockReason.value) {
    errorMessage.value = signerBlockReason.value;
    status.value = "error";
    return;
  }
  if (!canSwap.value || !connectedAddress.value) return;

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

    // 2. SECURITY GATE — validate against intent DERIVED FROM USER INPUT before
    // the wallet is invoked. A first swap into a not-yet-trusted asset may include
    // a leading ChangeTrust for the dest asset (and only that) — allowed explicitly.
    const passphrase = toWalletNetwork(network.value);
    const destId = toAssetId(toAsset.value);
    const intent: SwapIntent = {
      sourceAccount: connectedAddress.value,
      sendAsset: toAssetId(fromAsset.value),
      sendAmount: amount.value,
      destAsset: destId,
      destMin: minReceive,
      networkPassphrase: passphrase,
      ...(destId === "native" ? {} : { allowTrustlineFor: destId }),
    };
    const check = validateSwapXdr(xdr, intent);
    if (!check.ok) {
      errorMessage.value = `Refused to sign — XDR did not match your request: ${check.violations.join("; ")}`;
      status.value = "error";
      return;
    }

    // 3. Sign client-side on the current toggle network.
    const { signedTxXdr } = await signTransaction(xdr, passphrase);

    // 4. Submit to the Testnet RPC.
    const result = await submitToRpc(signedTxXdr);

    if (result.status === "PENDING" || result.status === "SUCCESS") {
      txHash.value = result.hash ?? "";
      status.value = "success";
      loadBalances(); // reflect the new balances
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
      <!-- SIGNER GUARDRAIL -->
      <div
        v-if="isConnected && signerBlockReason"
        class="bg-[#202020] border border-[rgba(255,184,107,0.4)] rounded-md p-3 text-[11px] text-[#ffb86b]"
      >
        {{ signerBlockReason }}
      </div>

      <!-- FROM -->
      <div class="bg-[#202020] border border-[#383838] rounded-md p-3 flex flex-col gap-2">
        <div class="flex items-center justify-between text-[11px]">
          <span class="text-[#9a9b99]">From</span>
          <span class="text-[#9a9b99]">
            Balance: {{ displayBalance(balanceFor(fromAsset)) }} {{ fromCode }}
            <button
              type="button"
              class="ml-1 text-[#d5ff2f] hover:underline disabled:opacity-40"
              :disabled="parseFloat(balanceFor(fromAsset)) <= 0"
              @click="setMax"
            >
              MAX
            </button>
          </span>
        </div>
        <div class="flex items-center gap-2">
          <input
            v-model="amount"
            type="text"
            inputmode="decimal"
            placeholder="0.0"
            class="flex-1 bg-transparent text-lg text-[#e2e6e1] outline-none min-w-0"
          />
          <select
            v-model="fromKey"
            class="bg-[#2A2A2A] border border-[#383838] rounded-md px-2 py-1 text-xs text-[#e2e6e1] focus:border-[#d5ff2f] outline-none"
          >
            <option v-for="a in assets" :key="swapAssetKey(a)" :value="swapAssetKey(a)">
              {{ a.code }}
            </option>
          </select>
        </div>
      </div>

      <!-- INVERT -->
      <div class="flex justify-center -my-1">
        <button
          type="button"
          class="w-7 h-7 rounded-full border border-[#383838] bg-[#202020] text-[#d5ff2f] text-sm flex items-center justify-center hover:border-[#d5ff2f] transition"
          title="Invert direction"
          @click="invert"
        >
          ↓↑
        </button>
      </div>

      <!-- TO -->
      <div class="bg-[#202020] border border-[#383838] rounded-md p-3 flex flex-col gap-2">
        <div class="flex items-center justify-between text-[11px]">
          <span class="text-[#9a9b99]">To (estimated)</span>
          <span class="text-[#9a9b99]">
            Balance: {{ displayBalance(balanceFor(toAsset)) }} {{ toCode }}
          </span>
        </div>
        <div class="flex items-center gap-2">
          <span class="flex-1 text-lg min-w-0 truncate" :class="estimate != null ? 'text-[#e2e6e1]' : 'text-[#5c5c5c]'">
            {{ estimate != null ? formatAmount(estimate) : "0.0" }}
          </span>
          <select
            v-model="toKey"
            class="bg-[#2A2A2A] border border-[#383838] rounded-md px-2 py-1 text-xs text-[#e2e6e1] focus:border-[#d5ff2f] outline-none"
          >
            <option v-for="a in assets" :key="swapAssetKey(a)" :value="swapAssetKey(a)">
              {{ a.code }}
            </option>
          </select>
        </div>
      </div>

      <!-- QUOTE DETAIL -->
      <div class="text-[11px] flex flex-col gap-1 px-1">
        <template v-if="quoteStatus === 'loading'">
          <span class="text-[#9a9b99]">Fetching live price…</span>
        </template>
        <template v-else-if="quoteStatus === 'ok' && estimate != null && rate != null">
          <div class="flex items-center justify-between">
            <span class="text-[#9a9b99]">Rate</span>
            <span class="text-[#e2e6e1]">1 {{ fromCode }} ≈ {{ formatAmount(rate) }} {{ toCode }}</span>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-[#9a9b99]">Min. receive ({{ (SLIPPAGE * 100).toFixed(0) }}% slippage)</span>
            <span class="text-[#d5ff2f] font-semibold">{{ minReceiveDisplay }} {{ toCode }}</span>
          </div>
        </template>
        <template v-else-if="quoteStatus === 'empty'">
          <span class="text-[#ffb86b]">{{ quoteError }}</span>
        </template>
        <template v-else-if="quoteStatus === 'error'">
          <span class="text-[#ff7b7b]">{{ quoteError }}</span>
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
        <template v-else-if="quoteStatus === 'empty'">No liquidity for this direction</template>
        <template v-else>Swap {{ fromCode }} → {{ toCode }}</template>
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
    </template>
  </div>
</template>
