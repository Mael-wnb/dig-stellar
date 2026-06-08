<script setup lang="ts">
import { useNetwork } from "../composables/useNetwork";

const { network, setNetwork } = useNetwork();
</script>

<template>
  <div
    class="flex items-center rounded-lg border border-[rgba(213,255,47,0.3)] bg-[#1a1f0e] p-[2px] text-[11px] font-semibold"
  >
    <button
      type="button"
      class="px-3 py-[5px] rounded-md tracking-wide transition"
      :class="
        network === 'mainnet'
          ? 'bg-[#373B26] text-[#d5ff2f] border border-[rgba(213,255,47,0.4)]'
          : 'text-[#9a9b99] hover:text-[#d5ff2f]'
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
          ? 'bg-[#373B26] text-[#d5ff2f] border border-[rgba(213,255,47,0.4)]'
          : 'text-[#9a9b99] hover:text-[#d5ff2f]'
      "
      @click="setNetwork('testnet')"
    >
      Testnet
    </button>
  </div>
</template>
