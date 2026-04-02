<!-- src/components/DigDashboard.vue -->
<script setup lang="ts">
import { NOTIFICATIONS } from '../data/protocols'
import { useProtocol } from '../composables/useProtocol'
import { useNetworkStats } from '../composables/useNetworkStats'

import DashboardHeader from './DashboardHeader.vue'
import WalletSection from './WalletSection.vue'
import ProtocolTabs from './ProtocolTabs.vue'
import PoolTabs from './PoolTabs.vue'
import PoolDetail from './PoolDetail.vue'

const {
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
} = useProtocol()

const { stats } = useNetworkStats()
</script>

<template>
  <div class="dash">
    <DashboardHeader :stats="stats" />

    <section>
      <div class="section-hd">
        <span class="section-label">Stellar Multi-Wallet</span>
        <span class="section-sub">Portfolio and wallet connection</span>
      </div>

      <WalletSection :notifications="NOTIFICATIONS" />
    </section>

    <section>
      <div class="section-hd">
        <span class="section-label">Protocol View</span>
        <span class="section-sub">Live backend data</span>
      </div>

      <div v-if="error" class="state-box state-box--error">
        {{ error }}
      </div>

      <div v-else-if="loadingProtocols" class="state-box">
        Loading protocols...
      </div>

      <template v-else>
        <ProtocolTabs
          :protocols="protocolDisplays"
          :selected-protocol-id="selectedProtocolId"
          @select="selectProtocol"
        />

        <PoolTabs
          :pools="protocolPools"
          :selected-pool-id="selectedPoolId"
          style="margin-top: 8px;"
          @select-pool="selectPool"
        />

        <div v-if="loadingPoolDetail" class="state-box" style="margin-top: 8px;">
          Loading pool detail...
        </div>

        <PoolDetail
          v-else-if="selectedPool && selectedProtocol"
          :pool="selectedPool"
          :protocol="selectedProtocol"
          style="margin-top: 8px;"
        />

        <div v-else class="state-box" style="margin-top: 8px;">
          No pool selected.
        </div>
      </template>
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
  max-width: 1200px;
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
  background: #181818;
  border: 1px solid #2a2a2a;
  border-radius: 10px;
  padding: 14px;
  font-size: 12px;
  color: #9A9B99;
}

.state-box--error {
  border-color: rgba(255, 90, 90, 0.35);
  color: #ff8b8b;
}
</style>