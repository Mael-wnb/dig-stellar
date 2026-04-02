<!-- src/components/PoolDetail.vue -->
<script setup>
defineProps({
  pool:     { type: Object, required: true },
  protocol: { type: Object, required: true },
})
</script>

<template>
  <transition name="fade" mode="out-in">
    <div :key="pool.id" class="detail-wrap">

      <!-- TOP: metrics + on-chain info -->
      <div class="detail-grid">

        <!-- LEFT: metrics -->
        <div class="card">
          <div class="card-header">
            <div class="card-title-group">
              <span
                class="pool-name-badge"
                :style="{ color: protocol.iconColor, background: protocol.iconBg, borderColor: protocol.iconColor + '44' }"
              >{{ pool.name }}</span>
              <span class="card-title" :style="{ color: protocol.iconColor }">{{ protocol.name }}</span>
            </div>
          </div>

          <div class="metrics-grid">
            <div v-for="m in pool.metrics" :key="m.label" class="metric-tile">
              <span class="metric-label">{{ m.label }}</span>
              <span class="metric-value" :class="{ lime: m.lime }">{{ m.value }}</span>
            </div>
          </div>

          <p class="description">{{ pool.description }}</p>
        </div>

        <!-- RIGHT: on-chain info -->
        <div class="card">
          <div class="card-header">
            <div class="card-title-group">
              <span
                class="pool-name-badge"
                :style="{ color: protocol.iconColor, background: protocol.iconBg, borderColor: protocol.iconColor + '44' }"
              >{{ pool.name }}</span>
              <span class="card-title" :style="{ color: protocol.iconColor }">{{ protocol.name }}</span>
              <span class="card-sub">On-chain info</span>
            </div>
          </div>

          <div class="info-table">
            <div v-for="row in pool.onChainInfo" :key="row.key" class="info-row">
              <span class="info-key">{{ row.key }}</span>
              <span class="info-val" :class="{ lime: row.lime }">{{ row.value }}</span>
            </div>
          </div>
        </div>

      </div>

      <!-- RESERVES TABLE -->
      <div v-if="pool.reserves && pool.reserves.length" class="reserves-wrap">
        <table class="reserves-table">
          <thead>
            <tr>
              <th>Asset</th>
              <th>Total Supplied</th>
              <th>Total Borrowed</th>
              <th>Collateral Factor</th>
              <th>Liability Factor</th>
              <th>Supply APY</th>
              <th>Borrow APY</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in pool.reserves" :key="r.symbol">
              <td class="symbol-cell">
                <span class="symbol-dot" :style="{ background: protocol.iconColor }"></span>
                <div class="symbol-info">
                  <span class="symbol-name">{{ r.symbol }}</span>
                  <span class="project-tag">{{ r.project }}</span>
                </div>
              </td>
              <td class="lime-text">{{ r.supplied }}</td>
              <td>{{ r.borrowed }}</td>
              <td>{{ r.collateral }}</td>
              <td>{{ r.liability }}</td>
              <td class="supply-apy">{{ r.supplyApy }}</td>
              <td class="borrow-apy">{{ r.borrowApy }}</td>
            </tr>
          </tbody>
        </table>
      </div>

    </div>
  </transition>
</template>

<style scoped>
.detail-wrap { display: flex; flex-direction: column; gap: 10px; }

.fade-enter-active, .fade-leave-active { transition: opacity 0.18s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

.detail-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
@media (max-width: 640px) { .detail-grid { grid-template-columns: 1fr; } }

.card {
  background: #181818;
  border: 1px solid #2a2a2a;
  border-radius: 12px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.card-title-group { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.card-title { font-size: 14px; font-weight: 700; }
.card-sub { font-size: 11px; color: #9A9B99; }

.pool-name-badge {
  font-size: 13px;
  font-weight: 600;
  border: 1px solid;
  border-radius: 4px;
  padding: 2px 8px;
}

/* Metrics */
.metrics-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}

.metric-tile {
  background: #202020;
  border-radius: 8px;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.metric-label { font-size: 10px; color: #9A9B99; text-transform: uppercase; letter-spacing: 0.08em; }
.metric-value { font-size: 15px; font-weight: 700; color: #E2E6E1; }
.metric-value.lime { color: #D5FF2F; }

.description {
  font-size: 12px;
  line-height: 1.6;
  color: #9A9B99;
  background: #202020;
  border-left: 2px solid #D5FF2F;
  border-radius: 0 6px 6px 0;
  padding: 10px 12px;
}

/* On-chain info */
.info-table { display: flex; flex-direction: column; }
.info-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 0;
  border-bottom: 1px solid #2a2a2a;
  font-size: 13px;
}
.info-row:last-child { border-bottom: none; }
.info-key { color: #9A9B99; }
.info-val { color: #E2E6E1; font-weight: 500; }
.info-val.lime { color: #D5FF2F; }

/* Reserves table */
.reserves-wrap {
  background: #181818;
  border: 1px solid #2a2a2a;
  border-radius: 12px;
  overflow: hidden;
}

.reserves-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.reserves-table th {
  padding: 10px 14px;
  text-align: left;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: #9A9B99;
  font-weight: 600;
  border-bottom: 1px solid #2a2a2a;
}

.reserves-table td {
  padding: 11px 14px;
  border-bottom: 1px solid #2a2a2a;
  color: #E2E6E1;
}
.reserves-table tr:last-child td { border-bottom: none; }
.reserves-table tr:hover td { background: #1f1f1f; }

.symbol-cell {
  display: flex;
  align-items: center;
  gap: 7px;
}

.symbol-dot {
  width: 7px; height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}

.symbol-info { display: flex; flex-direction: column; gap: 1px; }
.symbol-name { font-size: 13px; font-weight: 700; color: #E2E6E1; }

.project-tag {
  font-size: 10px;
  color: #9A9B99;
  font-weight: 400;
}

.lime-text { color: #D5FF2F; font-weight: 600; }
.supply-apy { color: #D5FF2F; font-weight: 700; }
.borrow-apy { color: #FF5A5A; font-weight: 600; }
</style>