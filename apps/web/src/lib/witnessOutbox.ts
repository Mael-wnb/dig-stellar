// apps/web/src/lib/witnessOutbox.ts
//
// Lot EP (EP5, item 9): the witness OUTBOX. Production observation 2026-10-21:
// two mainnet swaps built at 18:18Z and 18:20Z never produced a witness row —
// the fire-and-forget report after the swap was lost (tab closed, network blip,
// Horizon not yet caught up). The outbox keeps every submitted tx hash in
// localStorage so the report can be re-posted later: on Earn view load and
// after each action, every entry younger than 24 h that the API has not
// acknowledged yet is re-POSTed to /v1/actions/witness (idempotent server-side),
// then /v1/campaign/sync runs.
//
// PUBLIC DATA ONLY: hash + network + kind + submittedAt. Never an address,
// never a user id, never an amount — a tx hash is already public on-chain.
// Every storage access is wrapped in try/catch: a private window or blocked
// storage degrades to "no outbox", never to an error in the action flow.
// Pure functions over an injected Storage so witnessOutbox.spec.ts runs
// without a browser.

export type OutboxKind = 'sdex-swap' | 'blend-deposit' | 'blend-withdraw'
export type OutboxNetwork = 'testnet' | 'mainnet'

export interface OutboxEntry {
  txHash: string
  network: OutboxNetwork
  kind: OutboxKind
  /** ISO instant the wallet submitted the tx. */
  submittedAt: string
  /** ISO instant the API answered definitively (witnessed, or a non-retryable refusal); dropped on the next prune. */
  acknowledgedAt?: string
}

export const OUTBOX_STORAGE_KEY = 'dig.witnessOutbox.v1'
/** Entries older than this are dropped unreported: the API window for a late witness is long past. */
export const OUTBOX_TTL_MS = 24 * 60 * 60 * 1000

const TX_HASH_RE = /^[0-9a-f]{64}$/i
const ALLOWED_KEYS: ReadonlyArray<keyof OutboxEntry> = ['txHash', 'network', 'kind', 'submittedAt', 'acknowledgedAt']

/** The Storage slice used (localStorage in the app, a Map-backed fake in the spec). */
export interface OutboxStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

function defaultStorage(): OutboxStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

/** Strict parse: only known keys, only well-formed hashes; anything else is dropped (never trusted). */
function sanitize(raw: unknown): OutboxEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.txHash !== 'string' || !TX_HASH_RE.test(r.txHash)) return null
  if (r.network !== 'testnet' && r.network !== 'mainnet') return null
  if (r.kind !== 'sdex-swap' && r.kind !== 'blend-deposit' && r.kind !== 'blend-withdraw') return null
  if (typeof r.submittedAt !== 'string' || !Number.isFinite(Date.parse(r.submittedAt))) return null
  const entry: OutboxEntry = { txHash: r.txHash.toLowerCase(), network: r.network, kind: r.kind, submittedAt: r.submittedAt }
  if (typeof r.acknowledgedAt === 'string' && Number.isFinite(Date.parse(r.acknowledgedAt))) entry.acknowledgedAt = r.acknowledgedAt
  return entry
}

export function readOutbox(storage: OutboxStorage | null = defaultStorage()): OutboxEntry[] {
  if (!storage) return []
  try {
    const raw = storage.getItem(OUTBOX_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    const out: OutboxEntry[] = []
    for (const item of parsed) {
      const e = sanitize(item)
      if (e && !out.some((x) => x.txHash === e.txHash)) out.push(e)
    }
    return out
  } catch {
    return []
  }
}

export function writeOutbox(entries: ReadonlyArray<OutboxEntry>, storage: OutboxStorage | null = defaultStorage()): void {
  if (!storage) return
  try {
    // Serialize ONLY the allowed keys: nothing else can ever land in storage.
    const clean = entries.map((e) => {
      const o: Record<string, unknown> = {}
      for (const k of ALLOWED_KEYS) if (e[k] !== undefined) o[k] = e[k]
      return o
    })
    storage.setItem(OUTBOX_STORAGE_KEY, JSON.stringify(clean))
  } catch {
    // storage blocked / full: the action flow must never fail because of the outbox
  }
}

/** Add a submitted tx (idempotent on the hash). Returns the new list. */
export function addToOutbox(
  entry: { txHash: string; network: OutboxNetwork; kind: OutboxKind },
  now: number = Date.now(),
  storage: OutboxStorage | null = defaultStorage(),
): OutboxEntry[] {
  const list = readOutbox(storage)
  const hash = entry.txHash.toLowerCase()
  if (!TX_HASH_RE.test(hash)) return list
  if (list.some((e) => e.txHash === hash)) return list
  const next = [...list, { txHash: hash, network: entry.network, kind: entry.kind, submittedAt: new Date(now).toISOString() }]
  writeOutbox(next, storage)
  return next
}

/** The API answered definitively for this hash: mark it; prune() drops it. */
export function acknowledgeInOutbox(txHash: string, now: number = Date.now(), storage: OutboxStorage | null = defaultStorage()): OutboxEntry[] {
  const hash = txHash.toLowerCase()
  const next = readOutbox(storage).map((e) => (e.txHash === hash ? { ...e, acknowledgedAt: new Date(now).toISOString() } : e))
  writeOutbox(next, storage)
  return next
}

/** Drop acknowledged and expired (> 24 h) entries; returns what is still to be reported. */
export function pruneOutbox(now: number = Date.now(), storage: OutboxStorage | null = defaultStorage()): OutboxEntry[] {
  const kept = readOutbox(storage).filter((e) => !e.acknowledgedAt && !isExpired(e, now))
  writeOutbox(kept, storage)
  return kept
}

export function isExpired(entry: OutboxEntry, now: number = Date.now()): boolean {
  return now - Date.parse(entry.submittedAt) >= OUTBOX_TTL_MS
}

/** Entries still to (re)report: not acknowledged, not expired. Does not write. */
export function pendingInOutbox(now: number = Date.now(), storage: OutboxStorage | null = defaultStorage()): OutboxEntry[] {
  return readOutbox(storage).filter((e) => !e.acknowledgedAt && !isExpired(e, now))
}
