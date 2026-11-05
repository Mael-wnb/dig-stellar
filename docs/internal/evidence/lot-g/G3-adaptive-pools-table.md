# G3 — All-pools table: adaptive columns per tab — T3-D3, Lot G

The all-pools table showed a fixed 6-column set (TVL · APY · 24h vol · Fees · Util.)
for every tab, so each row half-dashed the columns that don't apply to its type
(lending rows "—" on vol/fees; AMM rows "—" on APY/util). Now the protocol filter
tabs drive the column set. `apps/web` only; no API change (`/v1/pools` already carries
every field). Gates: `pnpm -C apps/web test` **49/49** + build (vue-tsc + vite) green.
Visual: `g3-pools-table.png`.

## Column sets (`columns` computed, keyed off `selectedKind`)

- **"All"** — generic, dense: Pool (PairLogo) · **Protocol** · TVL · **Key metric** · ›.
  The Key metric is type-aware, one column: lending → Supply APY, vault → APY,
  amm → 24h vol. Each row shows the value with its own small label underneath
  ("Supply APY" / "24h vol" / "APY") and APY-type values stay green, volume neutral —
  so the shared column never implies an APY and a volume are the same quantity.
- **Blend (lending)** — TVL · Supply APY · Borrow APY · Utilization.
- **Soroswap / Aquarius / Native (amm)** — TVL · 24h vol · 24h fees · 24h swaps.
- **DeFindex (vault)** — TVL · APY.

The Pool cell dropped its venue subtitle: on "All" the venue is now its own Protocol
column; on a protocol tab it's implied by the selected tab. Grid tracks are computed
(`gridTemplate`) so each set lays out tight with no empty columns.

## Sorting — N/A-aware, honest across types

- Every visible column sorts; `metricVal` returns `null` for a genuinely-absent value
  and the comparator pushes nulls to the bottom (unchanged precedent) — a missing
  measurement never sorts as a spurious 0.
- Switching tabs resets the sort to **TVL desc** (`watch(filter, …)`), because a sort
  key from the previous set (e.g. `swaps`) may not exist in the new one.
- **"All" Key-metric sort** groups by type first (`KIND_ORDER`), then sorts each group
  by its own metric. APY and volume are ranked *within* their kind, never against each
  other — the brief's "sorts within comparable types without pretending APY and volume
  compare." TVL sort (and all protocol-tab sorts) are plain comparisons.

## Half-dash rows — gone

Structural N/A is eliminated: a column only appears when every row in view can fill it.
(A type-specific column can still show an honest "—" when the datum itself is missing
for one pool — that's absent *data* within an applicable metric, not a structural
mismatch, and stays "—" per the honest-display invariant, never a synthetic 0.)

## Files touched

- `apps/web/src/components/views/ProtocolsView.vue` — `columns`/`gridTemplate`/`keyMetric`
  computeds, extended `SortKey` + `metricVal`, grouped "All" key-metric sort, tab-reset
  watcher, adaptive header + data-cell template.
