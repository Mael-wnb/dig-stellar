<script setup lang="ts">
const protocols = [
  { name: "Blend V2", color: "#24A338", value: "$45.2M" },
  { name: "Aquarius", color: "#5B85FF", value: "$36.3M" },
  { name: "Soroswap", color: "#8866DD", value: "$4.8M" },
  { name: "DeFindex", color: "#DEC9F4", value: "$2.1M" },
];

const periods = ["1M", "6M", "1Y"];
const activePeriod = "6M";

const toggleOptions = ["TVL", "VOL"];
const activeToggle = "TVL";
</script>

<template>
  <section class="flex flex-col gap-3">
    <!-- SECTION HEADER -->
    <div class="flex items-center gap-3">
      <span class="text-[16px] text-[#D5FF2F] font-normal whitespace-nowrap">
        Stellar Metrics
      </span>

      <div class="flex-1 h-px bg-[#7D922A]" />

      <span
        class="text-[14px] text-[#838583] font-light whitespace-nowrap"
        style="
          font-family:
            IBM Plex Sans,
            sans-serif;
        "
      >
        TVL · Protocol comparison
      </span>
    </div>

    <!-- CARDS -->
    <div class="grid grid-cols-2 gap-6 max-sm:grid-cols-1">
      <!-- LEFT CARD: TVL Chart -->
      <div
        class="bg-[#2A2A2A] border border-[#383838] rounded-[12px] p-4 flex flex-col gap-4 relative overflow-hidden"
      >
        <!-- Header -->
        <div class="flex items-center justify-between">
          <span class="text-[13px] font-semibold text-[#E2E6E1]"
            >TVL — Stellar DeFi Protocols</span
          >

          <div class="flex items-center gap-1">
            <button
              v-for="p in periods"
              :key="p"
              class="px-2 py-[3px] text-[11px] font-semibold rounded-[5px] transition"
              :class="
                p === activePeriod
                  ? 'bg-[#373B26] border border-[#7D922A] text-[#D5FF2F]'
                  : 'text-[#717270] border border-transparent hover:text-[#9a9b99]'
              "
            >
              {{ p }}
            </button>
          </div>
        </div>

        <!-- Chart placeholder -->
        <div class="flex-1 min-h-[140px] flex items-center justify-center">
          <div class="w-full h-px bg-[#383838]" />
        </div>

        <!-- Legend -->
        <div class="flex items-center gap-4">
          <div
            v-for="protocol in protocols"
            :key="protocol.name"
            class="flex items-center gap-[6px]"
          >
            <span
              class="w-[8px] h-[8px] rounded-full shrink-0"
              :style="{ background: protocol.color }"
            />
            <span class="text-[11px] text-[#717270]">{{ protocol.name }}</span>
          </div>
        </div>

        <!-- OVERLAY -->
        <div
          class="absolute inset-0 bg-[rgba(14,14,14,0.35)] backdrop-blur-[1.5px] flex items-center justify-center pointer-events-none rounded-[12px]"
        >
          <div
            class="flex items-center gap-2 bg-[#1a1a1a] border border-[#3a3a3a] rounded-full px-[18px] py-2 text-[15px] font-semibold text-[#9a9b99] tracking-[0.06em]"
          >
            <span
              class="w-[6px] h-[6px] bg-[#d5ff2f] rounded-full animate-pulse"
            />
            TVL Historical — Coming soon
          </div>
        </div>
      </div>

      <!-- RIGHT CARD: TVL Breakdown -->
      <div
        class="bg-[#2A2A2A] border border-[#383838] rounded-[12px] p-4 flex flex-col gap-4 relative overflow-hidden"
      >
        <!-- Header -->
        <div class="flex items-center justify-between">
          <span class="text-[13px] font-semibold text-[#E2E6E1]"
            >TVL Breakdown</span
          >

          <div class="flex items-center gap-1">
            <button
              v-for="opt in toggleOptions"
              :key="opt"
              class="px-2 py-[3px] text-[11px] font-semibold rounded-[5px] transition"
              :class="
                opt === activeToggle
                  ? 'bg-[#373B26] border border-[#7D922A] text-[#D5FF2F]'
                  : 'text-[#717270] border border-transparent hover:text-[#9a9b99]'
              "
            >
              {{ opt }}
            </button>
          </div>
        </div>

        <!-- Donut placeholder -->
        <div class="flex-1 min-h-[140px] flex items-center justify-center">
          <div
            class="w-[100px] h-[100px] rounded-full border-2 border-[#383838]"
          />
        </div>

        <!-- Legend with values -->
        <div class="flex flex-col gap-[6px]">
          <div
            v-for="protocol in protocols"
            :key="protocol.name"
            class="flex items-center justify-between"
          >
            <div class="flex items-center gap-[6px]">
              <span
                class="w-[8px] h-[8px] rounded-full shrink-0"
                :style="{ background: protocol.color }"
              />
              <span class="text-[11px] text-[#717270]">{{
                protocol.name
              }}</span>
            </div>
            <span class="text-[11px] font-semibold text-[#E2E6E1]">{{
              protocol.value
            }}</span>
          </div>
        </div>

        <!-- OVERLAY -->
        <div
          class="absolute inset-0 bg-[rgba(14,14,14,0.35)] backdrop-blur-[1.5px] flex items-center justify-center pointer-events-none rounded-[12px]"
        >
          <div
            class="flex items-center gap-2 bg-[#1a1a1a] border border-[#3a3a3a] rounded-full px-[18px] py-2 text-[15px] font-semibold text-[#9a9b99] tracking-[0.06em]"
          >
            <span
              class="w-[6px] h-[6px] bg-[#d5ff2f] rounded-full animate-pulse"
            />
            TVL breakdown — Coming soon
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
