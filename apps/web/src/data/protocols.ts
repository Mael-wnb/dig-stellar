// apps/web/src/data/protocols.ts
// ─── TYPES ───────────────────────────────────────────────────────────────────



export interface Metric {
  label: string
  value: string
  lime?: boolean
}

export interface InfoRow {
  key: string
  value: string
  lime?: boolean
}

export interface Reserve {
  symbol: string
  project: string
  supplied: string
  borrowed: string
  collateral: string
  liability: string
  supplyApy: string
  borrowApy: string
}

export interface Pool {
  id: string
  name: string
  tvl: string
  metrics: Metric[]
  description: string
  onChainInfo: InfoRow[]
  reserves: Reserve[]
}

export interface Protocol {
  id: string
  name: string
  type: string
  icon: string
  iconColor: string
  iconBg: string
  tvl: string
  pools: Pool[]
}

export interface Stat {
  title: string
  value: string
  change?: string
}

export interface Wallet {
  id: number
  address: string
  amount: string
  active?: boolean
}

export interface Notification {
  wallet: string
  protocol: string
  status: string
  color: string
}

// ─── PROTOCOLS DATA ──────────────────────────────────────────────────────────
// Each protocol has pools. Each pool has its own metrics, onChainInfo, and reserves.
// Replace values with live API data by patching the relevant protocol/pool object.

export const PROTOCOLS: Protocol[] = [
  {
    id: 'blend',
    name: 'Blend V2',
    type: 'Lending Protocol',
    icon: '◈',
    iconColor: '#2cb13e',
    iconBg: '#1a2a10',
    tvl: '$45.2M',
    pools: [
      {
        id: 'blend-fixed',
        name: 'Fixed Pool',
        tvl: '$45.2M',
        metrics: [
          { label: 'TVL',        value: '$45.2M',  lime: true },
          { label: 'Supplied',   value: '$122.8M' },
          { label: 'Borrowed',   value: '$33.4M' },
        ],
        description:
          'A decentralized lending pool on the Stellar network built on the Blend V2 protocol, supporting XLM, USDC, and EURC. Users can supply assets to earn yield or borrow against their collateral, with risk managed through oracle-based pricing and automated liquidations. A backstop module protects lenders against bad debt while BLND token emissions reward participants.',
        onChainInfo: [
          { key: 'Chain',           value: 'Stellar' },
          { key: 'Type',            value: 'Lending' },
          { key: 'Pool Hash',       value: '745a7...72814' },
          { key: 'Pool address',    value: 'CAJJ...BXBD' },
          { key: 'Avg Supply APY',  value: '0.05%' },
          { key: 'Avg Borrow APY',  value: '0.05%' },
          { key: 'Max Positions',   value: '6' },
          { key: 'Min Collateral',  value: '$5' },
        ],
        reserves: [
          { symbol: 'XLM',  project: 'stellar.org', supplied: '490.34M', borrowed: '1.51M',  collateral: '75.00%', liability: '133.33%', supplyApy: '0.00%',  borrowApy: '0.10%'  },
          { symbol: 'USDC', project: 'circle.com',  supplied: '42.46M',  borrowed: '33.98M', collateral: '95.00%', liability: '105.26%', supplyApy: '10.21%', borrowApy: '16.41%' },
          { symbol: 'EURC', project: 'circle.com',  supplied: '2.36M',   borrowed: '1.86M',  collateral: '95.00%', liability: '105.26%', supplyApy: '9.87%',  borrowApy: '16.13%' },
        ],
      },
      {
        id: 'blend-orbit',
        name: 'Orbit Pool',
        tvl: '$45.2M',
        metrics: [
          { label: 'TVL',        value: '$45.2M',  lime: true },
          { label: 'Supplied',   value: '$98.1M' },
          { label: 'Borrowed',   value: '$21.3M' },
        ],
        description:
          `A decentralized lending pool on the Stellar network built on the Blend V2 protocol, focused on real-world asset-backed stablecoins (oUSD, USTRY, and CETES). Users can supply assets to earn yield or borrow against their collateral, with risk managed through oracle-based pricing and automated liquidations. A backstop module protects lenders against bad debt while BLND token emissions reward participants.`,
        onChainInfo: [
          { key: 'Chain',           value: 'Stellar' },
          { key: 'Type',            value: 'Lending' },
          { key: 'Pool Hash',       value: 'a41fc...1350e' },
          { key: 'Pool address',    value: 'CAE7...YHXC' },
          { key: 'Avg Supply APY',  value: '0.04%' },
          { key: 'Avg Borrow APY',  value: '0.04%' },
          { key: 'Max Positions',   value: '8' },
          { key: 'Min Collateral',  value: '$10' },
        ],
        reserves: [
          { symbol: 'XLM',  project: 'stellar.org', supplied: '320.1M', borrowed: '900B',   collateral: '70.00%', liability: '133.33%', supplyApy: '0.00%',  borrowApy: '0.10%'  },
          { symbol: 'USDC', project: 'circle.com',  supplied: '290.4M', borrowed: '22.1M',  collateral: '90.00%', liability: '105.26%', supplyApy: '8.40%',  borrowApy: '14.20%' },
        ],
      },
      {
        id: 'blend-etherfuse',
        name: 'Etherfuse Pool',
        tvl: '$45.2M',
        metrics: [
          { label: 'TVL',        value: '$45.2M',  lime: true },
          { label: 'Supplied',   value: '$55.6M' },
          { label: 'Borrowed',   value: '$11.9M' },
        ],
        description:
          'A decentralized lending pool on the Stellar network built on the Blend V2 protocol, focused on tokenized government bond assets (CETES, USTRY, and TESOURO) alongside USDC and XLM. Users can supply assets to earn yield or borrow against their collateral, with risk managed through oracle-based pricing and automated liquidations. A backstop module protects lenders against bad debt while BLND token emissions reward participants.',
        onChainInfo: [
          { key: 'Chain',           value: 'Stellar' },
          { key: 'Type',            value: 'Lending' },
          { key: 'Pool Hash',       value: 'a41fc...c1350' },
          { key: 'Pool address',    value: 'CDMA...PVAI' },
          { key: 'Avg Supply APY',  value: '0.06%' },
          { key: 'Avg Borrow APY',  value: '0.06%' },
          { key: 'Max Positions',   value: '5' },
          { key: 'Min Collateral',  value: '$25' },
        ],
        reserves: [
          { symbol: 'CETES', project: 'etherfuse.io', supplied: '48.2M', borrowed: '9.1M', collateral: '80.00%', liability: '125.00%', supplyApy: '8.20%', borrowApy: '14.50%' },
          { symbol: 'USDC',  project: 'circle.com',   supplied: '7.4M',  borrowed: '2.8M', collateral: '92.00%', liability: '105.26%', supplyApy: '7.80%', borrowApy: '13.90%' },
        ],
      },
    ],
  },

  {
    id: 'aquarius',
    name: 'Aquarius',
    type: 'DEX / AMM',
    icon: '◎',
    iconColor: '#872ab0',
    iconBg: '#1a1a2e',
    tvl: '$36.3M',
    pools: [
      {
        id: 'aq-pyusd',
        name: 'PYUSD/USDC',
        tvl: '$36.3M',
        metrics: [
          { label: 'TVL',          value: '$36.3M',  lime: true },
          { label: 'Swap 24h',     value: '$4,500' },
          { label: 'Volume 24h',   value: '$1.5M' },
          
        ],
        description:
          'Stablecoin pair optimized for low slippage. AQUA governance rewards distributed to LPs. High volume due to PYUSD adoption on Stellar.',
        onChainInfo: [
          { key: 'Type',         value: 'Stable' },
          { key: 'Fee',          value: '0.10%' },
          { key: 'Total PYUSD',  value: '4,103,701.40' },
          { key: 'Total USDC',   value: '3,924,453.50' },
          { key: 'Fees 24h',     value: '$4,500' },
          { key: 'Pool hash',    value: '766a7...72924' },
          { key: 'Pool address', value: 'CDMH5...I7SUW' },
        ],
        reserves: [
          { symbol: 'PYUSD', project: 'paypal.com', supplied: '4,103,701', borrowed: '—', collateral: '—', liability: '—', supplyApy: '—', borrowApy: '—' },
          { symbol: 'USDC',  project: 'circle.com', supplied: '3,924,453', borrowed: '—', collateral: '—', liability: '—', supplyApy: '—', borrowApy: '—' },
        ],
      },
      {
        id: 'aq-xlm-slvbtc',
        name: 'XLM/SolvBTC',
        tvl: '$36.3M',
        metrics: [
          { label: 'TVL',          value: '$36.3M', lime: true },
          { label: 'Swap 24h',     value: '$4,500' },
          { label: 'Volume 24h',   value: '$1.5M' },
        ],
        description:
          `Volatile pair bridging Stellar's native XLM with SolvBTC, a liquid BTC staking token. High APR driven by AQUA emissions.`,
        onChainInfo: [
          { key: 'Type',            value: 'Volatile' },
          { key: 'Fee',             value: '0.30%' },
          { key: 'Total XLM',       value: '18,500,000' },
          { key: 'Total SolvBTC',   value: '17,800,000' },
          { key: 'Fees 24h',     value: '$4,500' },
          { key: 'Pool hash',       value: 'b2e02...ab7f0' },
          { key: 'Pool address',    value: 'CD2O2...JP5F6' },
        ],
        reserves: [
          { symbol: 'XLM',     project: 'stellar.org', supplied: '$18.5M', borrowed: '—', collateral: '—', liability: '—', supplyApy: '—', borrowApy: '—' },
          { symbol: 'SolvBTC', project: 'solv.finance', supplied: '$17.8M', borrowed: '—', collateral: '—', liability: '—', supplyApy: '—', borrowApy: '—' },
        ],
      },
      {
        id: 'aq-xlm-usdc',
        name: 'XLM/USDC',
        tvl: '$36.3M',
        metrics: [
          { label: 'TVL',          value: '$36.3M', lime: true },
          { label: 'Swap 24h',     value: '$4,500' },
          { label: 'Volume 24h',   value: '$1.5M' },
        ],
        description:
          'The most liquid pair on Aquarius. XLM/USDC is the primary gateway for Stellar DeFi entry. Consistent high volume and stable AQUA rewards.',
        onChainInfo: [
          { key: 'Type',         value: 'Volatile' },
          { key: 'Fee',          value: '0.30%' },
          { key: 'Total XLM',    value: '18,100,000' },
          { key: 'Total USDC',   value: '18,200,000' },
          { key: 'Fees 24h',     value: '$4,500' },
          { key: 'Pool hash',    value: 'b2e02...ab7f0' },
          { key: 'Pool address', value: 'CA6PU...CCJBE' },
        ],
        reserves: [
          { symbol: 'XLM',  project: 'stellar.org', supplied: '$18.1M', borrowed: '—', collateral: '—', liability: '—', supplyApy: '—', borrowApy: '—' },
          { symbol: 'USDC', project: 'circle.com',  supplied: '$18.2M', borrowed: '—', collateral: '—', liability: '—', supplyApy: '—', borrowApy: '—' },
        ],
      },
      {
        id: 'aq-xslvbtc-slvbtc',
        name: 'xSolvBTC/SolvBTC',
        tvl: '$36.3M',
        metrics: [
          { label: 'TVL',          value: '$36.3M', lime: true },
          { label: 'Swap 24h',     value: '$4,500' },
          { label: 'Volume 24h',   value: '$1.5M' },
         
        ],
        description:
          'Liquidity pool for staked and unstaked SolvBTC. Enables efficient swaps between liquid staking derivatives with minimal slippage.',
        onChainInfo: [
          { key: 'Type',           value: 'Stable' },
          { key: 'Fee',            value: '0.05%' },
          { key: 'Total xSolvBTC', value: '18,300,000' },
          { key: 'Total SolvBTC',  value: '18,000,000' },
          { key: 'Fees 24h',     value: '$4,500' },
          { key: 'Pool hash',      value: 'f56e6...f4ba7' },
          { key: 'Pool address',   value: 'CCNXG...ORQ2A' },
        ],
        reserves: [
          { symbol: 'xSolvBTC', project: 'solv.finance', supplied: '$18.3M', borrowed: '—', collateral: '—', liability: '—', supplyApy: '—', borrowApy: '—' },
          { symbol: 'SolvBTC',  project: 'solv.finance', supplied: '$18.0M', borrowed: '—', collateral: '—', liability: '—', supplyApy: '—', borrowApy: '—' },
        ],
      },
    ],
  },

  {
    id: 'soroswap',
    name: 'Soroswap',
    type: 'AMM / DEX',
    icon: '⬡',
    iconColor: '#8865dd',
    iconBg: '#1a2020',
    tvl: '$800K',
    pools: [
      {
        id: 'soro-xlm-usdc',
        name: 'XLM/USDC',
        tvl: '$800K',
        metrics: [
          { label: 'TVL',        value: '$800K', lime: true },
          { label: 'Swap 24h',     value: '$4,500' },
          { label: 'Volume 24h',   value: '$1.5M' },
        ],
        description:
          'Uniswap V2-style AMM on Soroban. Permissionless pair creation and liquidity provision. XLM/USDC is the highest TVL pair.',
        onChainInfo: [
          { key: 'Type',           value: 'Stable' },
          { key: 'Fee',            value: '0.05%' },
          { key: 'Total XLM', value: '18,300,000' },
          { key: 'Total USDC',  value: '18,000,000' },
          { key: 'Fees 24h',     value: '$4,500' },
          { key: 'Pool hash',      value: 'f56e6...f4ba7' },
          { key: 'Pool address',   value: 'CCNXG...ORQ2A' },
        ],
        reserves: [
          { symbol: 'XLM',  project: 'stellar.org', supplied: '$400K', borrowed: '—', collateral: '—', liability: '—', supplyApy: '14.2%', borrowApy: '—' },
          { symbol: 'USDC', project: 'circle.com',  supplied: '$400K', borrowed: '—', collateral: '—', liability: '—', supplyApy: '14.2%', borrowApy: '—' },
        ],
      },
      {
        id: 'soro-usdc-eurc',
        name: 'USDC/EURC',
        tvl: '$800K',
        metrics: [
         { label: 'TVL',        value: '$800K', lime: true },
          { label: 'Swap 24h',     value: '$4,500' },
          { label: 'Volume 24h',   value: '$1.5M' },
        ],
        description:
          'Stablecoin pair with minimal slippage optimized for cross-currency stablecoin swaps between USDC and EURC.',
        onChainInfo: [
          { key: 'Type',           value: 'Stable' },
          { key: 'Fee',            value: '0.05%' },
          { key: 'Total XLM', value: '18,300,000' },
          { key: 'Total USDC',  value: '18,000,000' },
          { key: 'Fees 24h',     value: '$4,500' },
          { key: 'Pool hash',      value: 'f56e6...f4ba7' },
          { key: 'Pool address',   value: 'CCNXG...ORQ2A' },
        ],
        reserves: [
          { symbol: 'USDC', project: 'circle.com', supplied: '$400K', borrowed: '—', collateral: '—', liability: '—', supplyApy: '9.4%', borrowApy: '—' },
          { symbol: 'EURC', project: 'circle.com', supplied: '$400K', borrowed: '—', collateral: '—', liability: '—', supplyApy: '9.4%', borrowApy: '—' },
        ],
      },
      {
        id: 'soroswap-native-usdc-pair',
        name: 'native-USDC',
        tvl: '$800K',
        metrics: [
          { label: 'TVL',        value: '$800K', lime: true },
          { label: 'Swap 24h',     value: '$4,500' },
          { label: 'Volume 24h',   value: '$1.5M' },
        ],
        description:
          'native-USDC AMM pool on Soroswap (XLM/USDC). Symbol: native-USDC-SOROSWAP-LP. Pure swap liquidity — no supply/borrow APY.',
        onChainInfo: [
          { key: 'Type',           value: 'Stable' },
          { key: 'Fee',            value: '0.05%' },
          { key: 'Total XLM', value: '18,300,000' },
          { key: 'Total USDC',  value: '18,000,000' },
          { key: 'Fees 24h',     value: '$4,500' },
          { key: 'Pool hash',      value: 'f56e6...f4ba7' },
          { key: 'Pool address',   value: 'CCNXG...ORQ2A' },
        ],
        reserves: [
          { symbol: 'XLM',  project: 'stellar.org', supplied: '$400K', borrowed: '—', collateral: '—', liability: '—', supplyApy: '—', borrowApy: '—' },
          { symbol: 'USDC', project: 'circle.com',  supplied: '$400K', borrowed: '—', collateral: '—', liability: '—', supplyApy: '—', borrowApy: '—' },
        ],
      },
      {
        id: 'soro-xlm-xlmusdc',
        name: 'XLM/USDC',
        tvl: '$800K',
        metrics: [
         { label: 'TVL',        value: '$800K', lime: true },
          { label: 'Swap 24h',     value: '$4,500' },
          { label: 'Volume 24h',   value: '$1.5M' },
        ],
        description:
          'Secondary XLM/USDC pool with different fee tier. Attracts traders seeking alternative routing for better execution on large orders.',
        onChainInfo: [
           { key: 'Type',           value: 'Stable' },
          { key: 'Fee',            value: '0.05%' },
          { key: 'Total XLM', value: '18,300,000' },
          { key: 'Total USDC',  value: '18,000,000' },
          { key: 'Fees 24h',     value: '$4,500' },
          { key: 'Pool hash',      value: 'f56e6...f4ba7' },
          { key: 'Pool address',   value: 'CCNXG...ORQ2A' },
        ],
        reserves: [
          { symbol: 'XLM',  project: 'stellar.org', supplied: '$400K', borrowed: '—', collateral: '—', liability: '—', supplyApy: '13.0%', borrowApy: '—' },
          { symbol: 'USDC', project: 'circle.com',  supplied: '$400K', borrowed: '—', collateral: '—', liability: '—', supplyApy: '13.0%', borrowApy: '—' },
        ],
      },
    ],
  },

  {
    id: 'defindex',
    name: 'More Soon',
    type: 'Stellar DeFi',
    icon: '✦',
    iconColor: '#F59E0B',
    iconBg: '#221a10',
    tvl: '+160M$',
    pools: [
     
    ],
  },
]

export const STATS: Stat[] = [
  { title: 'XLM Price',       value: '$0.1184',    change: '▲ 2.4%' },
  { title: 'Stellar TVL',     value: '$88.4M',     change: '▲ 193% 2025' },
  { title: 'Accounts', value: '569.2K',     change: '▲ 0.3%' },
  { title: 'Stable MCap', value: '$243.6M',    change: '▲ 53% YoY' },
  { title: '24h DEX Vol',     value: '$1.5M',      change: '▲ 8.2%' },
  { title: 'Protocols',       value: '4',          change: 'tracked' },
  { title: 'USDC Supply',     value: '$223.1M',    change: '▲ 45% YoY' },
  { title: 'Avg Tx Fee',      value: '$0.00001',   change: 'stable' },
]

export const WALLETS: Wallet[] = [
  { id: 1, address: 'GDRQ7Z…QH5EX4', amount: '$3,523.89' },
  { id: 2, address: 'GB2L3V…D4R2QK6', amount: '$3,523.89', active: true },
  { id: 3, address: 'GCFZ6Q…6L4F7V2', amount: '$3,523.89' },
  { id: 4, address: 'GDKX7R…5L3N2X7', amount: '$3,523.89' },
]

export const NOTIFICATIONS: Notification[] = [
  { wallet: 'Wallet 1', protocol: 'Blend V2 · Fixed Pool', status: 'Rebalancing', color: '#60A5FA' },
  { wallet: 'Wallet 2', protocol: 'Blend V2 · Fixed Pool', status: 'Claim',        color: '#D5FF2F' },
  { wallet: 'Wallet 3', protocol: 'Aquarius · PYUSD/USDC', status: 'Unbalanced',   color: '#FF5A5A' },
]