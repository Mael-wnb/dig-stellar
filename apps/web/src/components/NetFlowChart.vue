<script setup lang="ts">
import { computed } from 'vue'

const bars = [
  { inflow: 22, outflow: 15 },
  { inflow: 14, outflow: 11 },
  { inflow: 37, outflow: 21 },
  { inflow: 27, outflow: 29 },
  { inflow: 43, outflow: 32 },
  { inflow: 32, outflow: 10 },
  { inflow: 10, outflow: 7 },
  { inflow: 53, outflow: 46 },
  { inflow: 46, outflow: 15 },
]

const maxVal = computed(() => Math.max(...bars.map(b => Math.max(b.inflow, b.outflow))))
</script>

<template>
  <section class="flex flex-col gap-6">

    <!-- SECTION HEADER -->
    <div class="flex items-center gap-2">
      <span class="text-base text-[#D5FF2F] font-normal whitespace-nowrap" style="font-family: 'IBM Plex Sans', sans-serif">
        Outflow / Inflow
      </span>
      <div class="flex-1 h-px bg-[#7D922A]" />
      <span class="text-sm text-[#838583] font-light whitespace-nowrap" style="font-family: 'IBM Plex Sans', sans-serif">
        Net capital flow · 30D
      </span>
    </div>

    <!-- CARD -->
    <div class="bg-[#2A2A2A] border border-[#383838] rounded-xl flex flex-col relative overflow-hidden" style="height: 226px">

      <!-- CARD HEADER -->
      <div class="flex items-center justify-between px-4 py-4 border-b border-[#383838]">
        <span class="text-[13px] font-semibold text-white">Stellar Net Flow (USD)</span>
        <div class="flex items-center gap-2">
          <span class="text-xs font-light text-[#D5FF2F]">▲ Inflow</span>
          <span class="text-xs font-light text-[#FF5836]">▼ Outflow</span>
        </div>
      </div>

      <!-- CHART BODY -->
      <div class="flex-1 flex flex-col px-2.5 pb-2.5 min-h-0">

        <!-- HISTOGRAM -->
        <div class="flex gap-1 flex-1 min-h-0">
          <div
            v-for="(bar, i) in bars"
            :key="i"
            class="flex-1 flex flex-col"
          >
            <!-- POSITIVE half (inflow goes up from center) -->
            <div class="flex-1 flex items-end">
              <div
                class="w-full rounded-t-sm"
                :style="{
                  height: (bar.inflow / maxVal * 100) + '%',
                  background: 'rgba(213, 255, 47, 0.5)',
                }"
              />
            </div>

            <!-- NEGATIVE half (outflow goes down from center) -->
            <div class="flex-1 flex items-start">
              <div
                class="w-full rounded-b-sm"
                :style="{
                  height: (bar.outflow / maxVal * 100) + '%',
                  background: 'rgba(255, 88, 54, 0.5)',
                }"
              />
            </div>
          </div>
        </div>

        <!-- ZERO LINE + DATES -->
        <div class="h-px bg-[#383838] mt-1" />
        <div class="flex items-center justify-between mt-1.5">
          <span class="text-xs text-[#717270]">Feb 11</span>
          <span class="text-xs text-[#717270]">Feb 25</span>
          <span class="text-xs text-[#717270]">Mar 12</span>
        </div>
      </div>

      <!-- COMING SOON OVERLAY -->
      <div class="absolute inset-0 bg-[rgba(14,14,14,0.35)] backdrop-blur-[1.5px] flex items-center justify-center pointer-events-none rounded-xl">
        <div class="flex items-center gap-2 bg-[#1a1a1a] border border-[#3a3a3a] rounded-full px-4.5 py-2 text-[15px] font-semibold text-[#9a9b99] tracking-[0.06em]">
          <span class="w-1.5 h-1.5 bg-[#d5ff2f] rounded-full animate-pulse" />
          Outflow / Inflow — Coming soon
        </div>
      </div>

    </div>
  </section>
</template>
