// venueTheme — Lot C. Per-protocol chip theming (tint bg + accent colour +
// logo) matching the design handoff palette. Single source of truth reused by
// the pool detail, protocols and dashboard views.
import blendLogo from '@/assets/protocols/blend-logo.svg'
import aquariusLogo from '@/assets/protocols/aquarius-logo.svg'
import soroswapLogo from '@/assets/protocols/soroswap-logo.svg'
import defindexLogo from '@/assets/protocols/defindex-logo.svg'

export interface VenueTheme {
  tint: string
  color: string
  logo: string | null
  letter: string
}

const THEMES: Record<string, VenueTheme> = {
  blend: { tint: '#17233A', color: '#2E6FD6', logo: blendLogo, letter: 'B' },
  aquarius: { tint: '#0F302C', color: '#159A8C', logo: aquariusLogo, letter: 'A' },
  soroswap: { tint: '#37231A', color: '#D86A3E', logo: soroswapLogo, letter: 'S' },
  'stellar-native': { tint: '#241633', color: '#7B45D6', logo: null, letter: 'N' },
  defindex: { tint: '#221A10', color: '#F59E0B', logo: defindexLogo, letter: 'D' },
}

const FALLBACK: VenueTheme = {
  tint: '#242422',
  color: '#8A857B',
  logo: null,
  letter: '•',
}

export function venueTheme(protocolId?: string | null): VenueTheme {
  if (!protocolId) return FALLBACK
  return THEMES[protocolId] ?? FALLBACK
}
