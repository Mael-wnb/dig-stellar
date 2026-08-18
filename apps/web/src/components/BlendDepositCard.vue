<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import {
  buildBlendDeposit,
  buildBlendWithdraw,
  fetchBlendPosition,
  reportActionWitness,
  type BlendPositionResponse,
} from "../api/actions";
import { useWalletSession } from "../composables/useWalletSession";
import { useActiveSigner } from "../composables/useActiveSigner";
import { useAppUser } from "../composables/useAppUser";
import { useFaucet } from "../composables/useFaucet";
import FaucetClaimPanel from "./FaucetClaimPanel.vue";
import { useNetwork, toWalletNetwork } from "../composables/useNetwork";
import { blendPoolFor } from "../config/blendPools";
import { formatTokenAmountCompact, formatTokenAmountExact } from "../utils/format";
import {
  validateDepositXdr,
  validateWithdrawXdr,
  validateTrustlineXdr,
  type DepositIntent,
  type WithdrawIntent,
  type TrustlineIntent,
} from "../lib/validateDepositXdr";
import { friendlyContractError } from "../lib/blendContractErrors";

// UX-only mainnet gate (Lot A2): the Blend card has its OWN kill-switch, independent
// of the swap, and the withdraw (Lot A3) rides the SAME one — no new flag. The API
// kill-switch (ACTIONS_MAINNET_BLEND_ENABLED) is the real enforcement; when this VITE
// flag is false the mainnet card is blocked and the UI is exactly today's
// testnet-only behavior, for supply AND withdraw alike.
const MAINNET_BLEND_ENABLED =
  import.meta.env.VITE_ACTIONS_MAINNET_BLEND_ENABLED === "true";

// Lot A5: the pool this card acts on. ABSENT = the network's default pool, which
// keeps every pre-A5 entry point (the dashboard's generic "Deposit" CTA) working
// exactly as before.
const props = defineProps<{ poolSlug?: string }>();

const { connectedAddress, signTransaction } = useWalletSession();
const { activeSignerAddress } = useActiveSigner();
const { network } = useNetwork();
const { userId } = useAppUser();

// R3 (Lot R): upfront reward note (supply side only — withdraws never earn)
// + the post-deposit claim panel. Live-campaign-gated: never a stale promise.
const { campaign: faucetCampaign, campaignLiveFor, refreshCampaign } = useFaucet();
const faucetPromo = computed(() =>
  campaignLiveFor(network.value) ? faucetCampaign.value : null,
);
onMounted(() => void refreshCampaign());

// Per-pool, per-network Blend config (pool id, reserve SACs, classic USDC issuer,
// endpoints). This is the CLIENT-SIDE intent source for the validation gates — never
// the API. NULL when the requested slug is not in the vetted registry, in which case
// the form is not rendered at all (see `isVettedPool`): the alternative — falling back
// to some other pool — is the exact bug Lot A5 exists to fix, on a money path.
const config = computed(() => blendPoolFor(network.value, props.poolSlug));
const isVettedPool = computed(() => config.value !== null);

/** The pool config, or throw — used only on paths that must never run unvetted. */
function requirePool() {
  const cfg = config.value;
  if (!cfg) throw new Error("Refused: this pool is not in the vetted registry.");
  return cfg;
}

/** Supply (deposit) and withdraw are the two halves of the same position loop. */
type Mode = "supply" | "withdraw";
const mode = ref<Mode>("supply");

// XLM is the default/primary path: native, no trustline. On mainnet it's the simplest
// first deposit (no trustline prerequisite); on testnet it's funded by friendbot.
const asset = ref<"XLM" | "USDC">("XLM");
const amount = ref("");

const selectedAsset = computed(
  () => config.value?.assets.find((a) => a.code === asset.value),
);
const selectedAssetNote = computed(() => selectedAsset.value?.note ?? "");

// --- Balances (network's Horizon /accounts/:id) ---------------------------
const balances = ref<Record<string, string>>({});

async function loadBalances() {
  balances.value = {};
  const addr = connectedAddress.value;
  if (!addr || mainnetBlendBlocked.value || !config.value) return;
  try {
    const res = await fetch(`${config.value!.horizonUrl}/accounts/${addr}`);
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

// --- Supplied position (live, per network) --------------------------------
//
// Read from the API's live on-chain read (PoolV2.loadUser), NOT from the stored
// wallet positions: those are a mainnet-only periodic snapshot, so they are empty on
// testnet and can be minutes stale on mainnet. A withdraw's Max must equal what the
// pool holds right now, on the network being acted on. Informational only — the
// signing gate validates against the USER's amount + client config, never against this.
const position = ref<BlendPositionResponse | null>(null);
const positionLoading = ref(false);
const positionError = ref("");

async function loadPosition() {
  position.value = null;
  positionError.value = "";
  const addr = connectedAddress.value;
  if (!addr || mainnetBlendBlocked.value || !config.value) return;
  positionLoading.value = true;
  try {
    position.value = await fetchBlendPosition({
      address: addr,
      network: network.value,
      // Name the pool explicitly (from the CLIENT registry) — never let the API
      // pick, so the position shown is the one this card will act on.
      pool: config.value.slug,
    });
  } catch (err) {
    positionError.value = readApiError(err, "Could not read your Blend position.");
  } finally {
    positionLoading.value = false;
  }
}

// A5b: the position read is now loaded EAGERLY (not just on the withdraw pane) —
// it also carries the pool's live status, which gates the supply tab. It still
// needs a connected address; disconnected users can't submit anyway, and a frozen
// pool's supply attempt is additionally caught at simulation (#1206 → friendly copy).
onMounted(() => {
  loadBalances();
  loadPosition();
});
watch(connectedAddress, () => {
  loadBalances();
  loadPosition();
});
// On a network switch the endpoints + issuer + pool change — reset transient state,
// reload balances and the position/status from that network.
watch(network, () => {
  reset();
  amount.value = "";
  loadBalances();
  loadPosition();
});

// A5: keep the selected asset inside THIS pool's reserve set. Orbit has no USDC
// reserve, so arriving there with USDC selected must fall back to an asset the pool
// really has — never leave a selection the pool cannot serve.
watch(
  config,
  (cfg) => {
    if (!cfg) return;
    if (!cfg.assets.some((a) => a.code === asset.value)) {
      asset.value = cfg.assets[0]?.code ?? "XLM";
    }
  },
  { immediate: true },
);

// Display-only projections of the resolved pool (null-safe for the unvetted case).
const poolLabel = computed(() => config.value?.label ?? "");
const poolContractId = computed(() => config.value?.poolId ?? "");
const poolContractShort = computed(() =>
  poolContractId.value
    ? `${poolContractId.value.slice(0, 6)}…${poolContractId.value.slice(-4)}`
    : "",
);
const poolAssets = computed(() => config.value?.assets ?? []);

const xlmBalance = computed(() => parseFloat(balances.value["XLM"] ?? "0") || 0);
const usdcBalance = computed(
  () =>
    parseFloat(balances.value[`USDC:${config.value?.usdcClassic.issuer}`] ?? "0") || 0,
);
const selectedBalance = computed(() =>
  asset.value === "XLM" ? xlmBalance.value : usdcBalance.value,
);

/** Supplied collateral for the selected asset, as the exact string the API returned. */
const suppliedRaw = computed(
  () => position.value?.positions[asset.value]?.collateral ?? "0",
);
const supplied = computed(() => parseFloat(suppliedRaw.value) || 0);
/** True once a position read has completed and the selected asset holds nothing. */
const hasNoPosition = computed(
  () => !!position.value && !positionLoading.value && supplied.value <= 0,
);
/** Outstanding borrow in this pool — a withdraw may be limited by the health factor. */
const borrowed = computed(() => {
  const p = position.value?.positions;
  if (!p) return 0;
  return (
    (parseFloat(p.XLM.liabilities) || 0) + (parseFloat(p.USDC.liabilities) || 0)
  );
});

// --- Live pool status (A5b) ------------------------------------------------
//
// Read from the SAME position response (the API derives it from PoolV2.load, never
// a registry — status is governance-dynamic). Per the deployed pool contract,
// supply is blocked at status > 3 (Frozen/Setup) while withdrawals are NEVER
// status-blocked — so a frozen pool disables the supply tab but keeps withdraw.
const poolStatus = computed(() => position.value?.poolStatus ?? null);
const supplyBlocked = computed(() => poolStatus.value?.supplyBlocked === true);
/** Badge on the card for any non-Active pool (On-Ice shows too — borrow is blocked there). */
const statusBadge = computed(() => {
  const s = poolStatus.value;
  return s && s.label !== "Active" ? s.label : "";
});
const supplyBlockedCopy = computed(() => {
  const s = poolStatus.value;
  if (!s?.supplyBlocked) return "";
  const why =
    s.label === "Frozen"
      ? "is frozen by Blend governance"
      : s.label === "Setup"
        ? "is still in setup"
        : `reports pool status ${s.code}`;
  return `${poolLabel.value} ${why}. Deposits are disabled. Withdrawals remain available.`;
});

// A frozen pool can't take a deposit: if the status arrives while the supply pane
// is open, move to withdraw (the only action the pool still allows this app).
watch(supplyBlocked, (blocked) => {
  if (blocked && mode.value === "supply") setMode("withdraw");
});

// "pending" = confirmation polling TIMED OUT: the transaction was accepted by the
// network and may still be included — it has NOT failed, so it must never render
// failure copy. It gets its own block with the explorer link instead.
type ActionStatus =
  | "idle"
  | "building"
  | "step1"
  | "step2"
  | "success"
  | "pending"
  | "error";
const status = ref<ActionStatus>("idle");
const stepLabel = ref("");
const txHash = ref("");
const errorMessage = ref("");
// A5b: when errorMessage is a mapped one-liner for a contract error, the raw
// HostError text goes here — rendered behind a collapsible "details", never as
// the primary message.
const errorDetails = ref("");
// How a network-facing failure happened — the two are financially different (F4):
//   "onchain"  — INCLUDED in a ledger and failed atomically there: no funds moved,
//                only the network fee was consumed.
//   "rejected" — refused at SUBMISSION (sendTransaction ERROR, e.g. a fee bid under
//                surge pricing): never reached a ledger, NOTHING was charged.
// Null for pre-sign errors (build / validation / simulation), which never touch
// the network at all.
const failureKind = ref<"onchain" | "rejected" | null>(null);

const isWithdraw = computed(() => mode.value === "withdraw");
const isConnected = computed(() => !!connectedAddress.value);
const isMainnet = computed(() => network.value === "mainnet");
// Mainnet without the UX flag = today's testnet-only behavior (blocked). This — not
// raw isMainnet — gates the card, so flipping the flag reveals the (still API-gated)
// mainnet supply AND withdraw paths in one place.
const mainnetBlendBlocked = computed(() => isMainnet.value && !MAINNET_BLEND_ENABLED);
const explorerNetwork = computed(() => config.value?.explorer ?? "public");

/**
 * The testnet SAC-backed USDC (issuer GATALTGT…) cannot be acquired in-app (no
 * permissionless faucet, only dust SDEX liquidity), so a USDC deposit with 0 balance
 * is a dead end there — steer to XLM. On MAINNET the USDC reserve is Circle USDC (a
 * real, acquirable asset with a proper trustline flow), so this dead-end never applies.
 * It is a SUPPLY-side concern only: withdrawing USDC needs a position, not a balance.
 */
const usdcUnavailable = computed(
  () =>
    !isWithdraw.value &&
    !config.value?.realFunds &&
    asset.value === "USDC" &&
    usdcBalance.value <= 0,
);

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

const parsedAmount = computed(() => parseFloat(amount.value));

/**
 * Never build a doomed transaction: a withdraw above the supplied position would be
 * clamped by the pool (or fail simulation) rather than do what the user asked.
 * Compared against the live position read, so it also blocks the 0-position case.
 */
const exceedsPosition = computed(
  () =>
    isWithdraw.value &&
    !!position.value &&
    parsedAmount.value > 0 &&
    parsedAmount.value > supplied.value,
);

const canSubmit = computed(
  () =>
    !mainnetBlendBlocked.value &&
    isConnected.value &&
    isActiveSignerConnected.value &&
    !isBusy.value &&
    !usdcUnavailable.value &&
    // A5b: never build a supply the pool's live status would reject (#1206).
    (isWithdraw.value || !supplyBlocked.value) &&
    parsedAmount.value > 0 &&
    (!isWithdraw.value || (!positionLoading.value && !hasNoPosition.value && !exceedsPosition.value)),
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
 * SECURITY GATE — validate a returned XDR against an intent DERIVED FROM USER INPUT +
 * client-side config (config/blendPools.ts), BEFORE the wallet is invoked. Wired
 * before EVERY signing prompt (trustline tx, deposit tx AND withdraw tx). Throws
 * (fail closed) with every violation on any mismatch, so nothing wrong ever reaches
 * the wallet. The deposit and withdraw gates pin DIFFERENT Blend request types, so
 * neither can ever accept the other's transaction.
 */
function blendIntent(passphrase: string): DepositIntent & WithdrawIntent {
  const cfg = requirePool();
  const sac = selectedAsset.value?.sac;
  const decimals = selectedAsset.value?.decimals;
  if (!sac || decimals === undefined || !connectedAddress.value) {
    throw new Error("Refused to sign: missing intent.");
  }
  return {
    sourceAccount: connectedAddress.value,
    poolId: cfg.poolId,
    assetSac: sac,
    amount: amount.value,
    decimals,
    networkPassphrase: passphrase,
  };
}

function assertDepositXdr(xdr: string, passphrase: string): void {
  const check = validateDepositXdr(xdr, blendIntent(passphrase));
  if (!check.ok) {
    throw new Error(
      `Refused to sign. The deposit XDR did not match your request: ${check.violations.join("; ")}`,
    );
  }
}

function assertWithdrawXdr(xdr: string, passphrase: string): void {
  const check = validateWithdrawXdr(xdr, blendIntent(passphrase));
  if (!check.ok) {
    throw new Error(
      `Refused to sign. The withdraw XDR did not match your request: ${check.violations.join("; ")}`,
    );
  }
}

function assertTrustlineXdr(xdr: string, passphrase: string): void {
  if (!connectedAddress.value) {
    throw new Error("Refused to sign: missing trustline intent.");
  }
  const intent: TrustlineIntent = {
    sourceAccount: connectedAddress.value,
    asset: requirePool().usdcClassic,
    networkPassphrase: passphrase,
  };
  const check = validateTrustlineXdr(xdr, intent);
  if (!check.ok) {
    throw new Error(
      `Refused to sign. The trustline XDR did not match your request: ${check.violations.join("; ")}`,
    );
  }
}

async function rpcCall(method: string, params: unknown): Promise<any> {
  const res = await fetch(requirePool().rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || "RPC error");
  return json.result ?? {};
}

/**
 * Confirmation polling ran out while the transaction was still pending. NOT a
 * failure: the tx was accepted and may yet be included — the caller must render
 * the "still pending" state (with the explorer link), never failure copy.
 */
class TxPendingTimeout extends Error {
  readonly hash: string;
  constructor(hash: string) {
    super(`Timed out waiting for confirmation (${hash}).`);
    this.hash = hash;
  }
}

/** Sends a signed XDR and, if PENDING, polls getTransaction until it settles. */
async function submitAndConfirm(signedXdr: string): Promise<string> {
  const sent = await rpcCall("sendTransaction", { transaction: signedXdr });
  if (sent.status === "ERROR") {
    // Rejected at SUBMISSION — never reached a ledger, nothing was charged.
    // Distinct from an included-but-failed tx, which does consume its fee.
    failureKind.value = "rejected";
    throw new Error(
      sent.errorResultXdr
        ? `The network rejected the transaction (result XDR: ${sent.errorResultXdr}).`
        : "The network rejected the transaction.",
    );
  }
  const hash: string = sent.hash;
  if (sent.status === "SUCCESS") return hash;

  // Poll (Soroban settles a ledger or two later).
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const got = await rpcCall("getTransaction", { hash });
    if (got.status === "SUCCESS") return hash;
    if (got.status === "FAILED") {
      failureKind.value = "onchain";
      throw new Error(`Transaction failed on-chain (${hash}).`);
    }
  }
  // Still pending after ~24s — not a failure (see TxPendingTimeout).
  throw new TxPendingTimeout(hash);
}

/** Shared preflight for both actions: gating, signer check, state reset. */
function startAction(): { address: string; passphrase: string } | null {
  if (mainnetBlendBlocked.value) return null;
  if (signerBlockReason.value) {
    errorMessage.value = signerBlockReason.value;
    status.value = "error";
    return null;
  }
  if (!canSubmit.value || !connectedAddress.value) return null;

  status.value = "building";
  txHash.value = "";
  errorMessage.value = "";
  errorDetails.value = "";
  stepLabel.value = "";
  failureKind.value = null;

  return {
    address: connectedAddress.value,
    passphrase: toWalletNetwork(network.value),
  };
}

async function onDeposit() {
  const started = startAction();
  if (!started) return;
  const { address, passphrase } = started;

  try {
    let built = await buildBlendDeposit({
      address,
      asset: asset.value,
      amount: amount.value,
      network: network.value,
      pool: requirePool().slug,
    });

    // Step 1/2 — the deposit CANNOT be simulated until the classic USDC trustline
    // exists (the SAC transfer would trap with Contract #13). So when the backend
    // reports one is required, it returns ONLY the ChangeTrust: validate it, sign it,
    // confirm it ON-CHAIN, then re-request the build — which can now simulate.
    const twoStep = built.trustlineRequired === true;
    if (twoStep) {
      if (!built.changetrustXdr) {
        throw new Error("Trustline required but no ChangeTrust was returned.");
      }
      status.value = "step1";
      stepLabel.value = "1/2 Approve trustline";
      assertTrustlineXdr(built.changetrustXdr, passphrase);
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
        pool: requirePool().slug,
      });
      if (built.trustlineRequired) {
        throw new Error(
          "Trustline not visible yet. Give it a few seconds and try again.",
        );
      }
    }

    if (!built.simulation.success || !built.xdr) {
      showSimulationError(
        built.simulation.error,
        "Deposit simulation failed. Ensure the account holds this asset.",
      );
      return;
    }

    // Step (2/2 or 1/1) — the Soroban deposit itself.
    status.value = "step2";
    stepLabel.value = twoStep ? "2/2 Sign deposit" : "Sign deposit";
    assertDepositXdr(built.xdr, passphrase);
    const dep = await signTransaction(built.xdr, passphrase);
    const hash = await submitAndConfirm(dep.signedTxXdr);

    txHash.value = hash;
    status.value = "success";
    // R1 (Lot R): report the executed deposit for server-side verification.
    // Fire-and-forget — never blocks or fails the deposit flow.
    reportTxWitness(hash);
    loadBalances(); // reflect the new balances
    if (position.value) loadPosition(); // and the new supplied position
  } catch (err: unknown) {
    if (err instanceof TxPendingTimeout) {
      // Still pending ≠ failed: surface the hash + explorer link, claim nothing.
      // The witness is still reported: it verifies server-side against Horizon,
      // so it simply lands once (if) the tx settles within the retry window.
      txHash.value = err.hash;
      status.value = "pending";
      reportTxWitness(err.hash);
      return;
    }
    errorMessage.value = readApiError(err, "Deposit failed.");
    status.value = "error";
  }
}

/**
 * Reports an executed tx for server-side witnessing (Lot R). Deposits feed
 * faucet eligibility; withdraws are witnessed too (founder amendment
 * 2026-08-17) as KPI-ledger evidence only — the server decides the kind and
 * the faucet never qualifies a withdraw.
 */
function reportTxWitness(hash: string): void {
  reportActionWitness({
    txHash: hash,
    network: network.value,
    userId: userId.value ?? undefined,
  });
}

/**
 * Withdraw supplied collateral back to the user's own wallet. Single-step: no
 * trustline gate (the asset was supplied FROM this account, so its trustline already
 * exists) and no cap (these are the user's own funds coming back out).
 */
async function onWithdraw() {
  const started = startAction();
  if (!started) return;
  const { address, passphrase } = started;

  try {
    const built = await buildBlendWithdraw({
      address,
      asset: asset.value,
      amount: amount.value,
      network: network.value,
      pool: requirePool().slug,
    });

    if (!built.simulation.success || !built.xdr) {
      showSimulationError(
        built.simulation.error,
        "Withdraw simulation failed. Your position may not cover this amount.",
      );
      return;
    }

    status.value = "step2";
    stepLabel.value = "Sign withdraw";
    assertWithdrawXdr(built.xdr, passphrase);
    const wd = await signTransaction(built.xdr, passphrase);
    const hash = await submitAndConfirm(wd.signedTxXdr);

    txHash.value = hash;
    status.value = "success";
    // Founder amendment 2026-08-17: witness withdraws too (KPI ledger only —
    // never faucet-qualifying, the server enforces that by kind).
    reportTxWitness(hash);
    loadBalances(); // the withdrawn funds are back in the wallet
    loadPosition(); // and the supplied position has shrunk
  } catch (err: unknown) {
    if (err instanceof TxPendingTimeout) {
      txHash.value = err.hash;
      status.value = "pending";
      reportTxWitness(err.hash);
      return;
    }
    errorMessage.value = readApiError(err, "Withdraw failed.");
    status.value = "error";
  }
}

function onSubmit() {
  return isWithdraw.value ? onWithdraw() : onDeposit();
}

function setMode(next: Mode) {
  if (mode.value === next) return;
  mode.value = next;
  reset();
  amount.value = "";
  // Load the position on first entry to the withdraw pane (and keep it fresh after).
  if (next === "withdraw") loadPosition();
}

/** Max = the full supplied position, as the exact string the chain reports. */
function setMax() {
  if (supplied.value > 0) amount.value = suppliedRaw.value;
}

function reset() {
  status.value = "idle";
  txHash.value = "";
  errorMessage.value = "";
  errorDetails.value = "";
  stepLabel.value = "";
  failureKind.value = null;
}

/**
 * Simulation failed — nothing signable was produced. Map a known contract error
 * (e.g. #1206 pool status) to its one-liner and park the raw HostError behind
 * "details"; a non-contract error keeps the raw text as before (it is usually a
 * short, already-readable message like the trustline short-circuit).
 */
function showSimulationError(rawError: string | undefined, fallback: string) {
  const friendly = friendlyContractError(rawError);
  if (friendly) {
    errorMessage.value = friendly.message;
    errorDetails.value = friendly.raw;
  } else {
    errorMessage.value = rawError || fallback;
  }
  status.value = "error";
}
</script>

<template>
  <div class="bg-[#2A2A2A] border border-[#383838] rounded-lg p-4 flex flex-col gap-3">
    <div class="flex items-center justify-between">
      <span class="text-xs font-semibold text-[#e2e6e1] flex items-center gap-2">
        Blend
        <!-- A5b: live pool status badge — shown for any non-Active pool. -->
        <span
          v-if="statusBadge"
          class="text-[9px] font-bold uppercase tracking-wider px-[5px] py-[1px] rounded-[6px]"
          :class="
            supplyBlocked
              ? 'text-[#ff7b7b] bg-[rgba(255,123,123,0.12)]'
              : 'text-[#ffb86b] bg-[rgba(255,184,107,0.12)]'
          "
          :title="`Live on-chain pool status: ${poolStatus?.code}`"
        >{{ statusBadge }}</span>
      </span>
      <span class="text-[10px] text-[#9a9b99] uppercase tracking-widest">{{ network }}</span>
    </div>

    <div
      v-if="mainnetBlendBlocked"
      class="bg-[#202020] border border-[rgba(213,255,47,0.3)] rounded-md p-3 text-[11px] text-[#9a9b99]"
    >
      Blend supply &amp; withdraw are <span class="text-[#d5ff2f] font-semibold">Testnet-only</span> in this beta.
    </div>

    <!-- (R3c fix) The faucet promo note used to sit HERE, between this card's
         v-if="mainnetBlendBlocked" and v-else-if="!isVettedPool" — which broke
         the chain and made the whole form's v-else unreachable whenever the
         campaign was live (prod bug 2026-08-17). It now lives INSIDE the form
         block below. NEVER insert an element into this if/else-if/else chain. -->

    <!-- A5: the requested pool is not in the vetted client registry (e.g. the
         indexer lists a pool the registry has not vetted yet). Refuse to render any
         form — an unvetted pool id must never reach the signing gate — and point at
         the protocol's own UI, which can always manage the position. -->
    <div
      v-else-if="!isVettedPool"
      class="bg-[#202020] border border-[rgba(213,255,47,0.3)] rounded-md p-3 text-[11px] text-[#9a9b99] flex flex-col gap-1"
    >
      <span>
        In-app supply &amp; withdraw are not available for this pool yet.
      </span>
      <span>
        Your funds are unaffected: manage this pool directly on
        <a
          href="https://mainnet.blend.capital"
          target="_blank"
          class="text-[#d5ff2f] hover:underline"
        >blend.capital</a>
        with this same wallet.
      </span>
    </div>

    <template v-else>
      <!-- FAUCET PROMO (Lot R, R3/R3c): the offer is seen BEFORE the action.
           Supply side only — withdraws never earn. INSIDE the form block so it
           can never gate the form itself. Disappears with the campaign. -->
      <div
        v-if="faucetPromo && !isWithdraw"
        class="bg-[#202020] border border-[rgba(213,255,47,0.35)] rounded-md p-3 text-[11px] text-[#9a9b99]"
      >
        <span class="text-[#d5ff2f] font-semibold">Earn {{ faucetPromo.rewardXlm }} XLM</span>
        with your first Blend supply (≥ {{ faucetPromo.minNotionalXlm }} XLM).
        {{ faucetPromo.remainingClaims }} claims left
      </div>

      <!-- MODE — supply ↔ withdraw, the two halves of the same position.
           A5b: the supply tab is DISABLED when the pool's live status blocks
           deposits (contract would reject with #1206); withdraw stays available —
           the contract never status-blocks an exit. -->
      <div class="flex gap-2">
        <button
          v-for="m in (['supply', 'withdraw'] as const)"
          :key="m"
          type="button"
          class="flex-1 px-3 py-2 rounded-md border text-xs font-semibold capitalize transition disabled:opacity-40 disabled:cursor-not-allowed"
          :class="
            mode === m
              ? 'border-[#d5ff2f] text-[#d5ff2f] bg-[rgba(213,255,47,0.08)]'
              : 'border-[#383838] text-[#9a9b99] hover:border-[#555]'
          "
          :disabled="m === 'supply' && supplyBlocked"
          :title="m === 'supply' && supplyBlocked ? supplyBlockedCopy : undefined"
          @click="setMode(m)"
        >
          {{ m }}
        </button>
      </div>

      <!-- A5b: honest copy for a status-blocked supply (e.g. Orbit, frozen). -->
      <div
        v-if="supplyBlocked"
        class="bg-[#202020] border border-[rgba(255,123,123,0.3)] rounded-md p-3 text-[11px] text-[#9a9b99]"
      >
        {{ supplyBlockedCopy }}
      </div>

      <!-- MAINNET WARNING (live: real funds) -->
      <div
        v-if="isMainnet"
        class="bg-[#202020] border border-[rgba(255,184,107,0.5)] rounded-md p-3 text-[11px] text-[#ffb86b] flex flex-col gap-1"
      >
        <span v-if="!isWithdraw">
          <span class="font-semibold">Mainnet:</span> this deposit supplies real funds to
          Blend as collateral. A per-transaction cap applies during the launch period.
        </span>
        <span v-else>
          <span class="font-semibold">Mainnet:</span> this returns your supplied funds
          from Blend to this wallet.
        </span>
        <span class="text-[#9a9b99]">
          Non-custodial: your position is always manageable directly on
          <a href="https://mainnet.blend.capital" target="_blank" class="text-[#d5ff2f] hover:underline">blend.capital</a>
          with this same wallet.
        </span>
      </div>

      <div
        v-if="isConnected && signerBlockReason"
        class="bg-[#202020] border border-[rgba(255,184,107,0.4)] rounded-md p-3 text-[11px] text-[#ffb86b]"
      >
        {{ signerBlockReason }}
      </div>

      <div class="text-[11px] text-[#9a9b99] flex items-center justify-between">
        <!-- Names the pool this card WILL ACT ON — always the modal's pool (A5). -->
        <span>{{ poolLabel }}</span>
        <a
          :href="`https://stellar.expert/explorer/${explorerNetwork}/contract/${poolContractId}`"
          target="_blank"
          class="font-mono hover:text-[#d5ff2f]"
        >{{ poolContractShort }}</a>
      </div>

      <!-- ASSET (XLM is the recommended, zero-prerequisite path) -->
      <div class="flex gap-2">
        <button
          v-for="a in poolAssets"
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
            v-if="a.code === 'XLM' && !isWithdraw"
            class="text-[8px] uppercase tracking-wider text-[#d5ff2f] border border-[rgba(213,255,47,0.4)] rounded px-1"
          >
            Recommended
          </span>
        </button>
      </div>

      <!-- SUPPLY: wallet balance + asset note -->
      <div
        v-if="!isWithdraw"
        class="text-[11px] text-[#9a9b99] flex items-center justify-between -mt-1"
      >
        <span>{{ selectedAssetNote }}</span>
        <span :title="`${formatTokenAmountExact(selectedBalance)} ${asset}`"
          >Balance: {{ formatTokenAmountCompact(selectedBalance) }} {{ asset }}</span
        >
      </div>

      <!-- WITHDRAW: the live supplied position (what Max draws on) -->
      <div v-else class="text-[11px] text-[#9a9b99] flex items-center justify-between -mt-1">
        <span>Supplied to this pool</span>
        <span v-if="positionLoading">reading position…</span>
        <span v-else-if="positionError" class="text-[#ffb86b]">unavailable</span>
        <span v-else class="text-[#e2e6e1]" :title="`${formatTokenAmountExact(supplied)} ${asset}`">
          {{ formatTokenAmountCompact(supplied) }} {{ asset }}
        </span>
      </div>

      <div
        v-if="isWithdraw && positionError"
        class="bg-[#202020] border border-[rgba(255,184,107,0.4)] rounded-md p-2 text-[10px] text-[#ffb86b] flex flex-col gap-2"
      >
        <span>{{ positionError }}</span>
        <button
          type="button"
          class="self-start px-2 py-1 rounded border border-[#d5ff2f] text-[#d5ff2f] hover:bg-[rgba(213,255,47,0.1)] transition"
          @click="loadPosition"
        >
          Retry
        </button>
      </div>

      <!-- WITHDRAW with nothing supplied: say so plainly, never build a doomed tx. -->
      <div
        v-else-if="isWithdraw && hasNoPosition"
        class="bg-[#202020] border border-[rgba(255,184,107,0.4)] rounded-md p-2 text-[10px] text-[#ffb86b] flex flex-col gap-2"
      >
        <span>
          You have no {{ asset }} supplied to this pool, so there is nothing to withdraw.
        </span>
        <button
          type="button"
          class="self-start px-2 py-1 rounded border border-[#d5ff2f] text-[#d5ff2f] hover:bg-[rgba(213,255,47,0.1)] transition"
          @click="setMode('supply')"
        >
          Supply {{ asset }} instead
        </button>
      </div>

      <!-- WITHDRAW with an open borrow: withdrawing may be limited by the health factor. -->
      <div
        v-else-if="isWithdraw && borrowed > 0"
        class="bg-[#202020] border border-[rgba(255,184,107,0.4)] rounded-md p-2 text-[10px] text-[#ffb86b]"
      >
        You have an open borrow in this pool. Blend only lets you withdraw collateral
        that keeps your position healthy: a withdraw that would push it under fails
        before anything is signed.
      </div>

      <!-- TESTNET USDC dead-end (supply only): cannot be acquired in-app. -->
      <div
        v-if="usdcUnavailable"
        class="bg-[#202020] border border-[rgba(255,184,107,0.4)] rounded-md p-2 text-[10px] text-[#ffb86b] flex flex-col gap-2"
      >
        <span>
          You hold 0 of this SAC-backed testnet USDC (issuer GATALTGT…) and it
          <span class="font-semibold">can't be obtained in-app</span>: no permissionless
          faucet (minting needs the issuer admin), and testnet SDEX has only dust
          liquidity for it. Use XLM for a working deposit, or acquire this USDC out-of-band first.
        </span>
        <button
          type="button"
          class="self-start px-2 py-1 rounded border border-[#d5ff2f] text-[#d5ff2f] hover:bg-[rgba(213,255,47,0.1)] transition"
          @click="asset = 'XLM'"
        >
          Use XLM instead
        </button>
      </div>

      <!-- USDC supply: honest note about the 2-step first-time flow (differs by network). -->
      <div
        v-else-if="!isWithdraw && asset === 'USDC'"
        class="bg-[#202020] border border-[rgba(255,184,107,0.4)] rounded-md p-2 text-[10px] text-[#ffb86b]"
      >
        <template v-if="isMainnet">
          Circle USDC. A first-time deposit signs a trustline (step 1/2), then the deposit
          (step 2/2). Both steps are validated against this pool before your wallet is asked to sign.
        </template>
        <template v-else>
          This is the SAC-backed testnet USDC (issuer GATALTGT…), a
          <span class="font-semibold">different asset</span> than the Circle USDC our swap
          produces. First-time deposits sign a trustline (step 1/2), then the deposit (step 2/2).
        </template>
      </div>

      <!-- AMOUNT -->
      <label class="flex flex-col gap-1">
        <span class="text-[11px] text-[#9a9b99] flex items-center justify-between">
          <span>Amount ({{ asset }})</span>
          <button
            v-if="isWithdraw && supplied > 0"
            type="button"
            class="text-[10px] uppercase tracking-wider text-[#d5ff2f] border border-[rgba(213,255,47,0.4)] rounded px-1.5 py-0.5 hover:bg-[rgba(213,255,47,0.1)] transition"
            @click="setMax"
          >
            Max
          </button>
        </span>
        <input
          v-model="amount"
          type="text"
          inputmode="decimal"
          placeholder="0.0"
          class="bg-[#202020] border border-[#383838] rounded-md px-3 py-2 text-sm text-[#e2e6e1] focus:border-[#d5ff2f] outline-none"
        />
      </label>

      <p v-if="exceedsPosition" class="text-[10px] text-[#ffb86b] -mt-1">
        You have {{ formatTokenAmountCompact(supplied) }}
        {{ asset }} supplied. Use Max to withdraw all of it.
      </p>

      <!-- ACTION -->
      <button
        type="button"
        class="w-full px-4 py-2 rounded-lg border border-[#d5ff2f] text-[#d5ff2f] text-xs font-semibold tracking-wide transition hover:bg-[rgba(213,255,47,0.1)] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
        :disabled="!canSubmit"
        @click="onSubmit"
      >
        <template v-if="status === 'building'">Preparing…</template>
        <template v-else-if="isBusy">{{ stepLabel }}…</template>
        <template v-else-if="!isConnected">Connect wallet first</template>
        <template v-else-if="!isActiveSignerConnected">Connect your active signer</template>
        <template v-else-if="usdcUnavailable">No testnet USDC, use XLM</template>
        <template v-else-if="isWithdraw && positionLoading">Reading position…</template>
        <template v-else-if="isWithdraw && hasNoPosition">Nothing to withdraw</template>
        <template v-else-if="isWithdraw">Withdraw {{ asset }} from Blend</template>
        <template v-else-if="supplyBlocked">Deposits disabled (pool {{ statusBadge.toLowerCase() }})</template>
        <template v-else>Deposit {{ asset }} to Blend</template>
      </button>

      <p v-if="isBusy && stepLabel" class="text-[10px] text-[#d5ff2f] text-center">
        {{ stepLabel }}: confirm in your wallet.
      </p>

      <!-- SUCCESS -->
      <div
        v-if="status === 'success'"
        class="bg-[#202020] border border-[rgba(213,255,47,0.3)] rounded-md p-3 text-[11px] flex flex-col gap-1"
      >
        <span class="text-[#d5ff2f] font-semibold">
          {{ isWithdraw ? "Withdraw confirmed" : "Deposit confirmed" }}
        </span>
        <a
          :href="`https://stellar.expert/explorer/${explorerNetwork}/tx/${txHash}`"
          target="_blank"
          rel="noopener"
          class="text-[#9a9b99] break-all font-mono hover:text-[#d5ff2f] w-fit"
          title="View transaction on stellar.expert"
        >{{ txHash }}</a>
        <a
          :href="`https://stellar.expert/explorer/${explorerNetwork}/tx/${txHash}`"
          target="_blank"
          class="text-[#d5ff2f] hover:underline w-fit"
        >
          View on stellar.expert ↗
        </a>
        <span class="text-[#9a9b99]">
          Your Blend position + health factor update in the portfolio above on its next
          wallet refresh<span v-if="isMainnet">, and on blend.capital with this same wallet</span>.
        </span>
        <button type="button" class="text-[#9a9b99] hover:text-[#d5ff2f] w-fit mt-1" @click="reset">
          {{ isWithdraw ? "New withdraw" : "New deposit" }}
        </button>

        <!-- FAUCET CLAIM (Lot R, R3/R3c): deposits only — withdraws never earn.
             INSIDE the success block (never between v-if/v-else-if siblings —
             that broke the chain in prod, 2026-08-17). Renders nothing while
             the campaign is dark. -->
        <FaucetClaimPanel
          v-if="!isWithdraw && txHash && connectedAddress"
          :key="txHash"
          :wallet="connectedAddress"
          :network="network"
          :tx-hash="txHash"
          family="blend-supply"
        />
      </div>

      <!-- STILL PENDING — confirmation polling timed out. Not a failure: the tx was
           accepted and may still be included, so no failure copy is allowed here. -->
      <div
        v-else-if="status === 'pending'"
        class="bg-[#202020] border border-[rgba(255,184,107,0.4)] rounded-md p-3 text-[11px] flex flex-col gap-1"
      >
        <span class="text-[#ffb86b] font-semibold">
          {{ isWithdraw ? "Withdraw still pending" : "Deposit still pending" }}
        </span>
        <span class="text-[#9a9b99]">
          Confirmation is taking longer than usual. The transaction was accepted by the
          network and has <span class="font-semibold">not</span> failed. Check its
          status on the explorer before retrying.
        </span>
        <a
          :href="`https://stellar.expert/explorer/${explorerNetwork}/tx/${txHash}`"
          target="_blank"
          rel="noopener"
          class="text-[#d5ff2f] hover:underline w-fit"
        >
          View on stellar.expert ↗
        </a>
        <button type="button" class="text-[#9a9b99] hover:text-[#d5ff2f] w-fit mt-1" @click="reset">
          Done
        </button>

        <!-- FAUCET CLAIM on pending too: the witness verifies server-side once
             the tx settles, and the panel's polling absorbs the wait. Inside
             the block for the same chain-integrity reason as above. -->
        <FaucetClaimPanel
          v-if="!isWithdraw && txHash && connectedAddress"
          :key="txHash"
          :wallet="connectedAddress"
          :network="network"
          :tx-hash="txHash"
          family="blend-supply"
        />
      </div>

      <!-- ERROR -->
      <div
        v-else-if="status === 'error'"
        class="bg-[#202020] border border-[rgba(255,123,123,0.3)] rounded-md p-3 text-[11px] flex flex-col gap-1"
      >
        <span class="text-[#ff7b7b] font-semibold">
          {{ isWithdraw ? "Withdraw failed" : "Deposit failed" }}
        </span>
        <!-- Included in a ledger, failed there: atomic, only the fee was consumed. -->
        <span
          v-if="failureKind === 'onchain'"
          class="text-[#9a9b99]"
        >
          The transaction failed atomically on-chain, so no funds were moved. Only the
          network fee was consumed.
        </span>
        <!-- Rejected at submission: never reached a ledger, nothing was charged. -->
        <span
          v-else-if="failureKind === 'rejected'"
          class="text-[#9a9b99]"
        >
          The transaction was rejected before inclusion. It never reached a ledger, so
          nothing was charged and no funds moved.
        </span>
        <span class="text-[#9a9b99] break-all">{{ errorMessage }}</span>
        <!-- A5b: the raw contract/host error stays available, but never as the
             primary message — behind a disclosure, for support and power users. -->
        <details v-if="errorDetails" class="text-[#9a9b99]">
          <summary class="cursor-pointer hover:text-[#d5ff2f] w-fit">details</summary>
          <pre
            class="mt-1 p-2 bg-[#161616] rounded whitespace-pre-wrap break-all text-[10px] font-mono max-h-48 overflow-y-auto"
          >{{ errorDetails }}</pre>
        </details>
        <button type="button" class="text-[#9a9b99] hover:text-[#d5ff2f] w-fit mt-1" @click="reset">
          Try again
        </button>
      </div>
    </template>
  </div>
</template>
