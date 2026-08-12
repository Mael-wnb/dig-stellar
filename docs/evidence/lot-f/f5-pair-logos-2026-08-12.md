# F5 — DexScreener-style pair logos on pool rows (2026-08-12)

Lot F, step F5. A small frontend-only follow-up to **F3** (backend-served logos): pool rows and
the pool-detail header now show the *pair's* asset logos instead of a single venue mark, in the
DexScreener idiom (two overlapped coins + a small protocol badge). Reuses the F3 `logoUrl` fields
already on `/v1/pools`; **no API change**.

## What shipped (all `apps/web`)

1. **New `components/common/PairLogo.vue`.** Composes two (or one) `BrandLogo` marks overlapped
   (second advanced 72% of the chip width, so ~28% overlap — each coin stays clearly readable at
   small sizes), each carrying a 2px ring in the chip-surface colour so the overlap reads cleanly.
   It is a pure layout wrapper over `BrandLogo`, so the **honest fallback chain is inherited
   unchanged**: backend `logoUrl` → bundled asset → symbol monogram. No new image source, no
   broken-image state. **No protocol badge** — the venue name is already written next to the mark
   at every call site, so a third mini-logo would just be clutter.

2. **Per pool type (both the Protocols table rows and the `PoolDetailView` header):**
   - **AMM** (`soroswap` / `aquarius` / `stellar-native`) → the two pair assets.
   - **Yield vault** (`defindex`) → the underlying asset (single mark). When the vault serves no
     tokens, it falls back to the symbol parsed from the pool name (e.g. `USDC`), then to a monogram.
   - **Lending** (`blend`) → **unchanged** — the plain single protocol `BrandLogo`. `PairLogo` is
     not rendered there (`assets.length === 0` / `headerAssets` empty → `v-else` keeps `BrandLogo`).

   Asset chips use the same neutral chip (`#242422` / `#B7B3AB`) already used by the reserve rows,
   so nothing new is invented per-asset.

## Verification (real local API, mainnet data)

- `pnpm -C apps/web build` (vue-tsc typecheck) — green.
- `pnpm -C apps/web test` — 49/49 green (no validator/behaviour touched; F5 is presentational).
- Captured headless (Chrome `--headless=new`) against the running local API on `:3000`
  (73 pools: 66 AMM / 4 lending / 3 vault; 12 pools carry ≥1 token `logoUrl`, so the shots show a
  real mix of served logos and honest monogram fallbacks). Before = stash of the two view edits.
  - Protocols table: `f5-pairlogo-before-protocols-2026-08-12.png` → `…-after-protocols-2026-08-12.png`
    (e.g. `PYUSD-USDC Aquarius Pool` now shows PYUSD+USDC side by side; Blend `Fixed` / `YieldBlox` /
    `Orbit` keep the single protocol logo; `xSolvBTC-SolvBTC` shows honest `X`/`S` monograms for the
    unseeded legs).
  - Pool header: `f5-pairlogo-before-pool-2026-08-12.png` → `…-after-pool-2026-08-12.png`
    (`aquarius-pyusd-usdc-pool`).
  - Vault header/rows: `f5-pairlogo-after-vault-2026-08-12.png` (`defindex-beans-usdc`) — the
    underlying USDC alone.

## Non-negotiables held

No API change. No new external-provider fetch (logos still come from our own `/v1/pools`, F3). No
broken-image states — every unseeded asset/protocol degrades to a monogram via `BrandLogo`. Lending
rows are deliberately untouched.
