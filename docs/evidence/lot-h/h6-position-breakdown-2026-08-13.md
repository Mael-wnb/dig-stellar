# H6 — Per-asset breakdown on Blend positions (display honesty)

Lot H (T3-D3). Date: 2026-08-13.

## Problem

`wallet_protocol_positions` already stored the per-asset supply/borrow legs (written by the
T2-D1 resolver, `81-stellar-wallet-blend-positions.ts`). The product collapsed them into a
single USD figure per (wallet, pool), so the UI could tell you a position was worth $41.2k
but not *what it was made of*. Nothing was missing from the pipeline — only from the display.

## What changed

No new tables, no new resolver work, no ingestion change. Stored data, exposed and rendered.

**API — `apps/api/src/modules/wallets/wallets.service.ts`**

- `GET /v1/wallets/:id/positions` — each leg in `pools[].positions[]` gains `side`
  (`supplied` / `borrowed` / `other`), `assetContractId` and `logoUrl` (joined from `assets`,
  by `asset_id`, falling back to `contract_address`). Existing fields untouched.
- `GET /v1/wallets/overview` — `defi.poolHealth[]` gains `entityId` and a `positions[]` array
  carrying the same legs, bucketed per (wallet, pool). Previously this block was USD-only.
- Both read the **same latest-snapshot-per-wallet** rule the USD rollups already use, so a leg
  can never outlive the snapshot its total came from (no resurrected closed positions).
- Leg order is deterministic: supplied before borrowed, then by USD weight, then symbol.

**Web**

- New `apps/web/src/components/common/PositionAssetChips.vue` — one chip per leg
  (`BrandLogo` + exact amount + symbol), grouped `SUPPLIED` / `BORROWED`.
- `PortfolioView.vue` — chips under each position row, in **both** the by-position and
  by-wallet modes.
- `YourPositionsPanel.vue` (dashboard) — same chips, dense variant, under each top position.
- New `formatTokenAmount` in `utils/format.ts`. Deliberately **not** `formatCount`: that one
  rounds to whole units, which would render a real `0.42 XLM` position as `0`.

USD totals are unchanged and stay exactly where they were — the chips add the *what*, they do
not replace the *how much*.

## Honesty rules held

- **Exact amounts.** Values are the API's stored numbers, grouped and trimmed only (≤4 decimals
  at/above 1 unit, ≤8 below). A non-zero amount too small for that precision renders
  `<0.00000001`, never a misleading `0`.
- **Nothing synthesized.** No derived, estimated or filled-in values; no leg is invented.
- **Every leg listed.** A position with multiple supplied assets shows them all — no "top asset"
  truncation. Visible in the capture: `Fixed` lists `200,000.0232 XLM` **and** `15,041.2688 USDC`
  supplied, plus `25,351.8184 EURC` borrowed.
- **Absence shows as absence.** No legs (older snapshot, or an asset the indexer never resolved)
  renders nothing rather than a placeholder implying a known composition. A missing `logoUrl`
  falls through BrandLogo's existing chain to a monogram.

## Capture

Headless Chrome over CDP (same method as F4 / H2 / H3): local dev server + the **real local API**
against the live dev DB. Before/after captured by stashing the change and rebuilding, so both
sides are real renders of real data — the same wallets, same snapshot, same framing.

| | before | after |
|---|---|---|
| Portfolio, by position | `h6-portfolio-by-position-before.png` | `h6-portfolio-by-position-after.png` |
| Portfolio, by wallet | `h6-portfolio-by-wallet-before.png` | `h6-portfolio-by-wallet-after.png` |
| Dashboard (full) | `h6-dashboard-before.png` | `h6-dashboard-after.png` |
| Dashboard panel (crop) | `h6-dashboard-panel-before.png` | `h6-dashboard-panel-after.png` |

`h6-api-before-after.json` — trimmed API payload pair (one pool per endpoint) showing the added
fields alongside the untouched USD figures.

Rendered amounts cross-checked against the DB rows:
`150007.983859300 → 150,007.9839`, `69.004238300 → 69.0042`, `1001.364722700 → 1,001.3647`,
`200000.023228400 → 200,000.0232`, `25351.818367400 → 25,351.8184`.

## Verification

- `pnpm -C apps/api build` — green.
- `pnpm -C apps/api test` — 42/42 green.
- `pnpm -C apps/web build` (vue-tsc typecheck) — green.
- `defi.totalSuppliedUsd` / `totalBorrowedUsd` / `summary` byte-identical before vs after —
  confirmed additive.

## Scope

Read/display only. No action path touched: no XDR building, no signing flow, no validator, no
flags regime. Ingestion, schema and the alerting evaluator are untouched.
