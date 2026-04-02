<!-- src/components/DigDashboard.vue -->
<script setup lang="ts">
import { NOTIFICATIONS } from '../data/mock/notifications'
import { useProtocol } from '../composables/useProtocol'
import { useNetworkStats } from '../composables/useNetworkStats'

import DashboardHeader from './DashboardHeader.vue'
import WalletSection from './WalletSection.vue'
import ProtocolTabs from './ProtocolTabs.vue'
import PoolTabs from './PoolTabs.vue'
import PoolDetail from './PoolDetail.vue'

const {
  protocols,
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
} = useProtocol()

const { stats } = useNetworkStats()
</script>

<template>
  <div class="dash">
    <DashboardHeader :stats="stats" />

    <section>
      <div class="section-hd">
        <span class="section-label">Stellar Multi-Wallet</span>
        <span class="section-sub">TVL · Protocol comparison</span>
      </div>

      <WalletSection :notifications="NOTIFICATIONS" />
    </section>

    <section>
      <div class="section-hd">
        <span class="section-label">Protocol View</span>
        <span class="section-sub">Select a protocol</span>
      </div>

      <ProtocolTabs
        :protocols="protocols"
        :selected-protocol-id="selectedProtocolId"
        @select="selectProtocol"
      />

      <PoolTabs
        :pools="protocolPools"
        :selected-pool-id="selectedPoolId"
        style="margin-top: 8px;"
        @select-pool="selectPool"
      />

      <div v-if="loadingProtocols || loadingPoolDetail" class="state-box">
        Loading…
      </div>

      <div v-else-if="error" class="state-box state-box--error">
        {{ error }}
      </div>

      <PoolDetail
        v-else-if="selectedPool && selectedProtocol"
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

.state-box {
  margin-top: 8px;
  padding: 16px;
  border: 1px solid #2a2a2a;
  border-radius: 12px;
  background: #181818;
  color: #9A9B99;
}

.state-box--error {
  color: #FF5A5A;
}
</style>