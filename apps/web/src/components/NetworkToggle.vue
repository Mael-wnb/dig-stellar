<script setup lang="ts">
import { useNetwork } from "../composables/useNetwork";

const { network, setNetwork } = useNetwork();
</script>

<template>
  <div
    class="flex items-center rounded-lg border border-accent/30 bg-[#1a1f0e] p-[2px] text-[11px] font-semibold"
  >
    <button
      type="button"
      class="px-3 py-[5px] rounded-md tracking-wide transition"
      :class="
        network === 'mainnet'
          ? 'bg-[#373B26] text-accent border border-accent/40'
          : 'text-muted hover:text-accent'
      "
      @click="setNetwork('mainnet')"
    >
      Mainnet
    </button>

    <button
      type="button"
      class="px-3 py-[5px] rounded-md tracking-wide transition"
      :class="
        network === 'testnet'
          ? 'bg-[#373B26] text-accent border border-accent/40'
          : 'text-muted hover:text-accent'
      "
      @click="setNetwork('testnet')"
    >
      Testnet
    </button>
  </div>
</template>
