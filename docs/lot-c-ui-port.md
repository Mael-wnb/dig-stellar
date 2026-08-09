# Lot C — Design Handoff Port (T3-D3 "Final UI Polish") — Implementation Brief

Execution brief for Claude Code. Serves **T3-D3 criterion "Final UI polish based on Mainnet
feedback"** — the full port of the co-founder's Claude Design handoff to the production Vue app.
Written 2026-08-04. Internal target: Aug 15.

## Source of truth

The design bundle lives at **`design/2026-08-handoff/`** in this repo (copied from the Claude
Design export). Per its own README: **read `project/Dig Stellar.dc.html` IN FULL, top to bottom**
(it is the primary design), then follow its imports (`support.js`, assets). The design medium is
HTML/CSS — recreate it **pixel-faithfully** in Vue; match the visual output, not the prototype's
internal structure. Fonts: **IBM Plex Sans + Geist Mono** (Google Fonts; replaces Clash Display).
Assets (dig wordmark, protocol logos, background) are in the bundle — move what's used into
`apps/web/src/assets/`.

## What the design is

A 5-view application + sidebar shell + modals:
SIDEBAR (nav + wallets + footer) · DASHBOARD · PROTOCOLS · POOL DETAIL · PORTFOLIO · ALERTS ·
MODALS (connect/add wallet · create alert · 4-step action flow: Configure → Review XDR/txrep →
Sign → Success).

Current app: a single scrolling `DigDashboard` + `AlertsView` via `useView`. This lot introduces
the real view structure (extend `useView` to the five views, or introduce vue-router if that is
genuinely simpler — justify the choice; beta-first says don't add a router "just in case").

## Cardinal rule — realism over decoration

Everything rendered in prod is REAL or explicitly labeled "soon"/disabled. No mock numbers, no
fake statuses, no simulated earnings. Every card gets loading / empty / error / stale states.
This is the same rule that shaped the alerts page (creation gated to the one evaluated family)
and the DeFindex vault panel (no fake AMM metrics).

## Design → data reality mapping (the substance of this lot)

**SIDEBAR** — nav items map to the five views; the Alerts badge = real unread notifications
count (`useNotifications`). WALLETS section = the real `user_wallets` list (label or short
address, active-signer indicator, watch-only distinction — reuse T2-D1 semantics); "+ Add wallet"
opens the existing connect/add flows (design's CONNECT/ADD WALLET modal). Footer: Live dot +
current network (real), X/Discord links.

**DASHBOARD** — hero + stat strip from `/v1/network/stats` (with freshness), protocol totals,
the bridge section (existing `useBridge` data, restyled), alerts summary card (real
notifications). Keep the Testnet/Mainnet actions section behavior (flags regime untouched).

**PROTOCOLS** — protocol cards/table + sortable pool table from existing `/v1/*`. Keep the Lot B
freshness chip + stale badges (restyle, don't remove).

**POOL DETAIL** — the richest page:
- Stat strip TVL / Volume 24h / Fees 24h / Swaps 24h / Events 24h: real from pool metrics; for
  vault/lending types keep the honest per-type variants (no AMM boilerplate on Blend/DeFindex —
  the existing type-variant precedent carries over into the new skin).
- **TVL & volume 30d chart**: OPEN TECHNICAL POINT — verify what history actually exists
  (`pool_snapshots` / `reserve_snapshots` per refresh cycle). If a real series can be derived,
  add it to the pool-detail payload (or a small `/v1/pools/:slug/series`); if history is thin,
  render the chart with whatever exists + an honest "building history since <date>" note. Never
  synthesize a curve.
- On-chain info card: all real (protocol, humanized type, chain, contract link, Updated +
  freshness chip).
- Reserves breakdown bars: real reserve data.
- **"Your position" card: Blend-only, honest** (decision). Appears only on Blend pools when the
  connected/tracked wallets hold a position: supplied / borrowed / health factor (T2-D1 data).
  No earned/APY-earnings numbers (we don't compute earnings), no LP positions on AMM pools —
  the card simply doesn't render there.
- **Risk signals card**: each row only if real — Data freshness = REAL (`isStale`/`ageSeconds`
  from Lot B; "Fresh · Xs/Xm"); Utilization = real for Blend (borrowed/supplied from pool
  metrics), omit the row elsewhere; Oracle / Trustline flags: include ONLY if cheaply real
  (e.g. Blend oracle status if we have it), otherwise OMIT the row — never render "Nominal" as
  decoration.
- **Inflows & outflows section — build the endpoint** (decision): `GET /v1/pools/:slug/flows` —
  on-read aggregation over `normalized_events` (deposit/withdraw/liquidity event families),
  same pattern as `/v1/bridge/*` (windows 24h/7d/30d, net per bucket, totals; no new tables).
  Coverage is Soroban pools with normalized events (Aquarius/Soroswap/Blend); HIDE the section
  for pools without event coverage (stellar-native trades ≠ flows, DeFindex) rather than
  showing zeros. UI copy stays honest about the window (same ~retention constraint story as the
  bridge card if applicable).

**PORTFOLIO** — real `wallets/overview` data: hero total (liquid) kept distinct from DeFi
supplied/borrowed (never folded into one number — existing rule), per-wallet rows, "Your open
positions" = Blend positions + HF with the colour risk states, by-wallet / by-position toggles
over the same data. Watch-only vs active-signer badges carry over.

**ALERTS** — restyle the existing real alerting (activity feed, rules list, bell, "Mark all
read" if implemented — otherwise wire it: `useNotifications` likely supports it or add the small
endpoint). Rule creation stays gated to the evaluated family (wallet · health-factor), other
metrics "soon" — the existing honesty pattern survives the reskin.

**MODALS**
- Connect / add wallet: wire to the existing Wallets Kit + add-by-address flows.
- Create alert: the existing 4-step `AlertRuleModal` content in the new skin.
- **Action flow (Configure → Review → Sign → Success)**: wire the REAL actions — SDEX swap and
  Blend deposit — into this shell, keeping the flags regime and the pre-sign validation gates
  exactly as they are. The **Review step** shows the decoded transaction summary (+ XDR): feed
  it from what the validation gate already decodes — the design step and our security model are
  the same idea; make the gate's verdict visible ("Verified against your request ✓").
  **Add liquidity / Remove liquidity tabs: PRESENT but disabled "soon" in this lot** — they go
  live with Lot D (liquidity actions API, separate brief, own kill-switch). Do not build any
  liquidity backend here.

## Sequencing inside the lot (each step lands green)

C1 sidebar + view shell (+ fonts/theme tokens) → C2 pool detail + flows endpoint (+ series
check) → C3 dashboard + protocols → C4 portfolio + alerts → C5 modals (real actions into the
new flow). After each step: builds green + existing tests pass + a visual check against the
design HTML (headless screenshot side-by-side, as done for the DeFindex panel).

## Non-negotiables

- No regression on: mainnet/testnet swap E2E, Blend deposit flow, alert create round-trip,
  wallet add/refresh, freshness indicators, security gates (validation before EVERY signing
  prompt — the new modal must call the same validators).
- The flags regime is untouched; testnet-only behaviors with flags unset stay byte-for-byte.
- Responsive: the new shell must not break at laptop widths (the design is desktop-first; a
  full mobile pass is out of scope, but nothing may overflow unusably).

## Definition of done

- All 5 views + modals ported, visually faithful (side-by-side captures saved to
  `docs/evidence/lot-c/`), on real data with honest states.
- `pnpm -C apps/web test` (49) green · both builds green · testnet swap + deposit re-verified.
- `/v1/pools/:slug/flows` live with real event aggregation (+ tests if the aggregation has any
  subtlety), section hidden where uncovered.
- Docs: `current-state.md` frontend section + `status-board.md` T3-D3 row flagged for the next
  sync; screenshots for the T3-D3 demo capture.

## Out of scope

Liquidity actions API (Lot D — separate brief after C lands) · mobile-first responsive pass ·
theming/light mode · any new alert rule families · earnings/PnL computation.
