<script setup lang="ts">
import { WALLETS, NOTIFICATIONS } from '../data/protocols'
import { useProtocol } from '../composables/useProtocol'
import { useNetworkStats } from '../composables/useNetworkStats'

import DashboardHeader from './DashboardHeader.vue'
import WalletSection   from './WalletSection.vue'
import ProtocolTabs    from './ProtocolTabs.vue'
import PoolTabs        from './PoolTabs.vue'
import PoolDetail      from './PoolDetail.vue'

const {
  protocols,
  selectedProtocolId,
  selectedPoolId,
  selectedProtocol,
  selectedPool,
  selectProtocol,
  selectPool,
} = useProtocol()

const { stats } = useNetworkStats()
</script>

<template>
  <div class="dash">

    <!-- ── HEADER + STATS ── -->
    <DashboardHeader
      :stats="stats"
      description="Grant application demo — this is a light preview of what Dig will deliver for the Stellar ecosystem. Full scope on GitHub & Stellar Community Fund."
      :links="[
        { label: 'GitHub', url: 'https://github.com/Mael-wnb/dig-stellar' },
        { label: 'Grant submission', url: 'https://communityfund.stellar.org/submissions/recoebnaQgCsMeEjm' },
      ]"
    />

    <!-- ── WALLET SECTION ── -->
    <section>
      <div class="section-hd">
        <span class="section-label">Stellar Multi-Wallet</span>
        <span class="section-sub">TVL · Protocol comparison</span>
      </div>
      <WalletSection
        total-balance="$14,523.89"
        :wallets="WALLETS"
        :notifications="NOTIFICATIONS"
      />
    </section>

    <!-- ── PROTOCOL VIEW ── -->
    <section>
      <div class="section-hd">
        <span class="section-label">Protocol View</span>
        <span class="section-sub">Select a protocol</span>
      </div>

      <!-- Protocol selector (Blend / Aquarius / Soroswap / DeFindex) -->
      <ProtocolTabs
        :protocols="protocols"
        :selected-protocol-id="selectedProtocolId"
        @select="selectProtocol"
      />

      <!-- Pool selector - tous les pools de tous les protocoles -->
      <PoolTabs
        :protocols="protocols"
        :selected-pool-id="selectedPoolId"
        :selected-protocol-id="selectedProtocolId"
        style="margin-top: 8px;"
        @select-pool="selectPool"
        @select-protocol="selectProtocol"
      />

      <!-- Pool detail: metrics + on-chain info + reserves -->
      <PoolDetail
        v-if="selectedPool && selectedProtocol"
        :pool="selectedPool"
        :protocol="selectedProtocol"
        style="margin-top: 8px;"
      />
    </section>

  </div>
</template>

<style scoped>
.dash {
  min-height: 100vh;
  background: #0e0e0e;
  color: #E2E6E1;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  font-family: 'DM Mono', 'Courier New', monospace;
  max-width: 960px;
  margin: 0 auto;
}

.section-hd {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.section-label {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: #D5FF2F;
}

.section-sub {
  font-size: 11px;
  color: #9A9B99;
}
</style>