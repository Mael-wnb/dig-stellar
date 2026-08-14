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

// H7 — compact token amount for position chips. Deliberately NOT formatCount:
// that one rounds every sub-1000 value to a whole unit, turning a real 0.42 XLM
// position into "0". Scale:
//   >= 1e9 -> "1.2B"      >= 1e6 -> "15.2M"     >= 1e5 -> "240k"
//   >= 1e3 -> "10,187"    (grouped, still exact to the unit)
//   >= 1   -> "69.05"     (<=2 decimals, trailing zeros trimmed)
//   > 0    -> "0.4231"    (<=4 decimals; "<0.0001" rather than a lying "0")
// Precision is NOT dropped here — it moves to the hover title, which carries the
// exact stored amount (formatTokenAmountExact). Chips read; hover verifies.
export function formatTokenAmountCompact(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return DASH
  if (n === 0) return '0'

  const sign = n < 0 ? '-' : ''
  const v = Math.abs(n)
  // Trim trailing zeros at a given precision ("1.0M" -> "1M").
  const trim = (x: number, d: number): string =>
    Number(x.toFixed(d)).toLocaleString('en-US', { maximumFractionDigits: d })

  // Boundaries are the half-up rounding points, so a value never renders as
  // "1,000k" or "100,000" when the next unit up is what it rounds to.
  if (v >= 999_500_000) return `${sign}${trim(v / 1e9, 1)}B`
  if (v >= 999_500) return `${sign}${trim(v / 1e6, 1)}M`
  if (v >= 99_999.5) return `${sign}${Math.round(v / 1e3).toLocaleString('en-US')}k`
  if (v >= 1_000) return `${sign}${Math.round(v).toLocaleString('en-US')}`
  if (v >= 1) return `${sign}${trim(v, 2)}`

  if (Number(v.toFixed(4)) === 0) return `${sign}<0.0001`
  return `${sign}${trim(v, 4)}`
}

// H7 — the exact stored amount, for hover titles. No rounding at all: the
// number's own decimal representation, with thousands grouping added. This is
// what makes the compact chip honest rather than lossy.
export function formatTokenAmountExact(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return DASH

  const sign = n < 0 ? '-' : ''
  const raw = String(Math.abs(n))
  // Exponential notation (extreme magnitudes) is left verbatim — grouping it
  // would misrepresent the value.
  if (raw.includes('e') || raw.includes('E')) return `${sign}${raw}`

  const [int, frac] = raw.split('.')
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${sign}${frac ? `${grouped}.${frac}` : grouped}`
}

// Display-only asset symbol. The native Stellar token is technically "native"
// (Horizon/SDK term) but users know it as "XLM". This maps the display label
// ONLY — technical identifiers (DB, data keys, price lookups) stay "native".
export function displaySymbol(s: string | null | undefined): string {
  return s === 'native' ? 'XLM' : (s ?? DASH)
}

// Relative "time ago" label for feeds (e.g. "3h ago"). Single source of truth —
// mirrors the original inline helper in BridgeFlows.vue.
export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return DASH
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return DASH
  const diffMs = Date.now() - then
  const sec = Math.max(0, Math.round(diffMs / 1000))
  if (sec < 60) return `${sec}s ago`
  const min = Math.round(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.round(hr / 24)
  return `${day}d ago`
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
