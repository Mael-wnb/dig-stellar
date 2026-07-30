// apps/web/src/config/bridgeAnnotations.ts
// SCF T2-D3 — manual, data-driven event annotations for the bridge net-flow chart.
// Each annotation pins a real off-chain event to a UTC 'YYYY-MM-DD' day; the chart
// (BridgeChart) draws a subtle dashed marker on any visible day that matches, and
// the staleness banner (BridgeSection) reuses the most recent annotation's url for
// its "Learn more" link. Keep this the single source — never hardcode dates/urls in
// the components.

export type BridgeAnnotation = { date: string; label: string; url?: string }

export const bridgeAnnotations: BridgeAnnotation[] = [
  {
    date: '2026-07-19',
    label: 'Allbridge Core paused (security incident)',
    url: 'https://crypto.news/allbridge-core-halted-after-1-65m-solana-exploit/',
  },
]
