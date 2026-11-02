import blendLogo from '@/assets/protocols/blend-logo.svg'
import aquariusLogo from '@/assets/protocols/aquarius-logo.svg'
import soroswapLogo from '@/assets/protocols/soroswap-logo.svg'
import defindexLogo from '@/assets/protocols/defindex-logo.svg'
import type { PoolTokenSummary } from '../types/protocol'

// Per-protocol wording for the "<type>, N pools" subtitles. A protocol whose
// own vocabulary is not "pools" overrides the noun; `showMarketCount` appends
// the number of distinct reserve tokens across its pools (" · M markets").
// Protocols without an entry render exactly as before: "pool" / "pools".
export interface ProtocolUnits {
  poolNoun: { singular: string; plural: string }
  showMarketCount?: boolean
}

export const DEFAULT_PROTOCOL_UNITS: ProtocolUnits = {
  poolNoun: { singular: 'pool', plural: 'pools' },
}

export const PROTOCOL_META: Record<
  string,
  { icon: string; iconColor: string; iconBg: string; logo: string; units?: ProtocolUnits }
> = {
  blend: {
    icon: '◈',
    iconColor: '#2cb13e',
    iconBg: '#1a2a10',
    logo: blendLogo,
  },
  aquarius: {
    icon: '◎',
    iconColor: '#872ab0',
    iconBg: '#1a1a2e',
    logo: aquariusLogo,
  },
  soroswap: {
    icon: '⬡',
    iconColor: '#8865dd',
    iconBg: '#1a2020',
    logo: soroswapLogo,
  },
  defindex: {
    icon: '✦',
    iconColor: '#F59E0B',
    iconBg: '#221a10',
    logo: defindexLogo,
  },
  // Lot XO: no bundled mark (monogram chip) until XOXNO provides an official one.
  // XOXNO Lending is modelled as one entity per hub (Core, RWA, AMM) whose
  // reserves are the isolated markets, so the UI counts "hubs" and "markets".
  xoxno: {
    icon: '◇',
    iconColor: '#D04E92',
    iconBg: '#33192a',
    logo: '',
    units: {
      poolNoun: { singular: 'hub', plural: 'hubs' },
      showMarketCount: true,
    },
  },
}

export function protocolUnits(protocolId: string): ProtocolUnits {
  return PROTOCOL_META[protocolId]?.units ?? DEFAULT_PROTOCOL_UNITS
}

// Key identifying one reserve token across a protocol's pools. assetId is the
// canonical id served by /v1/pools; symbol is the fallback when it is absent.
export function reserveTokenKey(token: PoolTokenSummary): string | null {
  return token.assetId ?? token.symbol ?? null
}

// "4 pools" / "3 hubs · 25 markets". `marketCount` is the number of distinct
// reserve tokens across the protocol's pools; it is rendered only for
// protocols that opt in via `showMarketCount` AND when the caller supplies it
// (the narrow Protocols tile omits it and shows "3 hubs").
export function poolCountLabel(protocolId: string, poolCount: number, marketCount?: number): string {
  const units = protocolUnits(protocolId)
  const noun = poolCount === 1 ? units.poolNoun.singular : units.poolNoun.plural
  const base = `${poolCount} ${noun}`
  if (!units.showMarketCount || marketCount === undefined) return base
  return `${base} · ${marketCount} ${marketCount === 1 ? 'market' : 'markets'}`
}
