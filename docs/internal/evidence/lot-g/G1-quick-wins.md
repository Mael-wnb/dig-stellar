# G1 — Quick wins (presentational) — T3-D3, Lot G

Three presentational fixes. All `apps/web` only; no API/indexer/gate/validator change.
Gates: `pnpm -C apps/web test` **49/49** + `pnpm -C apps/web build` (vue-tsc + vite) green.

## G1.1 — Bridge chain logos

Bridge rows rendered source chains as letter monograms ("S", "P"…). Now they render
a bundled brand mark through `BrandLogo`, with the monogram as the safe fallback
(a dead/absent SVG can never show a broken image).

- New bundled SVGs: `apps/web/src/assets/chains/{solana,polygon,base,celo,ethereum,bnb,arbitrum}.svg`
  — simplified in-house brand glyphs (source URLs recorded in `useBridge.ts`),
  swappable for official brand-kit SVGs later.
- `useBridge.ts`: `CHAIN_LOGO` map + `logo` threaded through `chainStyle()` and the
  `BridgeRouteRow` / `BridgeFlowRow` view-models (spread via `...chainStyle(chain)`).
- `BridgeRoutesTable.vue` + `BridgeFlowsFeed.vue`: monogram `<span>` → `<BrandLogo>`.

**Coverage decision (flagged for review):** the brief named SOL/POL/CEL/BAS. Checking
the live `bridge_flows` data, the actual chain distribution is:

```
BAS 110 · POL 90 · ETH 70 · SOL 44 · ARB 38 · BSC 30 · CEL 15 · TRX 7 · AVA 6 · ALG 4 · SUI 3 · OPT 1 · SNC 1
```

ETH/ARB/BSC are as present as the four named — covering only the four would leave a
ragged logo/monogram mix on the most-visible rows (exactly the founder complaint).
So I bundled the **top 7 by volume** (BAS, POL, ETH, SOL, ARB, BSC, CEL). The long tail
(TRX/AVA/ALG/SUI/OPT/SNC — 22 flows total) keeps the clean monogram. Veto welcome.

Visual: `g1-chain-logos.png` (rendered at the app's 30px chip size) + `g1-chain-logos-preview.html`.

## G1.2 — Clickable tx hashes

Swept every rendered hash. The **only** plain-text hash in a feed was the bridge
recent-flows `txHash`. Pool-detail "flows" is an aggregate inflow/outflow chart (no
per-tx hashes); notifications carry no hashes; the swap/deposit action widgets already
render a hash next to a "View on stellar.expert ↗" link (the reference pattern).

- New `apps/web/src/lib/explorer.ts` — `stellarExpertTxUrl(hash, network='public')`,
  the same URL shape the action widgets use inline. Bridge flows are Stellar-mainnet
  data → `public`.
- `BridgeFlowsFeed.vue`: hash → `<a target="_blank" rel="noopener">` with a `↗`
  affordance, hover accent, and `@click.stop` (so it doesn't trigger the row). Empty
  hash renders "—", never a dead link.
- `SdexSwapWidget.vue` + `BlendDepositCard.vue`: made the hash text itself a link too
  (reusing their existing `explorerNetwork` computed) so every visible hash is clickable.
  Success-panel only — the pre-sign validation flow / `validateSwapXdr` / `validateDepositXdr`
  are untouched.

## G1.3 — Protocol card alignment

The per-type summary cards had ragged metric rows (`flex gap` with a variable slot
count: lending/AMM = 3, vault = 2). Now every card is a **rigid `grid grid-cols-3`**:
TVL + exactly two type-specific slots, identical label/value baselines across all cards.

- `ProtocolsView.vue`: vault gains a third slot (**Pools** = pool count) so it fills the
  grid; lending (TVL · Avg supply APY · Avg borrow APY) and AMM (TVL · 24h vol · Fees 24h)
  already had three. Values `truncate` inside `min-w-0` cells so a wide number can't break
  the grid. N/A honesty unchanged ("—" where structurally absent, never a synthetic $0).

Visual: `g1-protocol-cards.png` — before (ragged, vault 2 slots) vs after (rigid 3-slot
grid, aligned baselines), representative values + real card CSS. A live capture against
the running app (API+DB) can be added on request.
