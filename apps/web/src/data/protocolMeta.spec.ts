import { describe, expect, it } from 'vitest'
import { poolCountLabel, protocolUnits, reserveTokenKey, DEFAULT_PROTOCOL_UNITS } from './protocolMeta'

describe('protocolMeta units', () => {
  it('defaults to pool/pools for protocols without a units entry', () => {
    for (const id of ['blend', 'aquarius', 'soroswap', 'defindex', 'stellar-native', 'unknown']) {
      expect(protocolUnits(id)).toBe(DEFAULT_PROTOCOL_UNITS)
      expect(poolCountLabel(id, 4, 99)).toBe('4 pools')
    }
    expect(poolCountLabel('blend', 1)).toBe('1 pool')
  })

  it('renders XOXNO as hubs with a market count', () => {
    expect(poolCountLabel('xoxno', 3, 25)).toBe('3 hubs · 25 markets')
    expect(poolCountLabel('xoxno', 1, 1)).toBe('1 hub · 1 market')
  })

  it('omits the market count when the caller does not supply one (Protocols tile)', () => {
    expect(poolCountLabel('xoxno', 3)).toBe('3 hubs')
    expect(poolCountLabel('blend', 4)).toBe('4 pools')
  })

  it('keys reserve tokens by assetId, falling back to symbol', () => {
    expect(reserveTokenKey({ assetId: 'A', symbol: 'USDC' })).toBe('A')
    expect(reserveTokenKey({ assetId: null, symbol: 'USDC' })).toBe('USDC')
    expect(reserveTokenKey({ assetId: null, symbol: null })).toBeNull()
  })
})
