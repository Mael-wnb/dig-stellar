<script setup lang="ts">
import { NOTIFICATIONS } from "../data/protocols";
import { useProtocol } from "../composables/useProtocol";
import { useNetworkStats } from "../composables/useNetworkStats";

import DashboardHeader from "./DashboardHeader.vue";
import HeroBanner from "./HeroBanner.vue";
import NetworkStats from "./NetworkStats.vue"; // ✅ FIX
import StellarMetrics from "./StellarMetrics.vue";
import NetFlowChart from "./NetFlowChart.vue";
import WalletSection from "./WalletSection.vue";
import ProtocolTabs from "./ProtocolTabs.vue";
import PoolTabs from "./PoolTabs.vue";
import PoolDetail from "./PoolDetail.vue";

import heroImg from "@/assets/hero.png";
import stellarLogo from "@/assets/stellar-logo.svg";

const {
  pools,
  protocolDisplays,
  protocolPools,
  selectedProtocolId,
  selectedPoolId,
  selectedProtocol,
  selectedPool,
  loadingProtocols,
  loadingPoolDetail,
  error,
  selectProtocol,
  selectPool,
} = useProtocol();

const { stats } = useNetworkStats();
</script>

<template>
  <div class="min-h-screen bg-bg text-text">
    <!-- HEADER (full-width) -->
    <DashboardHeader />

    <!-- CONTENT -->
    <div class="max-w-[1100px] mx-auto px-3 sm:px-6 py-6 sm:py-8 flex flex-col gap-6 sm:gap-8">
      <!-- HERO -->
      <HeroBanner
        title="Stellar"
        description="Stellar DeFi ecosystem built on Soroban smart contracts. TVL grew 193% in 2025. Tracking Blend V2, Aquarius, Soroswap & DeFindex across $88M+ combined TVL."
        :image="heroImg"
        :logo="stellarLogo"
      />

      <!-- ✅ STATS -->
      <NetworkStats :stats="stats" />

      <!-- WALLET -->
      <section class="flex flex-col gap-3">
        <div class="flex items-center justify-between">
          <span
            class="text-[11px] font-bold uppercase tracking-[0.14em] text-accent"
          >
            Stellar Multi-Wallet
          </span>

          <span class="text-[11px] text-muted">
            Portfolio and wallet connection
          </span>
        </div>

        <WalletSection :notifications="NOTIFICATIONS" />
      </section>

      <!-- PROTOCOL -->
      <section class="flex flex-col gap-3">
        <div class="flex items-center gap-2">
          <span
            class="text-[16px] text-[#D5FF2F] font-normal whitespace-nowrap"
          >
            Protocol View
          </span>

          <div class="flex-1 h-px bg-[#7D922A]" />

          <span class="text-[14px] text-[#838583] font-light whitespace-nowrap">
            Select a protocol
          </span>
        </div>

        <!-- ERROR -->
        <div
          v-if="error"
          class="bg-card border border-red-500/30 text-red-400 rounded-lg p-3 text-xs"
        >
          {{ error }}
        </div>

        <!-- LOADING SKELETON — Protocol tabs -->
        <div v-else-if="loadingProtocols" class="flex flex-col gap-6">
          <div class="grid grid-cols-2 gap-6 max-sm:grid-cols-1">
            <div v-for="i in 4" :key="i" class="bg-[#2A2A2A] border border-[#383838] rounded-xl px-4 py-4 flex items-center justify-between">
              <div class="flex items-center gap-4">
                <div class="w-[38px] h-[38px] rounded-lg bg-[#383838] skeleton-pulse" />
                <div class="flex flex-col gap-2">
                  <div class="w-20 h-4 bg-[#383838] rounded skeleton-pulse" />
                  <div class="w-16 h-3 bg-[#303030] rounded skeleton-pulse" />
                </div>
              </div>
              <div class="flex flex-col items-end gap-2">
                <div class="w-14 h-4 bg-[#383838] rounded skeleton-pulse" />
                <div class="w-8 h-3 bg-[#303030] rounded skeleton-pulse" />
              </div>
            </div>
          </div>
        </div>

        <!-- CONTENT -->
        <template v-else>
          <ProtocolTabs
            :protocols="protocolDisplays"
            :selected-protocol-id="selectedProtocolId"
            :pools="pools"
            @select="selectProtocol"
          />

          <div
            class="bg-[rgba(37,37,37,0.7)] border border-[#383838] rounded-2xl sm:rounded-3xl p-3 sm:p-6 flex flex-col gap-4 sm:gap-6"
          >
            <PoolTabs
              :pools="protocolPools"
              :selected-pool-id="selectedPoolId"
              @select-pool="selectPool"
            />

            <!-- LOADING SKELETON — Pool detail -->
            <div v-if="loadingPoolDetail" class="flex flex-col gap-6">
              <div class="grid grid-cols-2 gap-6 max-sm:grid-cols-1">
                <div class="bg-[#2A2A2A] border border-[#383838] rounded-xl h-[320px] flex flex-col">
                  <div class="px-4 py-4 border-b border-[#383838] flex justify-between items-center">
                    <div class="flex gap-2">
                      <div class="w-24 h-5 bg-[#383838] rounded skeleton-pulse" />
                      <div class="w-16 h-5 bg-[#303030] rounded skeleton-pulse" />
                    </div>
                    <div class="w-16 h-4 bg-[#303030] rounded skeleton-pulse" />
                  </div>
                  <div class="flex border-b border-[#383838] flex-1">
                    <div v-for="j in 3" :key="j" class="flex-1 p-6" :class="j < 3 ? 'border-r border-[#383838]' : ''">
                      <div class="w-16 h-3 bg-[#303030] rounded mb-3 skeleton-pulse" />
                      <div class="w-20 h-5 bg-[#383838] rounded skeleton-pulse" />
                    </div>
                  </div>
                </div>
                <div class="bg-[#2A2A2A] border border-[#383838] rounded-xl h-[320px] flex flex-col">
                  <div class="px-4 py-4 border-b border-[#383838]">
                    <div class="w-48 h-5 bg-[#383838] rounded skeleton-pulse" />
                  </div>
                  <div class="flex flex-col gap-2 p-4 flex-1">
                    <div v-for="j in 6" :key="j" class="flex justify-between items-center px-6 py-3 bg-[rgba(226,230,225,0.05)] rounded">
                      <div class="w-20 h-3 bg-[#303030] rounded skeleton-pulse" />
                      <div class="w-24 h-3 bg-[#383838] rounded skeleton-pulse" />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <PoolDetail
              v-else-if="selectedPool && selectedProtocol"
              :key="selectedPool.id"
              :pool="selectedPool as any"
              :protocol="selectedProtocol"
            />

            <div
              v-else
              class="text-[14px] text-[#5E5F5D] py-4 text-center"
            >
              No pool selected.
            </div>
          </div>
        </template>
      </section>
      <!-- STELLAR METRICS -->
      <StellarMetrics />

      <!-- OUTFLOW / INFLOW -->
      <NetFlowChart />
    </div>
  </div>
</template>
