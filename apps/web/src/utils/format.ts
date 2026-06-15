// apps/web/src/utils/format.ts
//
// Canonical number/value formatting for the analytics UI.
// Single source of truth — do NOT reintroduce inline formatters in components.
//
// Rounding policy (applied everywhere):
//   null / undefined    -> "—"
//   0                   -> "$0"
//   0 < n < 0.01 (dust) -> "<$0.01"
//   0.01 <= n < 1e3     -> "$X.XX"   (2 decimals)
//   1e3  <= n < 1e6     -> "$XXX.Xk" (1 decimal)
//   1e6  <= n < 1e9     -> "$XX.XM"  (1 decimal)
//   n >= 1e9            -> "$X.XB"   (1 decimal)
//   negatives: same logic on |n|, prefixed with "-"

const DASH = '—'

export function formatUsd(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return DASH
  if (n === 0) return '$0'

  const sign = n < 0 ? '-' : ''
  const v = Math.abs(n)

  if (v < 0.01) return `${sign}<$0.01`
  if (v < 1_000) return `${sign}$${v.toFixed(2)}`
  if (v < 1_000_000) return `${sign}$${(v / 1_000).toFixed(1)}k`
  if (v < 1_000_000_000) return `${sign}$${(v / 1_000_000).toFixed(1)}M`
  return `${sign}$${(v / 1_000_000_000).toFixed(1)}B`
}

// Unit prices (e.g. XLM price). Keep full precision — do NOT route through formatUsd.
export function formatPrice(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return DASH
  return `$${n.toFixed(4)}`
}

// Percentage change. Mirrors the original fmtPct (▲/▼ sign, null -> "—"),
// upgraded from 1 to 2 decimals.
export function formatPct(change: number | null | undefined): string {
  if (change === null || change === undefined || !Number.isFinite(change)) return DASH
  const sign = change >= 0 ? '▲' : '▼'
  return `${sign} ${Math.abs(change).toFixed(2)}%`
}

// Integer-ish counts with k/M/B suffixes. Mirrors the original fmtCount.
export function formatCount(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return DASH
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return `${Math.round(n)}`
}

// Display-only asset symbol. The native Stellar token is technically "native"
// (Horizon/SDK term) but users know it as "XLM". This maps the display label
// ONLY — technical identifiers (DB, data keys, price lookups) stay "native".
export function displaySymbol(s: string | null | undefined): string {
  return s === 'native' ? 'XLM' : (s ?? DASH)
}

// Display-only pool name. Names are persisted composites like
// "native/USDC Native Pool". We map the "native" *symbol* to "XLM" in the
// leading symbol segment (the "native/USDC" part, before the first space)
// WITHOUT touching the "Native Pool" suffix.
export function displayPoolName(name: string | null | undefined): string {
  if (!name) return DASH
  const spaceIdx = name.indexOf(' ')
  const head = spaceIdx === -1 ? name : name.slice(0, spaceIdx)
  const tail = spaceIdx === -1 ? '' : name.slice(spaceIdx)
  const mappedHead = head
    .split('/')
    .map((sym) => displaySymbol(sym))
    .join('/')
  return mappedHead + tail
}
