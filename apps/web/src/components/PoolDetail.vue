<script setup lang="ts">
import type { PoolDetailData } from "../types/protocol";

interface ProtocolDisplay {
  id: string;
  name: string;
  type: string;
  icon: string;
  iconColor: string;
  iconBg: string;
  logo: string;
}

const props = defineProps<{
  pool: PoolDetailData;
  protocol: ProtocolDisplay;
}>();

function formatUsd(value?: number | null): string {
  if (value === null || value === undefined || !Number.isFinite(value))
    return "—";

  const v = value as number;

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: v >= 1_000_000 ? "compact" : "standard",
    maximumFractionDigits: v >= 100 ? 0 : 2,
  }).format(v);
}

function formatNumber(value?: number | null, maxFractionDigits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value))
    return "—";

  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: maxFractionDigits,
  }).format(value as number);
}

function formatPercentFromRatio(value?: number | null): string {
  if (value === null || value === undefined || !Number.isFinite(value))
    return "—";

  return `${((value as number) * 100).toFixed(2)}%`;
}

function shortAddress(value?: string | null): string {
  if (!value) return "—";
  return value.length <= 14
    ? value
    : `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function formatDate(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? value
    : d.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

function isLendingPool(pool: PoolDetailData) {
  return pool.type === "lending_pool";
}

function getMinCollateral(pool: PoolDetailData): number {
  return (pool as any)?.metrics?.minCollateral ?? 5;
}

function getMaxCollateral(pool: PoolDetailData): number {
  return (pool as any)?.metrics?.maxCollateral ?? 6;
}

function poolDescription(pool: PoolDetailData): string {
  if (isLendingPool(pool)) {
    return "This lending pool allows users to supply and borrow assets on Stellar's Soroban smart contract platform. Interest rates adjust dynamically based on utilization.";
  }
  return "This AMM pool provides decentralized token swaps on Stellar's Soroban smart contract platform. Liquidity providers earn fees proportional to their share of the pool.";
}
</script>

<template>
  <div class="animate-fade-in flex flex-col gap-6">
    <!-- TOP ROW — Two cards side by side -->
    <div class="grid grid-cols-2 gap-6 max-sm:grid-cols-1">
      <!-- LEFT CARD -->
      <div
        class="bg-[#2A2A2A] border border-[#383838] rounded-xl flex flex-col"
      >
        <!-- Header row -->
        <div
          class="px-3 py-3 sm:px-4 sm:py-4 border-b border-[#383838] flex flex-wrap gap-2 justify-between items-center"
        >
          <div class="flex items-center gap-2">
            <span
              class="text-[16px] sm:text-[20px] font-bold text-white"
              style="
                font-family:
                  Clash Display,
                  sans-serif;
              "
            >
              {{ protocol.name }}
            </span>
            <span
              class="bg-[#485127] rounded-[4px] px-2 py-1 text-[#D5FF2F] text-[14px] font-light"
            >
              {{ pool.type === "lending_pool" ? "Lending" : "AMM" }}
            </span>
          </div>
          <a href="#" class="text-[#D5FF2F] text-[14px] font-light"
            >Explore →</a
          >
        </div>

        <!-- First metrics row -->
        <div class="flex flex-wrap border-b border-[#383838]">
          <template v-if="isLendingPool(pool)">
            <div class="flex-1 min-w-[140px] p-4 sm:p-6 border-r border-[#383838] max-sm:border-r-0 max-sm:border-b max-sm:border-[#383838]">
              <div class="text-[16px] text-[#5E5F5D]">Liquidity</div>
              <div
                class="text-[20px] font-bold text-[#D5FF2F]"
                style="
                  font-family:
                    Clash Display,
                    sans-serif;
                "
              >
                {{ formatUsd(pool.metrics.netLiquidityUsd) }}
              </div>
            </div>
            <div class="flex-1 min-w-[140px] p-4 sm:p-6 border-r border-[#383838] max-sm:border-r-0 max-sm:border-b max-sm:border-[#383838]">
              <div class="text-[16px] text-[#5E5F5D]">Volume 24h</div>
              <div
                class="text-[20px] font-bold text-[#E2E6E1]"
                style="
                  font-family:
                    Clash Display,
                    sans-serif;
                "
              >
                {{ formatUsd(pool.metrics.volume24hUsd) }}
              </div>
            </div>
            <div class="flex-1 min-w-[140px] p-4 sm:p-6">
              <div class="text-[16px] text-[#5E5F5D]">Daily Reward</div>
              <div
                class="text-[20px] font-bold text-[#E2E6E1]"
                style="
                  font-family:
                    Clash Display,
                    sans-serif;
                "
              >
                —
              </div>
            </div>
          </template>
          <template v-else>
            <div class="flex-1 min-w-[140px] p-4 sm:p-6 border-r border-[#383838] max-sm:border-r-0 max-sm:border-b max-sm:border-[#383838]">
              <div class="text-[16px] text-[#5E5F5D]">TVL</div>
              <div
                class="text-[20px] font-bold text-[#D5FF2F]"
                style="
                  font-family:
                    Clash Display,
                    sans-serif;
                "
              >
                {{ formatUsd(pool.metrics.tvlUsd) }}
              </div>
            </div>
            <div class="flex-1 min-w-[140px] p-4 sm:p-6 border-r border-[#383838] max-sm:border-r-0 max-sm:border-b max-sm:border-[#383838]">
              <div class="text-[16px] text-[#5E5F5D]">Volume 24h</div>
              <div
                class="text-[20px] font-bold text-[#E2E6E1]"
                style="
                  font-family:
                    Clash Display,
                    sans-serif;
                "
              >
                {{ formatUsd(pool.metrics.volume24hUsd) }}
              </div>
            </div>
            <div class="flex-1 min-w-[140px] p-4 sm:p-6">
              <div class="text-[16px] text-[#5E5F5D]">Fees 24h</div>
              <div
                class="text-[20px] font-bold text-[#E2E6E1]"
                style="
                  font-family:
                    Clash Display,
                    sans-serif;
                "
              >
                {{ formatUsd(pool.metrics.fees24hUsd) }}
              </div>
            </div>
          </template>
        </div>

        <!-- Second metrics row -->
        <div class="flex flex-wrap border-b border-[#383838]">
          <template v-if="isLendingPool(pool)">
            <div class="flex-1 min-w-[140px] p-4 sm:p-6 border-r border-[#383838] max-sm:border-r-0 max-sm:border-b max-sm:border-[#383838]">
              <div class="text-[16px] text-[#5E5F5D]">Total Share</div>
              <div
                class="text-[20px] font-bold text-[#E2E6E1]"
                style="
                  font-family:
                    Clash Display,
                    sans-serif;
                "
              >
                {{ formatUsd(pool.metrics.totalSuppliedUsd) }}
              </div>
            </div>
            <div class="flex-1 min-w-[140px] p-4 sm:p-6 border-r border-[#383838] max-sm:border-r-0 max-sm:border-b max-sm:border-[#383838]">
              <div class="text-[16px] text-[#5E5F5D]">Supply APY</div>
              <div
                class="text-[20px] font-bold text-[#E2E6E1]"
                style="
                  font-family:
                    Clash Display,
                    sans-serif;
                "
              >
                {{ formatPercentFromRatio(pool.metrics.supplyApy) }}
              </div>
            </div>
            <div class="flex-1 min-w-[140px] p-4 sm:p-6">
              <div class="text-[16px] text-[#5E5F5D]">Borrow APY</div>
              <div
                class="text-[20px] font-bold text-[#E2E6E1]"
                style="
                  font-family:
                    Clash Display,
                    sans-serif;
                "
              >
                {{ formatPercentFromRatio(pool.metrics.borrowApy) }}
              </div>
            </div>
          </template>
          <template v-else>
            <div class="flex-1 min-w-[140px] p-4 sm:p-6 border-r border-[#383838] max-sm:border-r-0 max-sm:border-b max-sm:border-[#383838]">
              <div class="text-[16px] text-[#5E5F5D]">Swaps 24h</div>
              <div
                class="text-[20px] font-bold text-[#E2E6E1]"
                style="
                  font-family:
                    Clash Display,
                    sans-serif;
                "
              >
                {{
                  formatNumber(
                    pool.metrics.swaps24h ?? pool.metrics.events24h,
                    0,
                  )
                }}
              </div>
            </div>
            <div class="flex-1 min-w-[140px] p-4 sm:p-6 border-r border-[#383838] max-sm:border-r-0 max-sm:border-b max-sm:border-[#383838]">
              <div class="text-[16px] text-[#5E5F5D]">Min Collateral</div>
              <div
                class="text-[20px] font-bold text-[#E2E6E1]"
                style="
                  font-family:
                    Clash Display,
                    sans-serif;
                "
              >
                {{ getMinCollateral(pool) }}
              </div>
            </div>
            <div class="flex-1 min-w-[140px] p-4 sm:p-6">
              <div class="text-[16px] text-[#5E5F5D]">Max Collateral</div>
              <div
                class="text-[20px] font-bold text-[#E2E6E1]"
                style="
                  font-family:
                    Clash Display,
                    sans-serif;
                "
              >
                {{ getMaxCollateral(pool) }}
              </div>
            </div>
          </template>
        </div>

        <!-- Description footer -->
        <div class="px-4 py-4 sm:px-6 sm:py-6 bg-[#252525] border-l-[1px] border-[#D5FF2F]">
          <p class="text-[16px] text-[#5E5F5D]">{{ poolDescription(pool) }}</p>
        </div>
      </div>

      <!-- RIGHT CARD -->
      <div
        class="bg-[#2A2A2A] border border-[#383838] rounded-xl flex flex-col"
      >
        <!-- Header row -->
        <div
          class="px-3 py-3 sm:px-4 sm:py-4 border-b border-[#383838] flex justify-between items-center"
        >
          <span
            class="text-[16px] sm:text-[20px] font-bold text-white"
            style="
              font-family:
                Clash Display,
                sans-serif;
            "
          >
            On-chain info — {{ protocol.name }}
          </span>
          <a href="#" class="text-[#D5FF2F] text-[14px] font-light"
            >Explore →</a
          >
        </div>

        <!-- Info rows -->
        <div class="flex flex-col flex-1 p-4 gap-2">
          <div class="flex justify-between items-center px-3 sm:px-6 bg-[rgba(226,230,225,0.05)] rounded-[4px] flex-1">
            <span class="text-[16px] text-[#5E5F5D]">Protocol</span>
            <span class="text-[14px] font-semibold text-[#E2E6E1]">{{ protocol.name }}</span>
          </div>
          <div class="flex justify-between items-center px-3 sm:px-6 bg-[rgba(226,230,225,0.05)] rounded-[4px] flex-1">
            <span class="text-[16px] text-[#5E5F5D]">Type</span>
            <span class="text-[14px] font-semibold text-[#E2E6E1]">{{ pool.type }}</span>
          </div>
          <div class="flex justify-between items-center px-3 sm:px-6 bg-[rgba(226,230,225,0.05)] rounded-[4px] flex-1">
            <span class="text-[16px] text-[#5E5F5D]">Chain</span>
            <span class="text-[14px] font-semibold text-[#E2E6E1]">{{ pool.chain }}</span>
          </div>
          <div class="flex justify-between items-center px-3 sm:px-6 bg-[rgba(226,230,225,0.05)] rounded-[4px] flex-1">
            <span class="text-[16px] text-[#5E5F5D]">Contract</span>
            <span class="text-[14px] font-semibold text-[#E2E6E1]">{{ shortAddress(pool.contractAddress) }}</span>
          </div>
          <div class="flex justify-between items-center px-3 sm:px-6 bg-[rgba(226,230,225,0.05)] rounded-[4px] flex-1">
            <span class="text-[16px] text-[#5E5F5D]">Updated</span>
            <span class="text-[14px] font-semibold text-[#E2E6E1]">{{ formatDate(pool.updatedAt) }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- BOTTOM — Assets table -->
    <div
      v-if="pool.reserves && pool.reserves.length"
      class="bg-[#2A2A2A] border border-[#383838] rounded-xl max-h-[288px] overflow-auto"
    >
      <table class="w-full text-[13px] min-w-[600px]">
        <thead>
          <tr class="text-[10px] uppercase tracking-wider text-[#838583] border-b border-[#383838]">
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
            class="border-b border-[#383838] hover:bg-[#1f1f1f]"
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

    <!-- LIQUIDITY & VOLUME — Coming soon -->
    <div class="flex flex-col gap-6">
      <div class="flex items-center gap-2">
        <span class="text-[16px] text-[#D5FF2F] font-normal whitespace-nowrap">Liquidity &amp; Volume</span>
        <div class="flex-1 h-px bg-[#7D922A]" />
        <span class="text-[14px] text-[#838583] font-light whitespace-nowrap">Pool-level metrics</span>
      </div>

      <div class="grid grid-cols-2 gap-6 max-sm:grid-cols-1">
        <!-- Liquidity card -->
        <div class="bg-[#2A2A2A] border border-[#383838] rounded-xl flex flex-col relative overflow-hidden">
          <div class="px-4 py-4 border-b border-[#383838] flex justify-between items-center">
            <span class="text-[20px] font-bold text-white" style="font-family: 'Clash Display', sans-serif">Liquidity</span>
            <div class="flex items-center gap-2">
              <span class="bg-[#373B26] border border-[#7D922A] rounded px-2 py-0.5 text-[#D5FF2F] text-[14px] font-light">W</span>
              <span class="text-[14px] text-[#5E5F5D] font-light">M</span>
            </div>
          </div>
          <div class="flex-1 min-h-[160px] p-4 flex flex-col justify-end gap-3">
            <div class="h-px bg-[#383838]" />
            <div class="flex justify-between text-[14px] text-[#717270] font-light">
              <span>Feb 11</span>
              <span>Feb 25</span>
              <span>Mar 12</span>
            </div>
          </div>
          <!-- OVERLAY -->
          <div class="absolute inset-0 bg-[rgba(14,14,14,0.35)] backdrop-blur-[1.5px] flex items-center justify-center pointer-events-none rounded-xl">
            <div class="flex items-center gap-2 bg-[#1a1a1a] border border-[#3a3a3a] rounded-full px-3 sm:px-[18px] py-2 text-[13px] sm:text-[15px] font-semibold text-[#9a9b99] tracking-[0.06em]">
              <span class="w-[6px] h-[6px] bg-[#d5ff2f] rounded-full animate-pulse" />
              Liquidity chart — Coming soon
            </div>
          </div>
        </div>

        <!-- Volume card -->
        <div class="bg-[#2A2A2A] border border-[#383838] rounded-xl flex flex-col relative overflow-hidden">
          <div class="px-4 py-4 border-b border-[#383838] flex justify-between items-center">
            <span class="text-[20px] font-bold text-white" style="font-family: 'Clash Display', sans-serif">Last 24h Volume</span>
            <div class="flex items-center gap-2">
              <span class="bg-[#373B26] border border-[#7D922A] rounded px-2 py-0.5 text-[#D5FF2F] text-[14px] font-light">W</span>
              <span class="text-[14px] text-[#5E5F5D] font-light">M</span>
            </div>
          </div>
          <div class="flex-1 min-h-[160px] p-4 flex flex-col gap-2">
            <span class="text-[22px] sm:text-[28px] font-bold text-[#D5FF2F]" style="font-family: 'Clash Display', sans-serif">$1.5M</span>
            <div class="flex items-end gap-3 flex-1">
              <div v-for="(day, idx) in ['MO','TU','WE','TH','FR','SA','SU']" :key="idx" class="flex flex-col items-stretch gap-1 flex-1">
                <div class="bg-[#D5FF2F] rounded" :style="{ height: [53,81,58,20,99,71,88][idx] * 0.7 + 'px' }" />
                <span class="text-[14px] text-[#717270] font-light text-center">{{ day }}</span>
              </div>
            </div>
          </div>
          <!-- OVERLAY -->
          <div class="absolute inset-0 bg-[rgba(14,14,14,0.35)] backdrop-blur-[1.5px] flex items-center justify-center pointer-events-none rounded-xl">
            <div class="flex items-center gap-2 bg-[#1a1a1a] border border-[#3a3a3a] rounded-full px-3 sm:px-[18px] py-2 text-[13px] sm:text-[15px] font-semibold text-[#9a9b99] tracking-[0.06em]">
              <span class="w-[6px] h-[6px] bg-[#d5ff2f] rounded-full animate-pulse" />
              Volume chart — Coming soon
            </div>
          </div>
        </div>
      </div>
    </div>

  </div>
</template>

<style scoped>
.animate-fade-in {
  animation: fadeIn 0.25s ease-out;
}
@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
