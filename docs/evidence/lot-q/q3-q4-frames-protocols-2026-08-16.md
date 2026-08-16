# Lot Q — Q3 + Q4 evidence (2026-08-16)

Same capture method as the Q1/Q2 evidence (headless system Chrome + playwright-core,
local vite 5173 + local API 3000 + live dev DB). Q3 "before" shots were taken with
all `apps/web` changes stashed (pre-lot state); Q4's "before" is the Q3 "after"
capture (`q4-protocol-cards-before.png` is a copy of `q3-protocol-cards-after.png` —
same page state immediately before Q4 landed).

## Q3 — Venue logo double frame

**Diagnosis: the inner frame is baked into the image assets, not component
nesting.** Each bundled venue SVG (`apps/web/src/assets/protocols/{blend,aquarius,
soroswap,defindex}-logo.svg`) carried a full-viewBox `<rect rx="8">` tile behind
the glyph; `BrandLogo` then drew its own tile (venueTheme tint + radius) around it
with the image at 60% → frame-within-a-frame. No double-mounting of components
anywhere.

**Fix (what the diagnosis dictates): crop the padded assets.** Removed the baked
`<rect>` from the four SVGs and cropped each viewBox to the measured glyph bbox
(+1.2 units margin on stroke-drawn glyphs for round line caps, +0.5 on filled
ones). The `BrandLogo` tile is now the single frame; glyph scale at the venue call
sites raised 0.6 → 0.72 so the logo fills the tile. Applied everywhere venue logos
render: dashboard protocol cards, protocols page (cards + lending rows), pool
detail header, and the ActionModal header tile (same inline pattern, 60% → 72%).
The trustwallet PNG for stellar-native never had a baked frame — unchanged
behavior, same scale bump.

Captures: `q3-protocol-cards-{before,after}.png`, `q3-pools-blend-rows-{before,after}.png`,
`q3-dashboard-cards-{before,after}.png`, `q3-pool-detail-header-{before,after}.png`.

## Q4 — Protocols page: Type + underlying assets

- **Type** on each per-protocol card now comes from `venue_type` (served as
  `protocol.type`): Lending / AMM / Yield vaults. **stellar-native** is
  `venue_type='amm'` in the registry, but the venue is the classic DEX — labelled
  **"DEX (orderbook)"** per the founder's enumeration via an explicit
  venue-id override in `ProtocolsView.vue` (flagged: if the registry's
  `venue_type` should change instead, that is a data change beyond this lot).
- **Underlying assets**: up to 3 asset logos (top by TVL within the venue,
  circular per Q1) + a "+N" chip with the honest remainder (Blend: 10 distinct
  assets venue-wide → 3 marks + "+7"; Aquarius +12, Soroswap +1). Venues without
  reserve-snapshot coverage (stellar-native — reserves live in
  `pool_snapshots.metadata` — and DeFindex) get an empty list, never a guessed one.
- **API (additive, same pattern as H6's legs)**: `GET /v1/protocols` items gained
  `topAssets: [{symbol, logoUrl, tvlUsd}]` (≤3) and `assetCount`. Ranking =
  latest `reserve_snapshots` per active entity × latest `asset_prices` price,
  summed per (venue, asset) — the same source the pool-detail reserves use
  (Lot E cross-checked vs venue UIs). Note: these per-asset sums are used for
  *ranking only*; they don't reconcile to `protocol_metrics_latest.tvl_usd`
  (e.g. Blend venue TVL $181.5M vs per-asset reserve sum ≈ $43M — pre-existing
  metrics-family difference, out of Q4 scope, flagged for a later data pass).
- Web: new `src/api/protocols.ts` + `ProtocolListItem` type; cards enrich
  asynchronously (page renders without chips if the call fails). Pools table
  columns/metrics untouched.

Captures: `q4-protocol-cards-{before,after}.png`,
`q4-protocol-cards-scrolled-after.png` (Stellar Native DEX "DEX (orderbook) · 10
pools" + Soroswap card with asset chips). Card headers verified via DOM dump:
Blend=Lending, Aquarius=AMM, DeFindex=Yield vaults, Stellar Native DEX=DEX
(orderbook), Soroswap=AMM.

## Validation

- API: `nest build` clean, jest **85/85** passed.
- Web: `vue-tsc -b` clean, vitest **111/111** passed.
- VPS: Q3/Q4 web changes ship via Vercel on push; the Q4 API change ships with
  the normal API deploy. No schema change, no new job.
