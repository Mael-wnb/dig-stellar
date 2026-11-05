# Lot Q — Q1 + Q2 evidence (2026-08-16)

Captures: headless Chrome over CDP (playwright-core + system Chrome, same method as
F4 / H2 / H3 / H6), local vite dev server (5173) + real local API (3000) against the
live dev DB. "Before" shots taken pre-change; the swap-selector "before" was re-shot
with the web changes `git stash`-ed, then popped.

## Q1 — Token logos are circles; apps stay square tiles

Change: `BrandLogo` gained a `variant` prop — `'tile'` (default, unchanged
rounded-square, logo floats at `imgScale`) vs `'asset'` (plain circle, image fills
edge-to-end with `object-fit: cover`; monogram fallback stays a tinted circle).
`PairLogo` composes the asset variant and now puts the thin ~2px surface-colored
ring **only on the front (overlapping) mark**, so the back mark isn't framed.

Swept call sites (asset variant):

| Surface | File |
|---|---|
| Pools table pair marks | `ProtocolsView.vue` (via `PairLogo`) |
| Pool detail header pair marks | `PoolDetailView.vue` (via `PairLogo`) |
| Pool detail AMM reserve bars + lending reserves table | `PoolDetailView.vue` |
| Position chips (H6) | `PositionAssetChips.vue` |
| Portfolio Assets card (W3) + by-wallet rows | `PortfolioView.vue` |
| Swap token selector | `TokenSelect.vue` (was already circular via `radius=999`; standardized on the variant) |
| Alert-modal targets | `AlertRuleModal.vue` (asset-scope swatches → `rounded-full`; wallet/protocol/venue keep the square tile) |
| Bridge route/flow chain marks | `BridgeRoutesTable.vue`, `BridgeFlowsFeed.vue` |

Kept as rounded-square tiles (apps, not tokens): dashboard protocol cards
(`DashboardView.vue`), protocol summary cards + lending-row protocol mark
(`ProtocolsView.vue`), lending pool-detail header mark (`PoolDetailView.vue`).

Captures (before/after pairs):
- `q1-q2-pools-table-*.png` — pools table, pair marks square→circle w/ front ring
- `q2-pools-aquarius-*.png` — Aquarius tab (also the densest pair-mark surface)
- `q1-q2-pool-detail-aquarius-*.png` — pool header pair + AMM reserve rows
- `q1-pool-detail-blend-*.png` — lending: reserve-table asset marks circular,
  protocol header tile stays square (full-page)
- `q1-swap-select-*.png` — token dropdown (no visual delta expected: it was
  already circular; captured for completeness)
- `q1-alert-modal-asset-*.png` — asset target swatches square→circle
- `q1-portfolio-assets-*.png` — Assets card monogram chips (26px — subtle in the
  shot; DOM-verified `border-radius: 9999px` on the after build)
- `q1-bridge-rows-*.png` — bridge section; **no route/flow rows in the window**
  (no Allbridge activity for 38 days), so only the empty state is visible. The
  chain marks got the same asset variant in code; no populated visual available.

## Q2 — 'native' never renders to users

**Registry display names** (`core-registry.json`): 25 AMM entities renamed to
venue-style pair names — slugs, contracts, metadata untouched (display only).
Pattern: `native-USDC Aquarius Pool` → `XLM/USDC`, concentrated pools get a
` Concentrated` suffix (the classic/concentrated pair would otherwise collide),
`native-EURC Soroswap LP Token` → `XLM/EURC`. Blend (`Fixed`, `Orbit`, …) and
DeFindex names were already clean and stay unchanged. The venue word is dropped
from pool names because every surface already prints the venue next to the name
(Protocol column / card / sub-line).

Durability check: the aquarius/soroswap refresh paths never write `entities.name`;
`stellar-native/persist-pools.ts` upserts only `updated_at` on conflict; Blend
rewrites names from chain metadata but those are the already-clean pool names. So
the rename survives `job:refresh`.

Local re-seed: `pnpm -C apps/indexer bootstrap:core` →
`{ venues: 6, entities: 32, assets: 17, entityAssets: 78 }`, then
`GET /v1/pools` → **0** names containing `native-`;
`aquarius-native-usdc-pool → "XLM/USDC"`, `soroswap-native-usdc-pair → "XLM/USDC"`,
`aquarius-native-usdc-clpool → "XLM/USDC Concentrated"`.

**VPS pickup at deploy**: `git pull` + `pnpm -C apps/indexer bootstrap:core`
(idempotent upsert; no schema change, no snapshot loss).

**Web sweep** (`displaySymbol` / `displayPoolName` already existed in
`utils/format.ts` from Lot H):
- `useAlerts.ts` — venue-scope target labels now run pool names through
  `displayPoolName` (stellar-native pools are discovered, not registry-named, so
  their DB names keep the `native/USDC …` head that the helper maps to `XLM/…`).
- `ProtocolsView.vue` + `PoolDetailView.vue` — monogram fallback letters derive
  from the display symbol (`native` → `XLM` → "X", never "n").
- Remaining `native` occurrences in `apps/web` verified non-rendering: technical
  asset identifiers (SDEX/Horizon `asset_type`, swap XDR building), internal ids
  (`stellar-native` venue key), and the proper noun "Stellar Native DEX" (stays).

## Validation

- `vue-tsc -b` clean; `vitest run` **111/111 passed** (baseline held).
- API/indexer code untouched except the registry JSON (display names only).
