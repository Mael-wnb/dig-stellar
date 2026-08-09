# Lot C — Design Handoff Port (T3-D3 "Final UI polish") — Evidence

Captured 2026-08-05 against the local stack (`apps/api` on :3000 + real Mainnet
DB, `apps/web` dev on :5173). Serves **T3-D3 — Final UI polish based on Mainnet
feedback**: the full port of the co-founder's Claude Design handoff
(`design/2026-08-handoff/`) into the production Vue app, on real data with honest
states.

## Definition-of-done status

| DoD item | Result |
|---|---|
| `pnpm -C apps/web test` | ✅ 49 passed (3 files) |
| `pnpm -C apps/web build` (vue-tsc + vite) | ✅ green |
| `pnpm -C apps/api build` (nest) | ✅ green |
| All 5 views + modals ported, visually faithful, real data + honest states | ✅ captures below |
| `/v1/pools/:slug/flows` live (real event aggregation, section hidden where uncovered) | ✅ `stellar.service.ts` `getPoolFlows` |
| Security gates preserved (validation before every sign) | ✅ real widgets reused unmodified |

## What shipped

- **Shell** (`c1-shell.png`): persistent sidebar (5-view nav · real `user_wallets`
  · live Alerts unread badge · Live+network + socials footer) + topbar
  (per-view title/sub · real bell · real connect). `useView` extended to 5 views
  + a pool sub-view (no router — justified) with lightweight hash sync.
- **Pool detail** (`c2-pool-blend.png`, `c2-pool-aquarius.png`): type-variant
  stat strips, on-chain info with **real freshness chip**, reserves-&-rates
  (Blend) + reserve bars (AMM), Blend-only "Your position", risk signals
  (real rows only). **TVL history**: Blend-only honest reconstruction from
  `reserve_snapshots × latest price` rendered as a real chart; non-Blend keeps a
  "building history" note (no synthesized curve). **Inflows & outflows**: real
  `GET /v1/pools/:slug/flows`; hidden for uncovered pools.
- **Dashboard** (`c3-dashboard.png`): network hero + stat strip from
  `/v1/network/stats` (with freshness), protocol totals, alerts summary, the
  Testnet/Mainnet actions section (flags regime unchanged), and the bridge
  section — all real.
- **Protocols** (`c3-protocols.png`): per-protocol cards + sortable/filterable
  all-pools table; Lot B **STALE** badges preserved.
- **Portfolio** (`c4-portfolio.png`): liquid total kept **distinct** from DeFi
  supplied/borrowed/net; per-wallet cards with active-signer vs watch-only
  badges; Blend positions + HF colour states; by-position / by-wallet toggle.
- **Alerts** (`c4-alerts.png`): the existing real alerting in the shell (rule
  creation gated to the evaluated wallet·health-factor family); Mark-all-read wired.
- **Modals**: connect / add-wallet (`c5-connect-modal.png` — signer via Wallets
  Kit + watch-only add); create-alert (existing 4-step `AlertRuleModal`); action
  flow (`c5-action-modal.png` — the **real** SDEX swap / Blend deposit widgets in
  the design shell, gates + flags **untouched**, Add/Remove-liquidity tabs
  present-but-disabled "soon").

## Honest-state notes (realism over decoration)

- The local DB was last refreshed 2026-08-02, so freshness chips correctly read
  **Stale** and pool tables carry **STALE** badges — real, not decoration.
- `/v1/network/stats` is live-external (CoinGecko/DefiLlama, no persistence); it
  rate-limits under repeated calls and then returns `—` for the affected tiles
  (more honest than the old hardcoded fallbacks). The dashboard capture was taken
  when the externals were responding.
- Pool flows within a 24h/7d/30d window are near-empty on the current data (the
  real LP events predate the window, with a July gap) — covered pools show an
  honest empty-state; uncovered pools hide the section.
