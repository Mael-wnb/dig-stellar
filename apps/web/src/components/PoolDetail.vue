<script setup lang="ts">
import type {
  PoolDetailData,
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

  const v = value as number

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: v >= 1_000_000 ? 'compact' : 'standard',
    maximumFractionDigits: v >= 100 ? 0 : 2,
  }).format(v)
}

function formatNumber(value?: number | null, maxFractionDigits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'

  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: maxFractionDigits,
  }).format(value as number)
}

function formatPercentFromRatio(value?: number | null): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'

  return `${((value as number) * 100).toFixed(2)}%`
}

function shortAddress(value?: string | null): string {
  if (!value) return '—'
  return value.length <= 14 ? value : `${value.slice(0, 6)}...${value.slice(-4)}`
}

function formatDate(value?: string | null): string {
  if (!value) return '—'
  const d = new Date(value)
  return Number.isNaN(d.getTime())
    ? value
    : d.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
}

function isLendingPool(pool: PoolDetailData) {
  return pool.type === 'lending_pool'
}

/* 🆕 AMM COLLATERAL */
function getMinCollateral(pool: PoolDetailData): number {
  return (pool as any)?.metrics?.minCollateral ?? 5
}

function getMaxCollateral(pool: PoolDetailData): number {
  return (pool as any)?.metrics?.maxCollateral ?? 6
}
</script>

<template>
  <div class="flex flex-col gap-3">

    <!-- GRID -->
    <div class="grid grid-cols-2 gap-2 max-sm:grid-cols-1">

      <!-- LEFT CARD -->
      <div class="bg-[#181818] border border-[#2a2a2a] rounded-xl p-4 flex flex-col gap-4">

        <!-- HEADER -->
        <div class="flex items-center gap-2 flex-wrap">
          <span
            class="text-[13px] font-semibold border rounded px-2 py-[2px]"
            :style="{
              color: protocol.iconColor,
              background: protocol.iconBg,
              borderColor: protocol.iconColor + '44',
            }"
          >
            {{ pool.name }}
          </span>

          <span class="text-[14px] font-bold" :style="{ color: protocol.iconColor }">
            {{ protocol.name }}
          </span>
        </div>

        <!-- METRICS -->
        <div class="grid grid-cols-2 md:grid-cols-3 gap-2">

          <!-- LENDING -->
          <template v-if="isLendingPool(pool)">

            <div class="metric">
              <span class="label">TVL</span>
              <span class="value lime">{{ formatUsd(pool.metrics.tvlUsd) }}</span>
            </div>

            <div class="metric">
              <span class="label">Supplied</span>
              <span class="value">{{ formatUsd(pool.metrics.totalSuppliedUsd) }}</span>
            </div>

            <div class="metric">
              <span class="label">Borrowed</span>
              <span class="value">{{ formatUsd(pool.metrics.totalBorrowedUsd) }}</span>
            </div>

            <div class="metric">
              <span class="label">Net Liquidity</span>
              <span class="value">{{ formatUsd(pool.metrics.netLiquidityUsd) }}</span>
            </div>

            <div class="metric">
              <span class="label">Supply APY</span>
              <span class="value lime">
                {{ formatPercentFromRatio(pool.metrics.supplyApy) }}
              </span>
            </div>

            <div class="metric">
              <span class="label">Borrow APY</span>
              <span class="value text-[#FF5A5A]">
                {{ formatPercentFromRatio(pool.metrics.borrowApy) }}
              </span>
            </div>

          </template>

          <!-- AMM -->
          <template v-else>

            <div class="metric">
              <span class="label">TVL</span>
              <span class="value lime">{{ formatUsd(pool.metrics.tvlUsd) }}</span>
            </div>

            <div class="metric">
              <span class="label">Volume 24h</span>
              <span class="value">{{ formatUsd(pool.metrics.volume24hUsd) }}</span>
            </div>

            <div class="metric">
              <span class="label">Fees 24h</span>
              <span class="value">{{ formatUsd(pool.metrics.fees24hUsd) }}</span>
            </div>

            <div class="metric">
              <span class="label">Swaps 24h</span>
              <span class="value">
                {{ formatNumber(pool.metrics.swaps24h ?? pool.metrics.events24h, 0) }}
              </span>
            </div>

            <!-- 🆕 -->
            <div class="metric">
              <span class="label">Min Collateral</span>
              <span class="value">{{ getMinCollateral(pool) }}</span>
            </div>

            <div class="metric">
              <span class="label">Max Collateral</span>
              <span class="value">{{ getMaxCollateral(pool) }}</span>
            </div>

          </template>

        </div>
      </div>

      <!-- RIGHT CARD -->
      <div class="bg-[#181818] border border-[#2a2a2a] rounded-xl p-4 flex flex-col gap-3">

        <div class="text-[11px] text-[#9A9B99] uppercase tracking-wide">
          On-chain info
        </div>

        <div class="flex flex-col divide-y divide-[#2a2a2a] text-[13px]">

          <div class="flex justify-between py-2">
            <span class="text-[#9A9B99]">Protocol</span>
            <span>{{ protocol.name }}</span>
          </div>

          <div class="flex justify-between py-2">
            <span class="text-[#9A9B99]">Type</span>
            <span>{{ pool.type }}</span>
          </div>

          <div class="flex justify-between py-2">
            <span class="text-[#9A9B99]">Chain</span>
            <span>{{ pool.chain }}</span>
          </div>

          <div class="flex justify-between py-2">
            <span class="text-[#9A9B99]">Contract</span>
            <span>{{ shortAddress(pool.contractAddress) }}</span>
          </div>

          <div class="flex justify-between py-2">
            <span class="text-[#9A9B99]">Updated</span>
            <span>{{ formatDate(pool.updatedAt) }}</span>
          </div>

        </div>
      </div>

    </div>

    <!-- TABLE (UNCHANGED) -->
    <div class="bg-[#181818] border border-[#2a2a2a] rounded-xl overflow-x-auto">
      <table class="w-full text-[13px]">
        <thead>
          <tr class="text-[10px] uppercase tracking-wider text-[#9A9B99] border-b border-[#2a2a2a]">
            <th class="px-4 py-2 text-left">Asset</th>
            <th class="px-4 py-2 text-left">Price</th>
            <th class="px-4 py-2 text-left">Supplied</th>
            <th class="px-4 py-2 text-left">Borrowed</th>
            <th class="px-4 py-2 text-left">Backstop</th>
            <th class="px-4 py-2 text-left">Supply Cap</th>
            <th class="px-4 py-2 text-left">Supply APY</th>
            <th class="px-4 py-2 text-left">Borrow APY</th>
          </tr>
        </thead>

        <tbody>
          <tr
            v-for="r in pool.reserves || []"
            :key="r.assetId"
            class="border-b border-[#2a2a2a] hover:bg-[#1f1f1f]"
          >
            <td class="px-4 py-2">{{ r.symbol }}</td>
            <td class="px-4 py-2">{{ formatUsd(r.priceUsd) }}</td>
            <td class="px-4 py-2 text-[#D5FF2F]">{{ formatNumber(r.supplied, 4) }}</td>
            <td class="px-4 py-2">{{ formatNumber(r.borrowed, 4) }}</td>
            <td class="px-4 py-2">{{ formatNumber(r.backstopCredit, 4) }}</td>
            <td class="px-4 py-2">{{ formatNumber(r.supplyCap, 2) }}</td>
            <td class="px-4 py-2 text-[#D5FF2F]">{{ formatPercentFromRatio(r.supplyApy) }}</td>
            <td class="px-4 py-2 text-[#FF5A5A]">{{ formatPercentFromRatio(r.borrowApy) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

  </div>
</template>

<style scoped>
.metric {
  background: #202020;
  border: 1px solid #2a2a2a;
  border-radius: 8px;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.label {
  font-size: 10px;
  color: #9A9B99;
  text-transform: uppercase;
}

.value {
  font-size: 15px;
  font-weight: 700;
  color: #E2E6E1;
}

.value.lime {
  color: #D5FF2F;
}
</style>