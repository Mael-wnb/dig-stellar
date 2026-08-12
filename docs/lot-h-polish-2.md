# Lot H — Second Polish Pass (T3-D3) — Implementation Brief

Execution brief for Claude Code. Serves **T3-D3 "Final UI polish based on Mainnet feedback"**
— second founder product review, 2026-08-12 evening. Written against current `main`;
re-verify file states before editing. Evidence: `docs/evidence/lot-h/`.

## Non-negotiables (standing)

- `validateSwapXdr.ts` / `validateDepositXdr.ts` and the build → validate → sign flow:
  UNTOUCHED. H3 is a PRESENTATION-ONLY reskin of the swap widget — every gate, flag check,
  validation call and signing prompt stays byte-identical in behavior.
- Flags regime untouched. Honest display rules unchanged (0 = measured zero, "—" = N/A,
  hide > fake, never synthesize).
- Each step lands green (`pnpm -C apps/web test` + builds) with a capture to
  `docs/evidence/lot-h/`.

## H0 — Flows recon (read-only, ships a REPORT before any H4 code)

The pool-detail "Inflows & outflows" section shows permanent $0 on every pool. Two distinct
suspicions to confirm with evidence:

1. **Lot C rule violation**: `docs/lot-c-ui-port.md` mandated "HIDE the section for pools
   without event coverage rather than showing zeros." Zeros are rendering — either the
   coverage detection is broken or the rule was never implemented. Find which.
2. **Data reality**: what does `normalized_events` actually contain per venue? Run the
   counts: event families (swap / deposit / withdraw / liquidity add-remove) × venue ×
   time. Likely finding: Soroswap/Aquarius normalizers capture SWAP events only, no
   liquidity events; Blend has no event ingestion at all (state-only adapter);
   stellar-native/DeFindex structurally have none. Confirm or refute with the actual rows,
   and check what `GET /v1/pools/:slug/flows` aggregates over (which event families).

Report: per-venue coverage table + root cause of the zeros + a scoped recommendation for
H4 (see the three scopes there). STOP after the report — H4 waits for review.

## H1 — Alert modal truncation (bug fix, do first alongside H0)

The "New alert" modal (`AlertRuleModal`) opens vertically off-screen — the top third is
cut. Fix the positioning: the panel must fit the viewport (`max-height` ≈ 90vh, internal
`overflow-y: auto`, true centering — likely a fixed-height/absolute-offset issue). While
in there, check every modal (ActionModal, ConnectModal) at a small laptop height
(~1280×720): none may open with content off-screen. Capture before/after.

## H2 — Dashboard layout: protocols half-width + "Your positions" panel (decision)

The protocols box spans the full width to show five rows — too empty. New layout:

- Protocols box drops to half width (keep rows exactly as they are — name, TVL,
  freshness dot, click-through).
- New right panel, same height: **compact "Your positions" recap** (the founder's
  co-founder proposal, decided). Reuse the F4 state machinery — do NOT invent new states:
  - No wallet connected → compact variant of the `EmptyPortfolioState` value prop + the
    same Connect CTA.
  - Wallet connected, no positions → compact variant of the `GetStartedCard` (same real
    actions, same honest copy — reuse/parameterize the component rather than forking it).
  - Positions exist → liquid total and DeFi supplied/borrowed shown DISTINCT (never one
    folded number — standing rule), top 2–3 Blend positions with the HF colour states,
    and a "View portfolio →" link to the Portfolio view.
- Same `wallets/overview` data the Portfolio already fetches (shared composable — no new
  endpoint, no duplicate fetch if the composable already caches).
- Laptop-width responsive: the two panels stack cleanly below ~1100px, nothing overflows.

## H3 — Swap widget: Uniswap-standard reskin (presentation ONLY)

The current asset pickers are native `<select>` elements (OS dropdown — jarring against
the new UI). Bring the widget to the industry-standard swap layout:

- Custom token selector: button showing the asset's `BrandLogo` + symbol; opens a styled
  dropdown/panel listing the allowed assets (the SAME whitelist the widget already uses —
  the selectable set must not change) with logo, symbol, name. Keyboard + click-outside
  close. No search field needed at 6 assets.
- Amount input: large numeric field with the balance line ("Balance: X.XX — Max" if a
  balance is already available in the widget's state; do not add new fetches).
- Flip button between From/To (already exists functionally — restyle).
- Quote display, slippage note, warnings, error/success panels: keep the existing content
  and states, restyled to match. The F2 insufficient-balance message and F4 failed-tx
  copy carry over verbatim.
- Scope: `SdexSwapWidget.vue` presentation + a small `TokenSelect` component. The deposit
  card gets ONLY incidental alignment fixes if its layout visibly clashes next to the new
  swap — no reskin. Works identically inside `ActionModal` (its primary host since G2).
- The review gate for this step is strict: the diff must show zero changes to build
  payloads, validation calls, signing, flags, or the asset whitelist.

## H4 — Inflows & outflows: per the H0 verdict (STOP-gated)

Three scopes, chosen by the recon report — they compose:

1. **Enforce the Lot C hide rule everywhere** (always in scope): pools with no event
   coverage hide the section entirely — no permanent-$0 sections anywhere.
2. **If the events exist but the aggregation misses them** (family naming, window, pair
   filter): fix `GET /v1/pools/:slug/flows` aggregation. Cheap, do it.
3. **If AMM liquidity events are simply not normalized** (the likely case): extend the
   Soroswap + Aquarius normalizers to the liquidity event families (add/remove →
   deposit/withdraw rows in `normalized_events`, same idempotent persist pattern as
   swaps, amounts priced via `asset_prices` like the bridge). Backfill is bounded by
   Soroban `getEvents` retention (~7 days) — the section's copy stays honest about the
   window (the bridge card precedent). This is the founder's "real credibility" ask.
   Blend event ingestion is OUT of this lot (state-only adapter stays; Blend hides the
   section per rule 1).

Calendar guard: if the recon sizes scope 3 above ~half a day, report back BEFORE starting
— it competes with Lot E (observability), which must not slip past Aug 14.

## Sequencing

H0 (recon report) + H1 (modal fix) first, in one session — then STOP for review.
Then H2 → H3 (each green + captured + committed by the founder) → H4 per verdict.

## Definition of done

- Alert modal (and every modal) fully visible at 1280×720; captures saved.
- Dashboard: protocols half-width + positions panel with all three states honest and
  working; laptop-width stack verified.
- Swap widget at Uniswap-standard polish with a diff provably confined to presentation.
- No pool page shows a permanent-$0 flows section: real data where coverage exists,
  hidden where it doesn't, honest window copy where partial.
- Evidence folder populated; docs sync flagged (`current-state.md`, `status-board.md`).

## Out of scope

Blend event ingestion · new alert rule families · Lot E observability (separate brief,
next) · mobile pass · light mode · any validator/flag/whitelist change.
