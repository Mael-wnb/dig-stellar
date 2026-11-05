# H7 — Compact position chips + health-factor gauge (display polish on H6)

Lot H (T3-D3). Date: 2026-08-14. Display-only, web-only: **no API, schema, indexer or action
path touched.**

## 1. Compact chip amounts, exact on hover

H6 printed the full stored amount in every chip (`200,000.0232 XLM`), which read as noise at a
glance. H7 compacts the chip and moves the exact value to the hover title — precision is
**relocated, not dropped**.

New `formatTokenAmountCompact` in `utils/format.ts`:

| magnitude | renders | example (real data) |
|---|---|---|
| ≥ 1e9 / 1e6 | `1.2B` / `15.2M` | — |
| ≥ 1e5 | `240k` | `200,000.0232 → 200k` |
| ≥ 1e3 | grouped integer | `15,041.2688 → 15,041` |
| ≥ 1 | ≤2 decimals, trimmed | `69.0042 → 69` |
| > 0 | ≤4 decimals | `0.4232`; `<0.0001` rather than a lying `0` |

Still deliberately **not** `formatCount` — that rounds every sub-1000 value to a whole unit and
would render a real `0.42 XLM` position as `0`.

New `formatTokenAmountExact` backs the hover title, which carries side + exact amount + symbol
(e.g. `Supplied 150,007.9838593 XLM`). It applies **no rounding at all** — the number's own
decimal representation with thousands grouping added.

Boundary behaviour verified against the real stored values and the rounding edges
(`999,499 → 999k`, `999,500 → 1M`, `99,999 → 99,999`, `100,000 → 100k`, `0.00001 → <0.0001`).

**Labels.** `SUPPLIED` / `BORROWED` now appear only when there are two sides to separate. A
supply-only position drops the label and shows chips alone (visible on the third position in the
capture: `1,001 USDC · 69 XLM`).

> Judgment call worth flagging: the brief said "when a position has no borrowed leg, drop the
> SUPPLIED label". I implemented the label drop for **supply-only** positions specifically. A
> position whose only side is *borrowed* keeps its label, because bare chips read as "supplied"
> by default — dropping it there would create exactly the misreading the labels exist to prevent.
> Blend positions are effectively always collateral-backed, so this branch is defensive.

## 2. Health-factor gauge

New `components/common/HealthFactorGauge.vue` replaces the bare `HF 1.23` text in the
`PortfolioView` rows (both view modes) and the dashboard `YourPositionsPanel` (dense variant).

- Continuous red→amber→green gradient anchored to the **existing** `utils/health.ts` thresholds
  (red < 1.2, amber 1.2–1.5, green ≥ 1.5). On the 1.0–2.0 scale that puts 1.2 at exactly 20% and
  1.5 at exactly 50%, so the bar and the coloured number can never disagree.
- Scale runs from `1.0` (liquidation) and is **clamped at 2.0+**; the hover title says so
  (`Health factor 1.3512 — liquidation at 1.00`, plus `(scale clamped at 2.00)` when clamped).
- Marker at the user's HF, with the numeric value beside it — still `hfDisplay`, so the colour
  rule stays a single source of truth.
- **`No borrow` renders NO gauge** — text only, exactly as today. A full green bar there would
  invent a safety margin the user does not have. Visible on the third position in the capture.

## Capture

Same method as H6 / F4 / H2 / H3: headless Chrome over CDP, local dev server + the **real local
API** against the live dev DB. Same wallets, same snapshot, same framing as the H6 capture.

| | before | after |
|---|---|---|
| Portfolio, by position | `h7-portfolio-by-position-before.png` | `h7-portfolio-by-position-after.png` |
| Portfolio, by wallet | `h7-portfolio-by-wallet-before.png` | `h7-portfolio-by-wallet-after.png` |
| Dashboard (full) | `h7-dashboard-before.png` | `h7-dashboard-after.png` |
| Dashboard panel (crop) | `h7-dashboard-panel-before.png` | `h7-dashboard-panel-after.png` |

The `h7-*-before.png` files are byte-identical copies of the `h6-*-after.png` captures (verified
by md5): H6's after-state *is* H7's before-state — H7 is the only change since, and the
underlying snapshot did not move. They are duplicated under the `h7-` prefix so the pair reads
standalone, not re-shot or re-staged.

## Verification

- `pnpm -C apps/web build` (vue-tsc typecheck) — green.
- `pnpm -C apps/api build` — green.
- `pnpm -C apps/api test` — 42/42 green.
- Formatter boundaries exercised directly against `utils/format.ts` (table above).
- USD totals, health factors and position ordering unchanged from H6 (`$41.2k` / `$20.2k` /
  `$960.57`, `HF 1.35` / `HF 1.27` / `No borrow`) — this lot changes rendering only.

## Scope

Web display only. `utils/health.ts` thresholds unchanged; API, schema, ingestion, alerting and
every action path (XDR building, validators, flags) untouched.
