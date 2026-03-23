<script setup lang="ts">
import { ref, computed } from 'vue'
import logoUrl from '@/assets/dig-logo.svg?url'

// ─── TYPES ────────────────────────────────────────────────────────────────

interface Stat {
  title: string
  value: string
  change?: string
}

interface Wallet {
  id: number
  address: string
}

interface ReserveRow {
  symbol: string
  supplied: string
  borrowed: string
  backstop: string
  supplyApy: string
  borrowApy: string
  utilization?: string
}

interface ProtocolMetric {
  label: string
  value: string
  lime?: boolean
}

interface ProtocolInfo {
  key: string
  value: string
  lime?: boolean
}

interface Protocol {
  id: number
  name: string
  tvl: string
  type: string
  description: string
  loading?: boolean
  metrics: ProtocolMetric[]
  infoRows: ProtocolInfo[]
  poolRows?: ReserveRow[]
}

// ─── PROPS ────────────────────────────────────────────────────────────────

const props = defineProps<{
  stats: Stat[]
  wallets: Wallet[]
  totalBalance: string
  description?: string
  // données live injectées depuis l'indexer
  blendMetrics?: ProtocolMetric[]
  blendInfoRows?: ProtocolInfo[]
  blendPoolRows?: ReserveRow[]
}>()

const stats = props.stats
const wallets = props.wallets
const totalBalance = props.totalBalance

const selectedWallet = ref<Wallet | null>(null)

// ─── PROTOCOLES ───────────────────────────────────────────────────────────
// Les metrics/infoRows/poolRows de Blend V2 sont injectés via props
// quand les données live arrivent — le reste est statique en attendant

const selectedId = ref<number>(1)

const protocols = ref<Protocol[]>([
  {
    id: 1,
    name: 'Blend V2',
    tvl: '—',
    type: 'Lending Protocol',
    description: 'Decentralized lending protocol by Script3. Isolated pools with backstop liquidity module. The leading protocol on Soroban by TVL.',
    metrics: [
      { label: 'TVL',          value: '—', lime: true },
      { label: 'USDC Supplied',value: '—' },
      { label: 'USDC Borrowed',value: '—' },
      { label: 'EURC Supplied',value: '—' },
      { label: 'USDC APY',     value: '—' },
      { label: 'EURC APY',     value: '—' },
    ],
    infoRows: [
      { key: 'Network',        value: 'Stellar (Soroban)' },
      { key: 'Audit',          value: '✓ Verified', lime: true },
      { key: 'Composability',  value: 'High — Soroban' },
      { key: 'Avg Tx Fee',     value: '~$0.00001' },
      { key: 'Open Source',    value: 'Yes', lime: true },
      { key: 'Underlying',     value: 'Isolated Pools' },
    ],
    poolRows: [],
  },
  {
    id: 2,
    name: 'Aquarius',
    tvl: '—',
    type: 'DEX / AMM',
    description: 'Aquarius is the liquidity management layer for Stellar. On-chain voting for liquidity rewards, AMM pools, and AQUA token governance.',
    metrics: [
      { label: 'TVL',        value: '—', lime: true },
      { label: 'Pools',      value: '—' },
      { label: 'Volume 24h', value: '—' },
      { label: 'Rewards',    value: '—' },
      { label: 'APR avg',    value: '—' },
      { label: 'Pairs',      value: '—' },
    ],
    infoRows: [
      { key: 'Network',       value: 'Stellar (Soroban)' },
      { key: 'Audit',         value: '✓ Verified', lime: true },
      { key: 'Composability', value: 'High' },
      { key: 'Avg Tx Fee',    value: '~$0.00001' },
      { key: 'Open Source',   value: 'Yes', lime: true },
      { key: 'Type',          value: 'AMM / Governance' },
    ],
  },
  {
    id: 3,
    name: 'Soroswap',
    tvl: '—',
    type: 'AMM / DEX',
    description: 'Uniswap-inspired AMM built natively on Soroban. Permissionless token swaps and liquidity provision on Stellar.',
    metrics: [
      { label: 'TVL',        value: '—', lime: true },
      { label: 'Pairs',      value: '—' },
      { label: 'Volume 24h', value: '—' },
      { label: 'Fees',       value: '—' },
      { label: 'APR avg',    value: '—' },
      { label: 'Protocol',   value: 'Soroban' },
    ],
    infoRows: [
      { key: 'Network',       value: 'Stellar (Soroban)' },
      { key: 'Audit',         value: '✓ Verified', lime: true },
      { key: 'Composability', value: 'Medium' },
      { key: 'Avg Tx Fee',    value: '~$0.00001' },
      { key: 'Open Source',   value: 'Yes', lime: true },
      { key: 'Type',          value: 'Uniswap V2 fork' },
    ],
  },
  {
    id: 4,
    name: 'DeFindex',
    tvl: '—',
    type: 'Yield Vaults',
    description: 'Customizable DeFi strategies on Soroban. Automated yield vaults built for the Stellar ecosystem.',
    metrics: [
      { label: 'TVL',        value: '—', lime: true },
      { label: 'Vaults',     value: '—' },
      { label: 'APY avg',    value: '—' },
      { label: 'Strategies', value: '—' },
      { label: 'Depositors', value: '—' },
      { label: 'Protocol',   value: 'Soroban' },
    ],
    infoRows: [
      { key: 'Network',       value: 'Stellar (Soroban)' },
      { key: 'Audit',         value: 'In progress' },
      { key: 'Composability', value: 'High' },
      { key: 'Avg Tx Fee',    value: '~$0.00001' },
      { key: 'Open Source',   value: 'Yes', lime: true },
      { key: 'Type',          value: 'Yield Aggregator' },
    ],
  },
])

const selectedProtocol = computed(() =>
  protocols.value.find(p => p.id === selectedId.value)
)
</script>

<template>
  <div class="flex flex-col gap-6 p-5 min-h-screen w-full" style="background-color: #141414; color: #E2E6E1;">

    <!-- HEADER -->
    <div class="flex items-center justify-between gap-6">
      <div class="flex items-center gap-3 flex-shrink-0">
        <div
          class="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 overflow-hidden"
          style="background-color: #373B26; border: 1px solid #D5FF2F;"
        >
          <img :src="logoUrl" alt="logo" style="width: 24px; height: 24px; object-fit: contain;" />
        </div>
        <div class="flex items-center gap-2">
          <h1 class="font-semibold tracking-wide" style="color: #FFFFFF !important; font-size: 1.25rem; margin: 0;">
            Stellar Grant by Dig
          </h1>
          <span
            class="text-xs font-semibold px-2 py-0.5 rounded"
            style="background-color: #373B26; color: #D5FF2F; border: 1px solid #D5FF2F; letter-spacing: 0.08em;"
          >
            BETA
          </span>
        </div>
      </div>
      <p class="text-xs text-right" style="color: #9A9B99; max-width: 36rem;">
        {{ description ?? 'Stellar DeFi ecosystem built on Soroban smart contracts — TVL grew 193% in 2025. Tracking Blend V2, Aquarius, Soroswap & DeFindex across $88M+ combined TVL.' }}
      </p>
    </div>

    <!-- STATS -->
    <div class="grid grid-cols-2 md:grid-cols-8 gap-2">
      <div
        v-for="stat in stats"
        :key="stat.title"
        class="rounded-xl p-4 flex flex-col gap-1"
        style="background-color: #1a1a1a; border: 1px solid rgba(213,255,47,0.1);"
      >
        <div class="text-xs uppercase tracking-widest" style="color: #9A9B99;">{{ stat.title }}</div>
        <div class="text-base font-bold text-white" style="font-variant-numeric: tabular-nums; letter-spacing: -0.02em;">
          {{ stat.value }}
        </div>
        <div
          v-if="stat.change"
          class="text-xs font-medium"
          :style="stat.change.startsWith('-') ? 'color: #FF5A5A;' : 'color: #D5FF2F;'"
        >
          {{ stat.change }}
        </div>
      </div>
    </div>

    <!-- WALLET SECTION -->
    <div>
      <div class="flex items-center justify-between mb-3">
        <span class="text-xs font-bold tracking-widest uppercase" style="color: #D5FF2F;">Stellar Multi-Wallet</span>
        <span class="text-xs" style="color: #9A9B99;">TVL · Protocol comparison</span>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">

        <div class="rounded-xl p-5 flex flex-col gap-4" style="background-color: #1a1a1a; border: 1px solid #2a2a2a;">
          <div>
            <p class="text-xs mb-1" style="color: #9A9B99;">Multi-Wallet Amount</p>
            <p class="text-4xl font-bold tracking-tight" style="color: #FFFFFF;">${{ totalBalance }}</p>
          </div>
          <div class="flex flex-col gap-2">
            <div
              v-for="w in wallets"
              :key="w.id"
              class="flex items-center justify-between rounded-lg px-3 py-2"
              style="background-color: #222; border: 1px solid #2a2a2a;"
            >
              <span class="text-xs font-mono" style="color: #888;">
                <strong style="color: #E2E6E1;">Wallet {{ w.id }}</strong> : {{ w.address }}
              </span>
              <button
                class="text-xs px-2.5 py-1 rounded"
                style="color: #D5FF2F; border: 1px solid rgba(213,255,47,0.3); background: transparent; cursor: pointer;"
                @click="selectedWallet = w"
              >
                Select ›
              </button>
            </div>
            <button class="text-xs text-left mt-1" style="color: #D5FF2F; background: none; border: none; cursor: pointer;">
              + Add Stellar Wallet
            </button>
          </div>
        </div>

        <div class="rounded-xl p-5 flex flex-col gap-3" style="background-color: #1a1a1a; border: 1px solid #2a2a2a;">
          <p class="text-xs" style="color: #9A9B99;">Notifications</p>
          <div class="flex items-center justify-between py-2" style="border-bottom: 1px solid #2a2a2a;">
            <span class="text-xs" style="color: #888;"><strong style="color: #E2E6E1;">Wallet 1</strong> : Protocol · Blend V2 · Fixed Pool ›</span>
            <span class="text-xs font-semibold" style="color: #60A5FA;">Rebalancing</span>
          </div>
          <div class="flex items-center justify-between py-2" style="border-bottom: 1px solid #2a2a2a;">
            <span class="text-xs" style="color: #888;"><strong style="color: #E2E6E1;">Wallet 2</strong> : Protocol · Blend V2 · Fixed Pool ›</span>
            <span class="text-xs font-semibold" style="color: #D5FF2F;">Claim</span>
          </div>
          <div class="flex items-center justify-between py-2" style="border-bottom: 1px solid #2a2a2a;">
            <span class="text-xs" style="color: #888;"><strong style="color: #E2E6E1;">Wallet 3</strong> : Protocol · Aquarius · PYUSD/USDC ›</span>
            <span class="text-xs font-semibold" style="color: #FF5A5A;">Unbalanced</span>
          </div>
          <div class="flex flex-col gap-2 mt-2">
            <button class="text-xs font-semibold px-4 py-2 rounded-lg w-fit"
              style="background-color: #373B26; color: #D5FF2F; border: 1px solid #D5FF2F; letter-spacing: 0.05em; cursor: pointer;">
              Rebalance Wallet 1
            </button>
            <button class="text-xs text-left" style="color: #D5FF2F; background: none; border: none; cursor: pointer;">
              See all notifications
            </button>
          </div>
        </div>

      </div>
    </div>

    <!-- PROTOCOL VIEW -->
    <div>
      <div class="flex items-center justify-between mb-3">
        <span class="text-xs font-bold tracking-widest uppercase" style="color: #D5FF2F;">Protocol View</span>
        <span class="text-xs" style="color: #9A9B99;">Select a protocol</span>
      </div>

      <!-- TABS -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
        <div
          v-for="p in protocols"
          :key="p.id"
          class="rounded-xl p-3 flex items-center gap-3 cursor-pointer transition-all"
          :style="selectedId === p.id
            ? 'background-color: #1a1f0e; border: 1px solid #D5FF2F;'
            : 'background-color: #1a1a1a; border: 1px solid #2a2a2a;'"
          @click="selectedId = p.id"
        >
          <div class="flex flex-col flex-1">
            <div class="flex items-center justify-between">
              <span class="text-sm font-bold" :style="selectedId === p.id ? 'color: #D5FF2F;' : 'color: #E2E6E1;'">
                {{ p.name }}
              </span>
              <span class="text-xs font-semibold" :style="selectedId === p.id ? 'color: #D5FF2F;' : 'color: #9A9B99;'">
                {{ p.tvl }}
              </span>
            </div>
            <span class="text-xs" style="color: #9A9B99;">{{ p.type }} · TVL</span>
          </div>
        </div>
      </div>

      <!-- DÉTAIL DYNAMIQUE -->
      <div v-if="selectedProtocol" class="grid grid-cols-1 md:grid-cols-2 gap-3">

        <!-- GAUCHE : métriques -->
        <div class="rounded-xl p-4 flex flex-col gap-3" style="background-color: #1a1a1a; border: 1px solid #2a2a2a;">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="text-sm font-bold" style="color: #E2E6E1;">{{ selectedProtocol.name }}</span>
              <span class="text-xs font-bold px-2 py-0.5 rounded"
                style="background-color: #373B26; color: #D5FF2F; border: 1px solid rgba(213,255,47,0.3);">
                {{ selectedProtocol.type }}
              </span>
            </div>
            <button class="text-xs" style="color: #D5FF2F; background: none; border: none; cursor: pointer;">
              Explore →
            </button>
          </div>

          <!-- Metrics grid -->
          <div class="grid grid-cols-3 gap-2">
            <div
              v-for="metric in selectedProtocol.metrics"
              :key="metric.label"
              class="rounded-lg p-3 flex flex-col gap-1"
              style="background-color: #222;"
            >
              <span class="text-xs" style="color: #9A9B99;">{{ metric.label }}</span>
              <span class="text-base font-bold" :style="metric.lime ? 'color: #D5FF2F;' : 'color: #E2E6E1;'">
                {{ metric.value }}
              </span>
            </div>
          </div>

          <!-- Description -->
          <p class="text-xs leading-relaxed rounded-lg p-3"
            style="color: #9A9B99; background-color: #222; border-left: 2px solid #D5FF2F;">
            {{ selectedProtocol.description }}
          </p>
        </div>

        <!-- DROITE : on-chain info -->
        <div class="rounded-xl p-4 flex flex-col gap-1" style="background-color: #1a1a1a; border: 1px solid #2a2a2a;">
          <div class="flex items-center justify-between mb-3">
            <span class="text-sm font-semibold" style="color: #E2E6E1;">
              On-chain info — {{ selectedProtocol.name }}
            </span>
            <button class="text-xs" style="color: #D5FF2F; background: none; border: none; cursor: pointer;">
              Explore →
            </button>
          </div>
          <div
            v-for="row in selectedProtocol.infoRows"
            :key="row.key"
            class="flex items-center justify-between py-2"
            style="border-bottom: 1px solid #2a2a2a;"
          >
            <span class="text-xs" style="color: #9A9B99;">{{ row.key }}</span>
            <span class="text-xs font-medium" :style="row.lime ? 'color: #D5FF2F;' : 'color: #E2E6E1;'">
              {{ row.value }}
            </span>
          </div>
        </div>

      </div>

      <!-- TABLE DES RESERVES (Blend V2 uniquement pour l'instant) -->
      <div
        v-if="selectedProtocol?.poolRows && selectedProtocol.poolRows.length > 0"
        class="rounded-xl overflow-hidden mt-3"
        style="background-color: #1a1a1a; border: 1px solid #2a2a2a;"
      >
        <table class="w-full border-collapse" style="font-size: 12px;">
          <thead>
            <tr style="border-bottom: 1px solid #2a2a2a;">
              <th class="px-4 py-3 text-left uppercase tracking-widest font-medium" style="color: #9A9B99;">Asset</th>
              <th class="px-4 py-3 text-left uppercase tracking-widest font-medium" style="color: #9A9B99;">Supplied</th>
              <th class="px-4 py-3 text-left uppercase tracking-widest font-medium" style="color: #9A9B99;">Borrowed</th>
              <th class="px-4 py-3 text-left uppercase tracking-widest font-medium" style="color: #9A9B99;">Backstop</th>
              <th class="px-4 py-3 text-left uppercase tracking-widest font-medium" style="color: #9A9B99;">Supply APY</th>
              <th class="px-4 py-3 text-left uppercase tracking-widest font-medium" style="color: #9A9B99;">Borrow APY</th>
              <th class="px-4 py-3 text-left uppercase tracking-widest font-medium" style="color: #9A9B99;">Utilization</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in selectedProtocol.poolRows"
              :key="row.symbol"
              style="border-bottom: 1px solid #2a2a2a;"
            >
              <td class="px-4 py-3 font-semibold" style="color: #E2E6E1;">{{ row.symbol }}</td>
              <td class="px-4 py-3" style="color: #D5FF2F; font-weight: 600;">{{ row.supplied }}</td>
              <td class="px-4 py-3" style="color: #E2E6E1;">{{ row.borrowed }}</td>
              <td class="px-4 py-3" style="color: #888;">{{ row.backstop }}</td>
              <td class="px-4 py-3" style="color: #D5FF2F; font-weight: 600;">{{ row.supplyApy }}</td>
              <td class="px-4 py-3" style="color: #E2E6E1;">{{ row.borrowApy }}</td>
              <td class="px-4 py-3">
                <div v-if="row.utilization" class="flex items-center gap-2">
                  <div class="flex-1 rounded-full overflow-hidden" style="background-color: #2a2a2a; height: 4px;">
                    <div
                      class="h-full rounded-full"
                      style="background-color: #D5FF2F; transition: width 0.3s;"
                      :style="`width: ${row.utilization}`"
                    />
                  </div>
                  <span style="color: #888; font-size: 11px;">{{ row.utilization }}</span>
                </div>
                <span v-else style="color: #9A9B99;">—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

    </div>

  </div>
</template>

<style scoped>
</style>