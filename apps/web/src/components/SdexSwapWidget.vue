<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import {
  buildSdexSwap,
  quoteSdexSwap,
  reportActionWitness,
  type SdexAssetRef,
} from "../api/actions";
import { useWalletSession } from "../composables/useWalletSession";
import { useActiveSigner } from "../composables/useActiveSigner";
import { useAppUser } from "../composables/useAppUser";
import { useFaucet } from "../composables/useFaucet";
import FaucetClaimPanel from "./FaucetClaimPanel.vue";
import { useNetwork, toWalletNetwork } from "../composables/useNetwork";
import { validateSwapXdr, type SwapIntent, type AssetId } from "../lib/validateSwapXdr";
import {
  TESTNET_SWAP_ASSETS,
  swapAssetKey,
  type TestnetSwapAsset,
} from "../config/testnetSwapPairs";
import { MAINNET_SWAP_ASSETS } from "../config/mainnetSwapPairs";
// H3 (Lot H): presentation-only custom asset picker — receives the SAME
// `assets` whitelist the native <select> bound and emits the same asset keys.
import TokenSelect from "./common/TokenSelect.vue";

const TESTNET_RPC_URL = "https://soroban-testnet.stellar.org";
const MAINNET_RPC_URL = "https://mainnet.sorobanrpc.com";
const TESTNET_HORIZON_URL = "https://horizon-testnet.stellar.org";
const MAINNET_HORIZON_URL = "https://horizon.stellar.org";

// UX-only mainnet gate (INV-4.1): the API kill-switch is the real enforcement. When
// this is false, mainnet is `mainnetBlocked` and the UI is exactly today's testnet-only
// behavior; flipping it on reveals the (still API-gated) mainnet swap surface.
const MAINNET_SWAP_ENABLED =
  import.meta.env.VITE_ACTIONS_MAINNET_ENABLED === "true";

// Beta-first slippage tolerance for testnet (5%): no configurable selector.
const SLIPPAGE = 0.05;
const QUOTE_DEBOUNCE_MS = 300;
// Keep a little XLM back for fees / base reserve when MAX-ing the native asset.
const XLM_RESERVE = 1;

const { connectedAddress, signTransaction } = useWalletSession();
const { activeSignerAddress } = useActiveSigner();
const { network } = useNetwork();
const { userId } = useAppUser();

// R3 (Lot R): upfront reward note — rendered ONLY while the campaign is live
// on THIS network (never a stale promise), plus the post-swap claim panel.
const { campaign: faucetCampaign, campaignLiveFor, refreshCampaign } = useFaucet();
const faucetPromo = computed(() =>
  campaignLiveFor(network.value) ? faucetCampaign.value : null,
);
onMounted(() => void refreshCampaign());

const rpcUrl = computed(() =>
  network.value === "testnet" ? TESTNET_RPC_URL : MAINNET_RPC_URL,
);

// --- Asset selection (Uniswap-style From / To) ----------------------------
// The asset universe follows the active network: the vetted testnet list, or the
// vetted mainnet list (XLM ↔ USDC at launch). Selections reset on a network switch.
function assetsFor(net: string): TestnetSwapAsset[] {
  return net === "mainnet" ? MAINNET_SWAP_ASSETS : TESTNET_SWAP_ASSETS;
}
const assets = computed<TestnetSwapAsset[]>(() => assetsFor(network.value));

const initialAssets = assetsFor(network.value);
const fromKey = ref(swapAssetKey(initialAssets[0])); // XLM
const toKey = ref(swapAssetKey(initialAssets[1] ?? initialAssets[0])); // first vetted target

const fromAsset = computed<TestnetSwapAsset>(
  () => assets.value.find((a) => swapAssetKey(a) === fromKey.value) ?? assets.value[0],
);
const toAsset = computed<TestnetSwapAsset>(
  () => assets.value.find((a) => swapAssetKey(a) === toKey.value) ?? assets.value[0],
);
const fromCode = computed(() => fromAsset.value.code);
const toCode = computed(() => toAsset.value.code);

// Keep From ≠ To. If a selection collides, bump the OTHER side (the one the user
// didn't just change) to the next free asset.
watch([fromKey, toKey], ([f, t], [pf]) => {
  if (f !== t) return;
  const free = assets.value.find((a) => swapAssetKey(a) !== f);
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
  // No balances while mainnet is blocked (UI hidden) — same as today's testnet-only
  // early return. Otherwise load from the active network's Horizon.
  if (!addr || mainnetBlocked.value) return;
  const horizonUrl =
    network.value === "mainnet" ? MAINNET_HORIZON_URL : TESTNET_HORIZON_URL;
  try {
    const res = await fetch(`${horizonUrl}/accounts/${addr}`);
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

// On a network switch the asset universe changes — reset From/To to that network's
// defaults, clear the amount + any stale quote, and reload balances from its Horizon.
watch(network, () => {
  const list = assets.value;
  fromKey.value = swapAssetKey(list[0]);
  toKey.value = swapAssetKey(list[1] ?? list[0]);
  amount.value = "";
  clearQuote();
  loadBalances();
});

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
// True only when a SUBMITTED transaction was not accepted by the network
// (sendTransaction did not return PENDING). This widget never polls getTransaction,
// so the only network-facing failure it can observe is a SUBMISSION-time rejection —
// the tx never reached a ledger and NOTHING was charged. Drives that honest copy
// (F4); do not claim an on-chain failure or a consumed fee here. Pairs with F2.
const rejectedBeforeInclusion = ref(false);

const isConnected = computed(() => !!connectedAddress.value);
const isMainnet = computed(() => network.value === "mainnet");
// Mainnet without the UX flag = today's testnet-only behavior (blocked). This — not
// raw isMainnet — gates every swap surface, so flipping the flag reveals the (still
// API-gated) mainnet path in one place.
const mainnetBlocked = computed(() => isMainnet.value && !MAINNET_SWAP_ENABLED);

// stellar.expert path segment must follow the real network (INV-6.1): `public` on
// mainnet, `testnet` otherwise.
const explorerNetwork = computed(() => (isMainnet.value ? "public" : "testnet"));

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
    !mainnetBlocked.value &&
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

/**
 * Friendly copy for a failed swap build. The API's spendable preflight (F2) returns
 * a 400 with code INSUFFICIENT_SPENDABLE_BALANCE + the spendable amount — render it
 * honestly rather than dumping the raw JSON. Other errors fall back to their message.
 */
function friendlyBuildError(err: unknown): string {
  if (err instanceof Error) {
    try {
      const body = JSON.parse(err.message) as {
        code?: string;
        spendable?: string;
        message?: string;
      };
      if (body.code === "INSUFFICIENT_SPENDABLE_BALANCE") {
        const avail = body.spendable != null ? displayBalance(body.spendable) : "0";
        return `Insufficient balance: ${avail} ${fromCode.value} available — the rest is reserved by the Stellar network.`;
      }
      if (typeof body.message === "string") return body.message;
    } catch {
      // not JSON
    }
  }
  return err instanceof Error ? err.message : "Swap failed.";
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
  if (isNaN(parsed) || parsed <= 0 || mainnetBlocked.value) {
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
        quoteError.value = `No liquidity for this direction on ${network.value}.`;
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
  if (mainnetBlocked.value) return;
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
  rejectedBeforeInclusion.value = false;

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

    // 4. Submit to the active network's RPC.
    const result = await submitToRpc(signedTxXdr);

    if (result.status === "PENDING" || result.status === "SUCCESS") {
      txHash.value = result.hash ?? "";
      status.value = "success";
      // R1 (Lot R): report the executed swap for server-side verification.
      // Fire-and-forget — never blocks or fails the swap flow.
      if (txHash.value) {
        reportActionWitness({
          txHash: txHash.value,
          network: network.value,
          userId: userId.value ?? undefined,
        });
      }
      loadBalances(); // reflect the new balances
    } else {
      // The network did not accept the submission (e.g. a fee bid under surge
      // pricing) — it never reached a ledger, so nothing was charged at all.
      errorMessage.value =
        result.errorResultXdr ||
        `Transaction rejected (status: ${result.status ?? "unknown"}).`;
      rejectedBeforeInclusion.value = true;
      status.value = "error";
    }
  } catch (err: unknown) {
    errorMessage.value = friendlyBuildError(err);
    status.value = "error";
  }
}

function reset() {
  status.value = "idle";
  txHash.value = "";
  errorMessage.value = "";
  rejectedBeforeInclusion.value = false;
}
</script>

<template>
  <!-- H3 (Lot H): Uniswap-standard reskin — PRESENTATION ONLY. Every state,
       binding, gate and copy string below is carried over from the previous
       template verbatim; only layout and styling changed. -->
  <div class="flex flex-col gap-[10px]">
    <div class="flex items-center justify-between px-[2px]">
      <span class="text-[13px] font-semibold" style="color: var(--dig-text)">SDEX Swap</span>
      <span class="text-[10px] uppercase tracking-widest" style="color: var(--dig-faint)">{{ network }}</span>
    </div>

    <!-- MAINNET NOTICE (Testnet-only until ungated) -->
    <div
      v-if="mainnetBlocked"
      class="rounded-[12px] px-[14px] py-[11px] text-[12px]"
      style="background: var(--dig-surface-2); border: 1px solid rgba(213,255,47,0.3); color: var(--dig-faint)"
    >
      Swap is <span class="font-semibold" style="color: var(--dig-accent)">Testnet-only</span> in this beta.
      Switch the network toggle to Testnet to swap.
    </div>

    <template v-else>
      <!-- MAINNET WARNING (live: real funds + launch cap) -->
      <div
        v-if="isMainnet"
        class="rounded-[12px] px-[14px] py-[11px] text-[12px]"
        style="background: rgba(255,184,107,0.08); border: 1px solid rgba(255,184,107,0.5); color: var(--dig-amber)"
      >
        <span class="font-semibold">Mainnet</span> — this swap moves real funds. A
        per-transaction cap applies during the launch period.
      </div>

      <!-- FAUCET PROMO (Lot R, R3): the offer is seen BEFORE the action.
           Disappears by itself when the budget is spent or the flag is off. -->
      <div
        v-if="faucetPromo"
        class="rounded-[12px] px-[14px] py-[9px] text-[12px]"
        style="background: var(--dig-surface-2); border: 1px solid rgba(213,255,47,0.35); color: var(--dig-faint)"
      >
        <span class="font-semibold" style="color: var(--dig-accent)">Earn {{ faucetPromo.rewardXlm }} XLM</span>
        — your first swap (≥ {{ faucetPromo.minNotionalXlm }} XLM) earns a reward ·
        {{ faucetPromo.remainingClaims }} claims left
      </div>

      <!-- SIGNER GUARDRAIL -->
      <div
        v-if="isConnected && signerBlockReason"
        class="rounded-[12px] px-[14px] py-[11px] text-[12px]"
        style="background: rgba(255,184,107,0.08); border: 1px solid rgba(255,184,107,0.4); color: var(--dig-amber)"
      >
        {{ signerBlockReason }}
      </div>

      <!-- FROM / TO boxes with the centered flip button between them -->
      <div class="relative flex flex-col gap-[5px]">
        <!-- FROM -->
        <div class="rounded-[16px] px-[16px] pt-[12px] pb-[14px]" style="background: var(--dig-surface-2); border: 1px solid var(--dig-line-soft)">
          <div class="flex items-center justify-between text-[12px]" style="color: var(--dig-faint)">
            <span>From</span>
            <span>
              Balance: {{ displayBalance(balanceFor(fromAsset)) }} {{ fromCode }}
              <button
                type="button"
                class="ml-[5px] font-bold cursor-pointer hover:underline disabled:opacity-40 disabled:cursor-not-allowed"
                style="color: var(--dig-accent)"
                :disabled="parseFloat(balanceFor(fromAsset)) <= 0"
                @click="setMax"
              >
                Max
              </button>
            </span>
          </div>
          <div class="flex items-center gap-[10px] mt-[8px]">
            <input
              v-model="amount"
              type="text"
              inputmode="decimal"
              placeholder="0.0"
              class="flex-1 bg-transparent text-[28px] font-bold tracking-[-0.02em] tabular-nums outline-none min-w-0 placeholder:text-[#5c5c5c]"
              style="color: var(--dig-text)"
            />
            <TokenSelect v-model="fromKey" :assets="assets" />
          </div>
        </div>

        <!-- INVERT (restyled — same invert()) -->
        <div class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10">
          <button
            type="button"
            class="w-[38px] h-[38px] rounded-[13px] cursor-pointer flex items-center justify-center transition-colors hover:brightness-110"
            style="background: var(--dig-surface-3); border: 4px solid var(--dig-surface); color: var(--dig-text)"
            title="Invert direction"
            @click="invert"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M6 13l6 6 6-6"/></svg>
          </button>
        </div>

        <!-- TO -->
        <div class="rounded-[16px] px-[16px] pt-[12px] pb-[14px]" style="background: var(--dig-surface-2); border: 1px solid var(--dig-line-soft)">
          <div class="flex items-center justify-between text-[12px]" style="color: var(--dig-faint)">
            <span>To (estimated)</span>
            <span>
              Balance: {{ displayBalance(balanceFor(toAsset)) }} {{ toCode }}
            </span>
          </div>
          <div class="flex items-center gap-[10px] mt-[8px]">
            <span
              class="flex-1 text-[28px] font-bold tracking-[-0.02em] tabular-nums min-w-0 truncate"
              :style="{ color: estimate != null ? 'var(--dig-text)' : '#5c5c5c' }"
            >
              {{ estimate != null ? formatAmount(estimate) : "0.0" }}
            </span>
            <TokenSelect v-model="toKey" :assets="assets" />
          </div>
        </div>
      </div>

      <!-- QUOTE DETAIL -->
      <div class="text-[12px] flex flex-col gap-[5px] px-[4px]">
        <template v-if="quoteStatus === 'loading'">
          <span style="color: var(--dig-faint)">Fetching live price…</span>
        </template>
        <template v-else-if="quoteStatus === 'ok' && estimate != null && rate != null">
          <div class="flex items-center justify-between">
            <span style="color: var(--dig-faint)">Rate</span>
            <span class="tabular-nums" style="color: var(--dig-text)">1 {{ fromCode }} ≈ {{ formatAmount(rate) }} {{ toCode }}</span>
          </div>
          <div class="flex items-center justify-between">
            <span style="color: var(--dig-faint)">Min. receive ({{ (SLIPPAGE * 100).toFixed(0) }}% slippage)</span>
            <span class="font-semibold tabular-nums" style="color: var(--dig-accent)">{{ minReceiveDisplay }} {{ toCode }}</span>
          </div>
        </template>
        <template v-else-if="quoteStatus === 'empty'">
          <span style="color: var(--dig-amber)">{{ quoteError }}</span>
        </template>
        <template v-else-if="quoteStatus === 'error'">
          <span style="color: var(--dig-red)">{{ quoteError }}</span>
        </template>
      </div>

      <!-- ACTION -->
      <button
        type="button"
        class="dig-btn w-full h-[48px] rounded-[13px] text-[14px] font-bold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        style="background: var(--dig-accent); color: #141414; border: none"
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
        class="rounded-[12px] px-[14px] py-[11px] text-[12px] flex flex-col gap-[4px]"
        style="background: var(--dig-surface-2); border: 1px solid rgba(213,255,47,0.3)"
      >
        <span class="font-semibold" style="color: var(--dig-accent)">Transaction submitted</span>
        <a
          :href="`https://stellar.expert/explorer/${explorerNetwork}/tx/${txHash}`"
          target="_blank"
          rel="noopener"
          class="break-all font-mono-geist w-fit hover:underline"
          style="color: var(--dig-faint)"
          title="View transaction on stellar.expert"
        >{{ txHash }}</a>
        <a
          :href="`https://stellar.expert/explorer/${explorerNetwork}/tx/${txHash}`"
          target="_blank"
          class="hover:underline w-fit"
          style="color: var(--dig-accent)"
        >
          View on stellar.expert ↗
        </a>
        <button type="button" class="w-fit mt-[2px] cursor-pointer hover:underline" style="color: var(--dig-faint)" @click="reset">
          New swap
        </button>

        <!-- FAUCET CLAIM (Lot R, R3/R3c): INSIDE the success block — never
             between v-if/v-else-if siblings (that chain-break took down the
             Blend form in prod, 2026-08-17). Renders nothing while dark;
             keyed on the hash so a new swap re-checks. -->
        <FaucetClaimPanel
          v-if="txHash && connectedAddress"
          :key="txHash"
          :wallet="connectedAddress"
          :network="network"
          :tx-hash="txHash"
        />
      </div>

      <!-- ERROR -->
      <div
        v-else-if="status === 'error'"
        class="rounded-[12px] px-[14px] py-[11px] text-[12px] flex flex-col gap-[4px]"
        style="background: var(--dig-surface-2); border: 1px solid rgba(255,123,123,0.3)"
      >
        <span class="font-semibold" style="color: var(--dig-red)">Swap failed</span>
        <span
          v-if="rejectedBeforeInclusion"
          style="color: var(--dig-faint)"
        >
          The transaction was rejected before inclusion — it never reached a ledger,
          so nothing was charged and no funds moved.
        </span>
        <span class="break-all" style="color: var(--dig-faint)">{{ errorMessage }}</span>
        <button type="button" class="w-fit mt-[2px] cursor-pointer hover:underline" style="color: var(--dig-faint)" @click="reset">
          Try again
        </button>
      </div>
    </template>
  </div>
</template>
