<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { TransactionBuilder, FeeBumpTransaction } from "@stellar/stellar-sdk";
import type { Asset } from "@stellar/stellar-sdk";
import { buildBlendDeposit } from "../api/actions";
import { useWalletSession } from "../composables/useWalletSession";
import { useActiveSigner } from "../composables/useActiveSigner";
import { useNetwork, toWalletNetwork } from "../composables/useNetwork";
import { TESTNET_BLEND_POOL } from "../config/testnetBlendPools";

const TESTNET_RPC_URL = "https://soroban-testnet.stellar.org";
const TESTNET_HORIZON_URL = "https://horizon-testnet.stellar.org";
// The classic asset the Blend deposit trustline must point at (SAC-backed USDC).
const BLEND_USDC_ISSUER = "GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56";

const { connectedAddress, signTransaction } = useWalletSession();
const { activeSignerAddress } = useActiveSigner();
const { network } = useNetwork();

const pool = TESTNET_BLEND_POOL;
// XLM is the default/primary path: native, no trustline, funded by friendbot →
// zero-prerequisite and proven. USDC is secondary and cannot be obtained in-app
// (see usdcUnavailable below).
const asset = ref<"XLM" | "USDC">("XLM");
const amount = ref("");

const selectedAssetNote = computed(
  () => pool.assets.find((a) => a.code === asset.value)?.note ?? "",
);

// --- Testnet balances (Horizon /accounts/:id) -----------------------------
const balances = ref<Record<string, string>>({});

async function loadBalances() {
  balances.value = {};
  const addr = connectedAddress.value;
  if (!addr || network.value !== "testnet") return;
  try {
    const res = await fetch(`${TESTNET_HORIZON_URL}/accounts/${addr}`);
    if (!res.ok) return;
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
    // leave empty (shown as 0)
  }
}

onMounted(loadBalances);
watch(connectedAddress, loadBalances);

const xlmBalance = computed(() => parseFloat(balances.value["XLM"] ?? "0") || 0);
const usdcBalance = computed(
  () => parseFloat(balances.value[`USDC:${BLEND_USDC_ISSUER}`] ?? "0") || 0,
);
const selectedBalance = computed(() =>
  asset.value === "XLM" ? xlmBalance.value : usdcBalance.value,
);

/**
 * The Blend reserve USDC (SAC CAQCFV… / classic USDC:GATALTGT…) cannot be acquired
 * in-app: no permissionless faucet (its SAC admin is the issuer account — minting
 * needs that secret, e.g. blend-utils), and testnet SDEX only has dust liquidity
 * for it (~0.001 USDC for 50 XLM). So when USDC is selected without a balance, the
 * deposit is a dead end — steer the user to XLM, the working path.
 */
const usdcUnavailable = computed(
  () => asset.value === "USDC" && usdcBalance.value <= 0,
);

type DepositStatus = "idle" | "building" | "step1" | "step2" | "success" | "error";
const status = ref<DepositStatus>("idle");
const stepLabel = ref("");
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
    return "Connected wallet is watch-only. Connect your active signer to sign.";
  }
  return null;
});

const isBusy = computed(
  () => status.value === "building" || status.value === "step1" || status.value === "step2",
);

const canDeposit = computed(
  () =>
    !isMainnet.value &&
    isConnected.value &&
    isActiveSignerConnected.value &&
    !isBusy.value &&
    !usdcUnavailable.value &&
    parseFloat(amount.value) > 0,
);

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
 * Minimal client-side guard, mirroring the non-custodial invariant: before signing
 * ANY returned XDR we confirm it spends from the user's own account and contains
 * exactly the op we expect (a Soroban invokeHostFunction for the deposit, or a
 * ChangeTrust to the expected USDC asset for the trustline). Not a full Soroban
 * arg-decoder — but it blocks a foreign source, a fee-bump wrapper, or a swapped op.
 */
function assertOwnTx(
  xdr: string,
  passphrase: string,
  expect: "deposit" | "trustline",
): void {
  const tx = TransactionBuilder.fromXDR(xdr, passphrase);
  if (tx instanceof FeeBumpTransaction) {
    throw new Error("Refused to sign: unexpected fee-bump wrapper.");
  }
  if (tx.source !== connectedAddress.value) {
    throw new Error("Refused to sign: transaction source is not your account.");
  }
  if (tx.operations.length !== 1) {
    throw new Error(`Refused to sign: expected 1 operation, found ${tx.operations.length}.`);
  }
  const op = tx.operations[0];
  if (expect === "deposit" && op.type !== "invokeHostFunction") {
    throw new Error(`Refused to sign: expected a Soroban deposit, got ${op.type}.`);
  }
  if (expect === "trustline") {
    if (op.type !== "changeTrust") {
      throw new Error(`Refused to sign: expected a trustline op, got ${op.type}.`);
    }
    const line = op.line as Asset;
    const okAsset =
      typeof line?.getCode === "function" &&
      line.getCode() === "USDC" &&
      line.getIssuer() === BLEND_USDC_ISSUER;
    if (!okAsset) {
      throw new Error("Refused to sign: trustline points at an unexpected asset.");
    }
  }
}

async function rpcCall(method: string, params: unknown): Promise<any> {
  const res = await fetch(TESTNET_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || "RPC error");
  return json.result ?? {};
}

/** Sends a signed XDR and, if PENDING, polls getTransaction until it settles. */
async function submitAndConfirm(signedXdr: string): Promise<string> {
  const sent = await rpcCall("sendTransaction", { transaction: signedXdr });
  if (sent.status === "ERROR") {
    throw new Error(sent.errorResultXdr || "RPC rejected the transaction.");
  }
  const hash: string = sent.hash;
  if (sent.status === "SUCCESS") return hash;

  // Poll (Soroban settles a ledger or two later).
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const got = await rpcCall("getTransaction", { hash });
    if (got.status === "SUCCESS") return hash;
    if (got.status === "FAILED") {
      throw new Error(`Transaction failed on-chain (${hash}).`);
    }
  }
  throw new Error(`Timed out waiting for confirmation (${hash}). Check the explorer.`);
}

async function onDeposit() {
  if (isMainnet.value) return;
  if (signerBlockReason.value) {
    errorMessage.value = signerBlockReason.value;
    status.value = "error";
    return;
  }
  if (!canDeposit.value || !connectedAddress.value) return;

  status.value = "building";
  txHash.value = "";
  errorMessage.value = "";
  stepLabel.value = "";

  const address = connectedAddress.value;
  const passphrase = toWalletNetwork(network.value);

  try {
    let built = await buildBlendDeposit({
      address,
      asset: asset.value,
      amount: amount.value,
      network: network.value,
    });

    // Step 1/2 — the deposit CANNOT be simulated until the classic USDC trustline
    // exists (the SAC transfer would trap with Contract #13). So when the backend
    // reports one is required, it returns ONLY the ChangeTrust: sign it, confirm it
    // ON-CHAIN, then re-request the build — which can now simulate the deposit.
    const twoStep = built.trustlineRequired === true;
    if (twoStep) {
      if (!built.changetrustXdr) {
        throw new Error("Trustline required but no ChangeTrust was returned.");
      }
      status.value = "step1";
      stepLabel.value = "1/2 Approve trustline";
      assertOwnTx(built.changetrustXdr, passphrase, "trustline");
      const ct = await signTransaction(built.changetrustXdr, passphrase);
      await submitAndConfirm(ct.signedTxXdr);

      // Re-build now that the trustline is on-chain. Refuse to proceed if the
      // deposit still isn't buildable (trustline not yet visible, or no USDC held).
      status.value = "building";
      stepLabel.value = "";
      built = await buildBlendDeposit({
        address,
        asset: asset.value,
        amount: amount.value,
        network: network.value,
      });
      if (built.trustlineRequired) {
        throw new Error(
          "Trustline not visible yet — give it a few seconds and try again.",
        );
      }
    }

    if (!built.simulation.success || !built.xdr) {
      errorMessage.value =
        built.simulation.error ||
        "Deposit simulation failed. Ensure the account holds this asset on testnet.";
      status.value = "error";
      return;
    }

    // Step (2/2 or 1/1) — the Soroban deposit itself.
    status.value = "step2";
    stepLabel.value = twoStep ? "2/2 Sign deposit" : "Sign deposit";
    assertOwnTx(built.xdr, passphrase, "deposit");
    const dep = await signTransaction(built.xdr, passphrase);
    const hash = await submitAndConfirm(dep.signedTxXdr);

    txHash.value = hash;
    status.value = "success";
    loadBalances(); // reflect the new balances
  } catch (err: unknown) {
    errorMessage.value = readApiError(err, "Deposit failed.");
    status.value = "error";
  }
}

function reset() {
  status.value = "idle";
  txHash.value = "";
  errorMessage.value = "";
  stepLabel.value = "";
}
</script>

<template>
  <div class="bg-[#2A2A2A] border border-[#383838] rounded-lg p-4 flex flex-col gap-3">
    <div class="flex items-center justify-between">
      <span class="text-xs font-semibold text-[#e2e6e1]">Blend Deposit</span>
      <span class="text-[10px] text-[#9a9b99] uppercase tracking-widest">{{ network }}</span>
    </div>

    <div
      v-if="isMainnet"
      class="bg-[#202020] border border-[rgba(213,255,47,0.3)] rounded-md p-3 text-[11px] text-[#9a9b99]"
    >
      Blend deposit is <span class="text-[#d5ff2f] font-semibold">Testnet-only</span> in this beta.
    </div>

    <template v-else>
      <div
        v-if="isConnected && signerBlockReason"
        class="bg-[#202020] border border-[rgba(255,184,107,0.4)] rounded-md p-3 text-[11px] text-[#ffb86b]"
      >
        {{ signerBlockReason }}
      </div>

      <div class="text-[11px] text-[#9a9b99] flex items-center justify-between">
        <span>{{ pool.label }}</span>
        <span class="font-mono">{{ pool.contractId.slice(0, 6) }}…{{ pool.contractId.slice(-4) }}</span>
      </div>

      <!-- ASSET (XLM is the recommended, zero-prerequisite path) -->
      <div class="flex gap-2">
        <button
          v-for="a in pool.assets"
          :key="a.code"
          type="button"
          class="flex-1 px-3 py-2 rounded-md border text-xs font-semibold transition flex items-center justify-center gap-1"
          :class="
            asset === a.code
              ? 'border-[#d5ff2f] text-[#d5ff2f] bg-[rgba(213,255,47,0.08)]'
              : 'border-[#383838] text-[#9a9b99] hover:border-[#555]'
          "
          @click="asset = a.code"
        >
          {{ a.code }}
          <span
            v-if="a.code === 'XLM'"
            class="text-[8px] uppercase tracking-wider text-[#d5ff2f] border border-[rgba(213,255,47,0.4)] rounded px-1"
          >
            Recommended
          </span>
        </button>
      </div>

      <div class="text-[11px] text-[#9a9b99] flex items-center justify-between -mt-1">
        <span>{{ selectedAssetNote }}</span>
        <span>Balance: {{ selectedBalance.toLocaleString(undefined, { maximumFractionDigits: 4 }) }} {{ asset }}</span>
      </div>

      <!-- USDC dead-end: cannot be acquired in-app (no faucet, no SDEX liquidity).
           Steer the user to XLM, the working path. -->
      <div
        v-if="usdcUnavailable"
        class="bg-[#202020] border border-[rgba(255,184,107,0.4)] rounded-md p-2 text-[10px] text-[#ffb86b] flex flex-col gap-2"
      >
        <span>
          You hold 0 of this SAC-backed testnet USDC (issuer GATALTGT…) and it
          <span class="font-semibold">can't be obtained in-app</span>: no permissionless
          faucet (minting needs the issuer admin), and testnet SDEX has only dust
          liquidity for it. It's also a different asset than the Circle USDC our swap
          produces. Use XLM for a working deposit, or acquire this USDC out-of-band first.
        </span>
        <button
          type="button"
          class="self-start px-2 py-1 rounded border border-[#d5ff2f] text-[#d5ff2f] hover:bg-[rgba(213,255,47,0.1)] transition"
          @click="asset = 'XLM'"
        >
          Use XLM instead
        </button>
      </div>

      <!-- USDC held: honest note about the 2-step first-time flow. -->
      <div
        v-else-if="asset === 'USDC'"
        class="bg-[#202020] border border-[rgba(255,184,107,0.4)] rounded-md p-2 text-[10px] text-[#ffb86b]"
      >
        This is the SAC-backed testnet USDC (issuer GATALTGT…), a
        <span class="font-semibold">different asset</span> than the Circle USDC our swap
        produces. First-time deposits sign a trustline (step 1/2), then the deposit (step 2/2).
      </div>

      <!-- AMOUNT -->
      <label class="flex flex-col gap-1">
        <span class="text-[11px] text-[#9a9b99]">Amount ({{ asset }})</span>
        <input
          v-model="amount"
          type="text"
          inputmode="decimal"
          placeholder="0.0"
          class="bg-[#202020] border border-[#383838] rounded-md px-3 py-2 text-sm text-[#e2e6e1] focus:border-[#d5ff2f] outline-none"
        />
      </label>

      <!-- ACTION -->
      <button
        type="button"
        class="w-full px-4 py-2 rounded-lg border border-[#d5ff2f] text-[#d5ff2f] text-xs font-semibold tracking-wide transition hover:bg-[rgba(213,255,47,0.1)] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
        :disabled="!canDeposit"
        @click="onDeposit"
      >
        <template v-if="status === 'building'">Preparing…</template>
        <template v-else-if="isBusy">{{ stepLabel }}…</template>
        <template v-else-if="!isConnected">Connect wallet first</template>
        <template v-else-if="!isActiveSignerConnected">Connect your active signer</template>
        <template v-else-if="usdcUnavailable">No testnet USDC — use XLM</template>
        <template v-else>Deposit {{ asset }} to Blend</template>
      </button>

      <p v-if="isBusy && stepLabel" class="text-[10px] text-[#d5ff2f] text-center">
        {{ stepLabel }} — confirm in your wallet.
      </p>

      <!-- SUCCESS -->
      <div
        v-if="status === 'success'"
        class="bg-[#202020] border border-[rgba(213,255,47,0.3)] rounded-md p-3 text-[11px] flex flex-col gap-1"
      >
        <span class="text-[#d5ff2f] font-semibold">Deposit confirmed</span>
        <span class="text-[#9a9b99] break-all font-mono">{{ txHash }}</span>
        <a
          :href="`https://stellar.expert/explorer/testnet/tx/${txHash}`"
          target="_blank"
          class="text-[#d5ff2f] hover:underline w-fit"
        >
          View on stellar.expert ↗
        </a>
        <button type="button" class="text-[#9a9b99] hover:text-[#d5ff2f] w-fit mt-1" @click="reset">
          New deposit
        </button>
      </div>

      <!-- ERROR -->
      <div
        v-else-if="status === 'error'"
        class="bg-[#202020] border border-[rgba(255,123,123,0.3)] rounded-md p-3 text-[11px] flex flex-col gap-1"
      >
        <span class="text-[#ff7b7b] font-semibold">Deposit failed</span>
        <span class="text-[#9a9b99] break-all">{{ errorMessage }}</span>
        <button type="button" class="text-[#9a9b99] hover:text-[#d5ff2f] w-fit mt-1" @click="reset">
          Try again
        </button>
      </div>
    </template>
  </div>
</template>
