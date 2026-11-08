// Lot EP (EP5, item 9): the witness outbox — add, acknowledge, expiry, prune,
// and the hard rule that NOTHING but hash / network / kind / timestamps is
// ever stored (no address, no user id, no amount). Map-backed storage, no DOM.
import { describe, expect, it } from 'vitest'
import {
  OUTBOX_STORAGE_KEY,
  OUTBOX_TTL_MS,
  acknowledgeInOutbox,
  addToOutbox,
  pendingInOutbox,
  pruneOutbox,
  readOutbox,
  writeOutbox,
  type OutboxStorage,
} from './witnessOutbox'

const fakeStorage = (): OutboxStorage & { map: Map<string, string> } => {
  const map = new Map<string, string>()
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) }
}
const H1 = 'a'.repeat(64)
const H2 = 'b'.repeat(64)
const T0 = Date.parse('2026-10-21T18:18:00Z')

describe('witnessOutbox', () => {
  it('add: stores hash (lower-cased), network, kind, submittedAt; idempotent on the hash; rejects a malformed hash', () => {
    const s = fakeStorage()
    expect(addToOutbox({ txHash: H1.toUpperCase(), network: 'mainnet', kind: 'sdex-swap' }, T0, s)).toEqual([
      { txHash: H1, network: 'mainnet', kind: 'sdex-swap', submittedAt: '2026-10-21T18:18:00.000Z' },
    ])
    expect(addToOutbox({ txHash: H1, network: 'mainnet', kind: 'sdex-swap' }, T0 + 1000, s)).toHaveLength(1)
    expect(addToOutbox({ txHash: 'not-a-hash', network: 'mainnet', kind: 'sdex-swap' }, T0, s)).toHaveLength(1)
    expect(addToOutbox({ txHash: H2, network: 'testnet', kind: 'blend-deposit' }, T0 + 120_000, s)).toHaveLength(2)
    expect(readOutbox(s).map((e) => e.txHash)).toEqual([H1, H2])
  })

  it('acknowledge marks the entry; pending excludes it; prune drops it from storage', () => {
    const s = fakeStorage()
    addToOutbox({ txHash: H1, network: 'mainnet', kind: 'sdex-swap' }, T0, s)
    addToOutbox({ txHash: H2, network: 'mainnet', kind: 'sdex-swap' }, T0, s)
    acknowledgeInOutbox(H1, T0 + 5000, s)
    expect(readOutbox(s)[0].acknowledgedAt).toBe('2026-10-21T18:18:05.000Z')
    expect(pendingInOutbox(T0 + 6000, s).map((e) => e.txHash)).toEqual([H2])
    expect(pruneOutbox(T0 + 6000, s).map((e) => e.txHash)).toEqual([H2])
    expect(readOutbox(s)).toHaveLength(1)
  })

  it('expiry: an entry 24 h old is no longer pending and is pruned; 23h59 is still reported', () => {
    const s = fakeStorage()
    addToOutbox({ txHash: H1, network: 'mainnet', kind: 'sdex-swap' }, T0, s)
    expect(pendingInOutbox(T0 + OUTBOX_TTL_MS - 1, s)).toHaveLength(1)
    expect(pendingInOutbox(T0 + OUTBOX_TTL_MS, s)).toHaveLength(0)
    expect(pruneOutbox(T0 + OUTBOX_TTL_MS, s)).toEqual([])
    expect(s.map.get(OUTBOX_STORAGE_KEY)).toBe('[]')
  })

  it('stores PUBLIC DATA ONLY: the serialized form has exactly the allowed keys, no address / userId / amount even if handed in', () => {
    const s = fakeStorage()
    const poisoned = {
      txHash: H1,
      network: 'mainnet',
      kind: 'sdex-swap',
      submittedAt: '2026-10-21T18:18:00.000Z',
      address: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWXYZ',
      userId: '00000000-0000-4000-8000-0000000000aa',
      amount: '12.5',
    }
    writeOutbox([poisoned as never], s)
    const raw = s.map.get(OUTBOX_STORAGE_KEY)!
    expect(Object.keys(JSON.parse(raw)[0]).sort()).toEqual(['kind', 'network', 'submittedAt', 'txHash'])
    expect(raw).not.toContain('GAAAA')
    expect(raw).not.toContain('0000000000aa')
    expect(raw).not.toContain('12.5')
    // and reading back a tampered payload keeps only the allowed keys
    s.map.set(OUTBOX_STORAGE_KEY, JSON.stringify([poisoned, { txHash: 'junk' }, 'nonsense', { txHash: H2, network: 'solana', kind: 'sdex-swap', submittedAt: '2026-10-21T18:18:00.000Z' }]))
    expect(readOutbox(s)).toEqual([{ txHash: H1, network: 'mainnet', kind: 'sdex-swap', submittedAt: '2026-10-21T18:18:00.000Z' }])
  })

  it('degrades silently: unreadable JSON → empty; no storage → empty and no throw; a throwing storage never propagates', () => {
    const s = fakeStorage()
    s.map.set(OUTBOX_STORAGE_KEY, '{not json')
    expect(readOutbox(s)).toEqual([])
    expect(readOutbox(null)).toEqual([])
    // no storage: the in-memory list is returned, nothing persists, nothing throws
    expect(addToOutbox({ txHash: H1, network: 'mainnet', kind: 'sdex-swap' }, T0, null)).toHaveLength(1)
    expect(readOutbox(null)).toEqual([])
    const throwing: OutboxStorage = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    }
    expect(() => addToOutbox({ txHash: H1, network: 'mainnet', kind: 'sdex-swap' }, T0, throwing)).not.toThrow()
    expect(pruneOutbox(T0, throwing)).toEqual([])
  })
})
