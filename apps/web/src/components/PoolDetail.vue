<!-- src/components/PoolDetail.vue -->
<script setup lang="ts">
import type {
  PoolDetailData,
  PoolReserveDetail,
  PoolTokenSummary,
} from '../types/protocol'

interface ProtocolDisplay {
  id: string
  name: string
  type: string
  icon: string
  iconColor: string
  iconBg: string
}

const props = defineProps<{
  pool: PoolDetailData
  protocol: ProtocolDisplay
}>()

function formatUsd(value?: number | null): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: value >= 1_000_000 ? 'compact' : 'standard',
    maximumFractionDigits: value >= 100 ? 0 : 2,
  }).format(value)
}

function formatNumber(value?: number | null, maxFractionDigits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: maxFractionDigits,
  }).format(value)
}

function formatPercentFromRatio(value?: number | null): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return `${(value * 100).toFixed(2)}%`
}

function shortAddress(value?: string | null): string {
  if (!value) return '—'
  if (value.length <= 14) return value
  return `${value.slice(0, 6)}...${value.slice(-4)}`
}

function formatDate(value?: string | null): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleString('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

function isLendingPool(pool: PoolDetailData): boolean {
  return pool.type === 'lending_pool'
}

function isAmmPool(pool: PoolDetailData): boolean {
  return pool.type === 'amm_pool'
}

function lendingReserves(pool: PoolDetailData): PoolReserveDetail[] {
  return pool.reserves ?? []
}

function ammTokens(pool: PoolDetailData): PoolTokenSummary[] {
  return pool.tokens ?? []
}
</script>

<template>
  <transition name="fade" mode="out-in">
    <div :key="pool.id" class="detail-wrap">
      <div class="detail-grid">
        <div class="card">
          <div class="card-header">
            <div class="card-title-group">
              <span
                class="pool-name-badge"
                :style="{
                  color: protocol.iconColor,
                  background: protocol.iconBg,
                  borderColor: protocol.iconColor + '44',
                }"
              >
                {{ pool.name }}
              </span>
              <span class="card-title" :style="{ color: protocol.iconColor }">
                {{ protocol.name }}
              </span>
            </div>
          </div>

          <div class="metrics-grid">
            <template v-if="isLendingPool(pool)">
              <div class="metric-tile">
                <span class="metric-label">TVL</span>
                <span class="metric-value lime">{{ formatUsd(pool.metrics.tvlUsd) }}</span>
              </div>
              <div class="metric-tile">
                <span class="metric-label">Supplied</span>
                <span class="metric-value">{{ formatUsd(pool.metrics.totalSuppliedUsd) }}</span>
              </div>
              <div class="metric-tile">
                <span class="metric-label">Borrowed</span>
                <span class="metric-value">{{ formatUsd(pool.metrics.totalBorrowedUsd) }}</span>
              </div>
              <div class="metric-tile">
                <span class="metric-label">Net Liquidity</span>
                <span class="metric-value">{{ formatUsd(pool.metrics.netLiquidityUsd) }}</span>
              </div>
              <div class="metric-tile">
                <span class="metric-label">Supply APY</span>
                <span class="metric-value">{{ formatPercentFromRatio(pool.metrics.supplyApy) }}</span>
              </div>
              <div class="metric-tile">
                <span class="metric-label">Borrow APY</span>
                <span class="metric-value">{{ formatPercentFromRatio(pool.metrics.borrowApy) }}</span>
              </div>
            </template>

            <template v-else>
              <div class="metric-tile">
                <span class="metric-label">TVL</span>
                <span class="metric-value lime">{{ formatUsd(pool.metrics.tvlUsd) }}</span>
              </div>
              <div class="metric-tile">
                <span class="metric-label">Volume 24h</span>
                <span class="metric-value">{{ formatUsd(pool.metrics.volume24hUsd) }}</span>
              </div>
              <div class="metric-tile">
                <span class="metric-label">Fees 24h</span>
                <span class="metric-value">{{ formatUsd(pool.metrics.fees24hUsd) }}</span>
              </div>
              <div class="metric-tile">
                <span class="metric-label">Swaps 24h</span>
                <span class="metric-value">
                  {{ formatNumber(pool.metrics.swaps24h ?? pool.metrics.events24h, 0) }}
                </span>
              </div>
            </template>
          </div>

          <p class="description">
            <template v-if="isLendingPool(pool)">
              Lending pool with live reserve balances, supplied and borrowed amounts, APYs, and backstop exposure.
            </template>
            <template v-else>
              AMM pool with live protocol metrics and token composition from backend data.
            </template>
          </p>
        </div>

        <div class="card">
          <div class="card-header">
            <div class="card-title-group">
              <span
                class="pool-name-badge"
                :style="{
                  color: protocol.iconColor,
                  background: protocol.iconBg,
                  borderColor: protocol.iconColor + '44',
                }"
              >
                {{ pool.name }}
              </span>
              <span class="card-title" :style="{ color: protocol.iconColor }">
                {{ protocol.name }}
              </span>
              <span class="card-sub">On-chain info</span>
            </div>
          </div>

          <div class="info-table">
            <div class="info-row">
              <span class="info-key">Protocol</span>
              <span class="info-val">{{ protocol.name }}</span>
            </div>
            <div class="info-row">
              <span class="info-key">Type</span>
              <span class="info-val">{{ pool.type }}</span>
            </div>
            <div class="info-row">
              <span class="info-key">Chain</span>
              <span class="info-val">{{ pool.chain }}</span>
            </div>
            <div class="info-row">
              <span class="info-key">Contract</span>
              <span class="info-val">{{ shortAddress(pool.contractAddress) }}</span>
            </div>
            <div class="info-row">
              <span class="info-key">Updated</span>
              <span class="info-val">{{ formatDate(pool.updatedAt) }}</span>
            </div>

            <div v-if="isLendingPool(pool)" class="info-row">
              <span class="info-key">Backstop Credit</span>
              <span class="info-val">{{ formatUsd(pool.metrics.totalBackstopCreditUsd) }}</span>
            </div>

            <div v-if="isAmmPool(pool)" class="info-row">
              <span class="info-key">Fees 24h</span>
              <span class="info-val">{{ formatUsd(pool.metrics.fees24hUsd) }}</span>
            </div>
          </div>
        </div>
      </div>

      <div v-if="isLendingPool(pool) && lendingReserves(pool).length" class="reserves-wrap">
        <table class="reserves-table">
          <thead>
            <tr>
              <th>Asset</th>
              <th>Price</th>
              <th>Supplied</th>
              <th>Borrowed</th>
              <th>Backstop</th>
              <th>Supply Cap</th>
              <th>Supply APY</th>
              <th>Borrow APY</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="reserve in lendingReserves(pool)" :key="reserve.assetId">
              <td class="symbol-cell">
                <span class="symbol-dot" :style="{ background: protocol.iconColor }"></span>
                <div class="symbol-info">
                  <span class="symbol-name">{{ reserve.symbol }}</span>
                  <span class="project-tag">{{ reserve.name || '—' }}</span>
                </div>
              </td>
              <td>{{ formatUsd(reserve.priceUsd) }}</td>
              <td class="lime-text">{{ formatNumber(reserve.supplied, 4) }}</td>
              <td>{{ formatNumber(reserve.borrowed, 4) }}</td>
              <td>{{ formatNumber(reserve.backstopCredit, 4) }}</td>
              <td>{{ formatNumber(reserve.supplyCap, 2) }}</td>
              <td class="supply-apy">{{ formatPercentFromRatio(reserve.supplyApy) }}</td>
              <td class="borrow-apy">{{ formatPercentFromRatio(reserve.borrowApy) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-else-if="isAmmPool(pool) && ammTokens(pool).length" class="reserves-wrap">
        <table class="reserves-table">
          <thead>
            <tr>
              <th>Token</th>
              <th>Role</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="token in ammTokens(pool)" :key="token.assetId">
              <td class="symbol-cell">
                <span class="symbol-dot" :style="{ background: protocol.iconColor }"></span>
                <div class="symbol-info">
                  <span class="symbol-name">{{ token.symbol }}</span>
                  <span class="project-tag">{{ token.assetId }}</span>
                </div>
              </td>
              <td>{{ token.role }}</td>
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
@media (max-width: 640px) {
  .detail-grid { grid-template-columns: 1fr; }
}

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

.card-title-group {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.card-title { font-size: 14px; font-weight: 700; }
.card-sub { font-size: 11px; color: #9A9B99; }

.pool-name-badge {
  font-size: 13px;
  font-weight: 600;
  border: 1px solid;
  border-radius: 4px;
  padding: 2px 8px;
}

.metrics-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}
@media (max-width: 640px) {
  .metrics-grid { grid-template-columns: repeat(2, 1fr); }
}

.metric-tile {
  background: #202020;
  border-radius: 8px;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.metric-label {
  font-size: 10px;
  color: #9A9B99;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.metric-value {
  font-size: 15px;
  font-weight: 700;
  color: #E2E6E1;
}

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

.info-table { display: flex; flex-direction: column; }

.info-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid #2a2a2a;
  font-size: 13px;
}
.info-row:last-child { border-bottom: none; }

.info-key { color: #9A9B99; }
.info-val {
  color: #E2E6E1;
  font-weight: 500;
  text-align: right;
  word-break: break-word;
}

.reserves-wrap {
  background: #181818;
  border: 1px solid #2a2a2a;
  border-radius: 12px;
  overflow-x: auto;
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
  white-space: nowrap;
}

.reserves-table td {
  padding: 11px 14px;
  border-bottom: 1px solid #2a2a2a;
  color: #E2E6E1;
  white-space: nowrap;
}
.reserves-table tr:last-child td { border-bottom: none; }
.reserves-table tr:hover td { background: #1f1f1f; }

.symbol-cell {
  display: flex;
  align-items: center;
  gap: 7px;
}

.symbol-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}

.symbol-info {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.symbol-name {
  font-size: 13px;
  font-weight: 700;
  color: #E2E6E1;
}

.project-tag {
  font-size: 10px;
  color: #9A9B99;
  font-weight: 400;
}

.lime-text { color: #D5FF2F; font-weight: 600; }
.supply-apy { color: #D5FF2F; font-weight: 700; }
.borrow-apy { color: #FF5A5A; font-weight: 600; }
</style>