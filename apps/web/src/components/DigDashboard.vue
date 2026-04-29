<script setup lang="ts">
import { NOTIFICATIONS } from '../data/protocols'
import { useProtocol } from '../composables/useProtocol'
import { useNetworkStats } from '../composables/useNetworkStats'

import DashboardHeader from './DashboardHeader.vue'
import HeroBanner from './HeroBanner.vue'
import NetworkStats from './NetworkStats.vue'
import WalletSection from './WalletSection.vue'
import ProtocolTabs from './ProtocolTabs.vue'
import PoolTabs from './PoolTabs.vue'
import PoolDetail from './PoolDetail.vue'

import heroImg from '@/assets/hero.png'
import stellarLogo from '@/assets/stellar-logo.svg'

const {
  protocolDisplays,
  protocolPools,
  selectedProtocolId,
  selectedPoolId,
  selectedProtocol,
  selectedPool,
  selectedPoolRaw, // ✅ IMPORTANT
  loadingProtocols,
  loadingPoolDetail,
  error,
  selectProtocol,
  selectPool,
} = useProtocol()

const { stats } = useNetworkStats()
</script>

<template>
<div class="min-h-screen bg-bg text-text">

  <div class="max-w-[1100px] mx-auto px-6 py-8 flex flex-col gap-8">

    <!-- HEADER -->
    <DashboardHeader />

    <!-- HERO -->
    <HeroBanner
      title="Stellar"
      description="Stellar DeFi ecosystem built on Soroban smart contracts. TVL grew 193% in 2025. Tracking Blend V2, Aquarius, Soroswap & DeFindex across $88M+ combined TVL."
      :image="heroImg"
      :logo="stellarLogo"
    />

    <!-- STATS -->
    <NetworkStats :stats="stats" />

    <!-- WALLET -->
    <section class="flex flex-col gap-3">

      <div class="flex items-center justify-between">
        <span class="text-[11px] font-bold uppercase tracking-[0.14em] text-accent">
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

      <div class="flex items-center justify-between">
        <span class="text-[11px] font-bold uppercase tracking-[0.14em] text-accent">
          Protocol View
        </span>

        <span class="text-[11px] text-muted">
          Live backend data
        </span>
      </div>

      <!-- ERROR -->
      <div
        v-if="error"
        class="bg-card border border-red-500/30 text-red-400 rounded-lg p-3 text-xs"
      >
        {{ error }}
      </div>

      <!-- LOADING -->
      <div
        v-else-if="loadingProtocols"
        class="bg-card border border-border rounded-lg p-3 text-xs text-muted"
      >
        Loading protocols...
      </div>

      <!-- CONTENT -->
      <template v-else>

        <ProtocolTabs
          :protocols="protocolDisplays"
          :selected-protocol-id="selectedProtocolId"
          @select="selectProtocol"
        />

        <PoolTabs
          class="mt-2"
          :pools="protocolPools"
          :selected-pool-id="selectedPoolId"
          @select-pool="selectPool"
        />

        <!-- LOADING DETAIL -->
        <div
          v-if="loadingPoolDetail"
          class="bg-card border border-border rounded-lg p-3 text-xs text-muted mt-2"
        >
          Loading pool detail...
        </div>

        <!-- ✅ FIX ICI -->
        <PoolDetail
          v-else-if="selectedPoolRaw && selectedProtocol"
          class="mt-2"
          :pool="selectedPoolRaw"
          :protocol="selectedProtocol"
        />

        <!-- EMPTY -->
        <div
          v-else
          class="bg-card border border-border rounded-lg p-3 text-xs text-muted mt-2"
        >
          No pool selected.
        </div>

      </template>

    </section>

  </div>

</div>
</template>