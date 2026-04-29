<script setup lang="ts">
import { computed, onMounted } from "vue";
import { connectWallet as connectWalletApi } from "../api/wallets";
import { useAppUser } from "../composables/useAppUser";
import { useWalletSession } from "../composables/useWalletSession";

const { userId, setUserId, restoreUser, clearUser } = useAppUser();

const {
  connectedAddress,
  shortConnectedAddress,
  isConnecting,
  connectWallet,
  disconnectWallet: disconnectWalletSession,
  restoreWalletSession,
} = useWalletSession();

const resolvedUser = computed(() => !!userId.value);

async function openWalletModal() {
  try {
    const sessionResult = await connectWallet();

    if (!sessionResult?.address) {
      throw new Error("No wallet address returned.");
    }

    const connectResponse = await connectWalletApi({
      chain: "stellar",
      address: sessionResult.address,
      label: "",
    });

    const backendUserId = connectResponse?.userId?.trim();

    if (!backendUserId) {
      throw new Error("Backend did not return userId.");
    }

    window.localStorage.setItem("dig_stellar_user_id", backendUserId);
    setUserId(backendUserId);

  } catch (error) {
    console.error("[header] Wallet connection failed", error);
  }
}

function disconnectWallet() {
  disconnectWalletSession();
  clearUser();
  window.localStorage.removeItem("dig_stellar_user_id");
}

onMounted(() => {
  restoreWalletSession();
  restoreUser();
});
</script>

<template>
  <div class="flex items-center justify-between">

    <!-- LEFT -->
    <div class="flex items-center gap-3">

      <!-- LOGO -->
      <div class="w-12 h-12 rounded-full bg-[#373B26] border border-accent flex items-center justify-center overflow-hidden">
        <img src="../assets/stellar.svg" alt="Stellar" class="w-6 h-6 object-contain" />
      </div>

      <!-- TITLE -->
      <div class="flex items-center gap-2">
        <h1 class="text-lg font-semibold text-white tracking-tight">
          Dig Stellar
        </h1>

        <span class="text-[10px] font-bold px-2 py-[2px] rounded border border-accent text-accent bg-[#373B26] tracking-widest">
          ALPHA
        </span>
      </div>

    </div>

    <!-- RIGHT -->
    <div class="flex flex-col items-end gap-2">

      <!-- WALLET -->
      <div>
        <button
          v-if="!connectedAddress"
          class="flex items-center gap-2 px-4 py-2 rounded-lg border border-accent text-accent text-xs font-semibold tracking-wide hover:bg-accent/10 transition"
          :disabled="isConnecting"
          @click="openWalletModal"
        >
          <span class="w-2 h-2 rounded-full bg-muted"></span>
          {{ isConnecting ? "Connecting…" : "Connect Wallet" }}
        </button>

        <div
          v-else
          class="flex items-center gap-2 px-4 py-2 rounded-lg border border-accent/30 bg-[#1a1f0e] cursor-pointer hover:border-red-400/50 transition"
          @click="disconnectWallet"
        >
          <span class="w-2 h-2 rounded-full bg-accent animate-pulse"></span>

          <span class="text-xs font-semibold text-accent font-mono">
            {{ shortConnectedAddress }}
          </span>

          <span class="text-[10px] text-muted">
            {{ resolvedUser ? "Linked" : "Session" }}
          </span>
        </div>
      </div>

      <!-- LINKS -->
      <div class="flex gap-2">
        <a
          href="https://github.com/Mael-wnb/dig-stellar"
          target="_blank"
          class="text-[11px] font-semibold text-accent bg-[#373B26] border border-accent/30 px-3 py-[3px] rounded hover:bg-accent/10 transition"
        >
          GitHub ↗
        </a>

        <a
          href="https://communityfund.stellar.org/submissions/recoebnaQgCsMeEjm"
          target="_blank"
          class="text-[11px] font-semibold text-accent bg-[#373B26] border border-accent/30 px-3 py-[3px] rounded hover:bg-accent/10 transition"
        >
          Grant ↗
        </a>
      </div>

    </div>

  </div>
</template>