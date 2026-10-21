<script setup lang="ts">
// Lot EP (EP1): DEV-ONLY panel to exercise the wallet-ownership proof on
// testnet (challenge → kit.signMessage → verify). Mounted by App.vue only
// behind `import.meta.env.DEV`, so it is tree-shaken out of production builds
// (verified by grepping dist for 'signProof' / '__digProof'). No nav entry, no
// Earn view. It prints the raw API JSON so the wallet matrix (Freighter,
// xBull, Lobstr) can be recorded as evidence.
import { ref } from "vue";
import { signProof, useWalletSession } from "../../composables/useWalletSession";
import { useAppUser } from "../../composables/useAppUser";

const { connectedAddress, connectedProvider } = useWalletSession();
const { userId } = useAppUser();

const busy = ref(false);
const output = ref<string>("");

function formatError(err: unknown): string {
  if (err instanceof Error) {
    return err.stack ? `${err.message}\n${err.stack}` : err.message;
  }
  try {
    return JSON.stringify(err, Object.getOwnPropertyNames(err), 2);
  } catch {
    return String(err);
  }
}

async function run(bind: boolean) {
  output.value = "";
  if (!connectedAddress.value) {
    output.value = "Connect a wallet first.";
    return;
  }
  busy.value = true;
  try {
    const res = await signProof(connectedAddress.value, bind ? userId.value : null);
    output.value = JSON.stringify(
      {
        provider: connectedProvider.value,
        address: connectedAddress.value,
        userId: bind ? userId.value : null,
        challenge: res.challenge,
        signedMessage: res.signedMessage,
        result: res.result,
      },
      null,
      2,
    );
  } catch (err) {
    // Show the raw error: the Kit / Freighter sometimes throws a plain object,
    // which String() renders as "[object Object]".
    console.error("[dev-proof]", err);
    output.value = `ERROR: ${formatError(err)}`;
  } finally {
    busy.value = false;
  }
}

// Console entry point for the same flow: `await window.__digProof()` /
// `await window.__digProof(false)` (unbound).
(window as unknown as { __digProof?: (bind?: boolean) => Promise<string> }).__digProof = async (bind = true) => {
  await run(bind);
  return output.value;
};
</script>

<template>
  <div
    class="fixed bottom-4 right-4 z-[60] w-[420px] max-w-[calc(100vw-32px)] rounded-[12px] border p-3 text-[12px]"
    style="background: var(--dig-panel, #1b1b19); border-color: #3a3a36; color: var(--dig-text)"
  >
    <div class="mb-2 flex items-center justify-between">
      <strong>DEV · wallet ownership proof</strong>
      <span style="color: var(--dig-faint)">{{ connectedProvider ?? "no wallet" }}</span>
    </div>
    <div class="mb-2 break-all" style="color: var(--dig-faint)">
      {{ connectedAddress ?? "connect a wallet" }}<br />
      userId: {{ userId ?? "none" }}
    </div>
    <div class="flex gap-2">
      <button
        type="button"
        class="rounded-[8px] px-3 py-1"
        style="background: #2a2a27"
        :disabled="busy || !connectedAddress"
        @click="run(true)"
      >
        Prove (bind to userId)
      </button>
      <button
        type="button"
        class="rounded-[8px] px-3 py-1"
        style="background: #2a2a27"
        :disabled="busy || !connectedAddress"
        @click="run(false)"
      >
        Prove (unbound)
      </button>
    </div>
    <pre
      v-if="output"
      class="mt-2 max-h-[260px] overflow-auto whitespace-pre-wrap break-all rounded-[8px] p-2"
      style="background: #111; color: #cfe8cf"
    >{{ output }}</pre>
  </div>
</template>
