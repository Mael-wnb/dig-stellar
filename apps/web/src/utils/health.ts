// src/utils/health.ts
// Blend health-factor display rule (T2-D1/F4): one source of truth for the
// HF colour states, shared by the Portfolio and the dashboard positions recap.
// null = no debt → not at risk (never rendered as a fake number).
export function hfDisplay(hf: number | null): { label: string; color: string } {
  if (hf === null || !Number.isFinite(hf)) return { label: 'No borrow', color: 'var(--dig-faint)' }
  const label = `HF ${hf.toFixed(2)}`
  if (hf >= 1.5) return { label, color: 'var(--dig-green)' }
  if (hf >= 1.2) return { label, color: 'var(--dig-amber)' }
  return { label, color: 'var(--dig-red)' }
}
