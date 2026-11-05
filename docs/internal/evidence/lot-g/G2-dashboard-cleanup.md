# G2 — Dashboard cleanup — T3-D3, Lot G

Hero deduped; inline Testnet/Mainnet actions section removed and replaced by a
compact **Swap / Deposit** entry point that opens the existing `ActionModal`.
`apps/web` only. **No gate/flag/validator change.** Gates: `pnpm -C apps/web test`
**49/49** + `pnpm -C apps/web build` (vue-tsc + vite) green. Visual: `g2-hero.png`.

## G2.1 — Hero dedupe

The hero repeated XLM price, Stablecoin MCap and Protocols — the same figures the
four stat tiles below already show. Those three blocks are removed from the hero only.
The hero now holds **total TVL (big number) + freshness chip + the G4 chart slot**
(marked with a comment where the 7d curve lands). The four tiles are unchanged.
`xlmChange` / `xlmChangeColor` computeds stay — still consumed by the tiles.

## G2.2 — Actions section → compact button

Removed the inline section (`SdexSwapWidget` + `BlendDepositCard` + `NetworkToggle` +
the testnet-gate copy) from `DashboardView.vue`, plus its now-unused local flags code
(`network`, `MAINNET_ACTIONS_ENABLED`, `actionsLive`, `isMainnetLive` and the three
component imports). Added two compact buttons in the hero — **Swap** (accent) and
**Deposit** (ghost) — calling `openAction()` with the same `ActionContext` shape the
get-started card uses (`amm` / `lending`). The real widgets are untouched and now reached
only through `ActionModal`.

### Pre-deletion checks (brief-mandated) — all verified

1. **A swap is reachable in ≤ 2 clicks from the dashboard.**
   Dashboard hero **"Swap"** button → `openAction({kind:'amm'})` → `ActionModal` opens
   rendering the real `SdexSwapWidget`. **1 click.** ✓

2. **The ActionModal's own NetworkToggle (Lot C QA fix) still covers the testnet path;
   nothing else depended on the removed dashboard toggle.**
   `NetworkToggle` usages after the change: only `ActionModal.vue:93` (was: ActionModal +
   DashboardView). The removed section was indeed the only other toggle host on the
   dashboard. The modal's toggle lets the widget's "switch to Testnet" instruction stay
   actionable. (Stale comment in `ActionModal.vue` referencing "the toggle on the
   dashboard" updated.) ✓

3. **Testnet swap + deposit E2E unchanged (flags-unset behaviour byte-identical).**
   Both widgets **self-gate** on their own env flags + network, independently of the
   dashboard:
   - `SdexSwapWidget`: `MAINNET_SWAP_ENABLED = VITE_ACTIONS_MAINNET_ENABLED === 'true'`
     + `useNetwork().network` (mainnet blocked when the flag is off).
   - `BlendDepositCard`: `MAINNET_BLEND_ENABLED = VITE_ACTIONS_MAINNET_BLEND_ENABLED === 'true'`
     + `mainnetDepositBlocked = isMainnet && !MAINNET_BLEND_ENABLED`.
   The removed `actionsLive = network==='testnet' || MAINNET_ACTIONS_ENABLED` was a
   **UX-only render wrapper** — on testnet it was always `true`, so the widgets rendered
   exactly as they do now inside the modal. The real gate lives in the widgets (and the
   API kill-switch behind them), so testnet behaviour is unchanged and mainnet stays gated.
   No `.env` / flag / validator touched. ✓

4. **The get-started card and pool-detail action buttons still work (already use the modal).**
   `GetStartedCard.vue` (`openAction` for swap + deposit) and `PoolDetailView.vue`
   (Supply/Withdraw/Swap → `openAction`) are untouched and use the same
   `useModals().openAction` path. ✓

## Files touched

- `apps/web/src/components/views/DashboardView.vue` — hero dedupe, compact buttons,
  section removal, dead-code cleanup.
- `apps/web/src/components/modals/ActionModal.vue` — comment only (stale reference to the
  removed dashboard toggle).

## Out of scope (correct)

No G3 (pools table columns), no G4 chart (only the slot marker). Nothing committed.
