# Lot F — Advisor Feedback Polish (T3-D3) — Implementation Brief

Execution brief for Claude Code. Serves **T3-D3 criterion "Final UI polish based on Mainnet
feedback"** — this lot IS that criterion: every item below traces to real mainnet feedback
received 2026-08-10 (front advisor review + a real failed user swap). Written 2026-08-10
against current `main`; re-verify file states before editing. Internal target: before Aug 15.

## Evidence discipline (do this first)

Create `docs/evidence/lot-f/` and save:
- `advisor-feedback-2026-08-10.md` — the advisor's five points (Maël has the original message;
  paraphrase is fine, date it).
- `failed-swap-underfunded-2026-08-10.md` — tx
  `a3acf8fa9eb98935bcfa3d99ddc685b1d77cdf9fa5ec647afb7b27054a481d21` (mainnet), decoded result
  `pathPaymentStrictSendUnderfunded`: user had insufficient *spendable* XLM (reserves), tx
  failed atomically, only the 100-stroop fee charged. Motivates F2.
- Before/after screenshots for each step as it lands.

This feedback→fix loop is exactly what the tranche reviewer needs to see. Keep the trace.

## Non-negotiables (unchanged from Lots A/C)

- `validateSwapXdr.ts` / `validateDepositXdr.ts` and the pre-sign validation flow: UNTOUCHED.
- Flags regime (`ACTIONS_MAINNET_*`, `VITE_ACTIONS_MAINNET_*`): untouched.
- Honest display: 0 = measured zero, "—" = structurally N/A, no promised yields, no fake
  statuses. `apps/web` performs no direct external-provider fetches for core product data.
- Each step lands green independently: builds + `pnpm -C apps/web test` after every step.

## F1 — Contrast + scrollbars (CSS only, do first)

1. `--dig-faint` is `#5e5f5d` and is used as small-text color on dark cards — measure the
   actual contrast ratio against the real card background token, then raise the token until
   text usage clears **≥ 4.5:1** (expect to land around `#8a8b88`–`#9a9b98`). One token change;
   then a visual pass over all five views for anything that relied on the old darkness
   (dividers/decorative uses may keep a separate dimmer token if needed — introduce
   `--dig-faint-line` for those rather than leaving text unreadable).
2. Scrollbars are broken/ugly on the dark theme. Add global scrollbar styling consistent with
   the `--dig-*` tokens: `scrollbar-width: thin` + `scrollbar-color` (Firefox) and the
   `::-webkit-scrollbar`, `::-webkit-scrollbar-track`, `::-webkit-scrollbar-thumb` (+ hover)
   set. Check every overflow container: sidebar, tables (Protocols, Portfolio), modals, the
   activity feed.

## F2 — Spendable-balance preflight on swap (from the real failed tx)

Root cause to prevent: the widget lets a user build and sign a swap that cannot succeed
because Stellar reserves lock part of the XLM balance (1 XLM base + 0.5 per subentry +
selling liabilities). Layer ownership says this check belongs in the API, which already
fetches the Horizon account for the trustline gate (INV-5.1):

- `apps/api` `buildSwap` (and quote if cheap): from the already-fetched Horizon account,
  compute spendable for the send asset — XLM: `balance − (2 + subentries) × 0.5 −
  selling_liabilities − fee buffer (0.01)`; non-native: `balance − selling_liabilities`.
  If `sendAmount > spendable` → clean 400 with machine-readable code
  (`INSUFFICIENT_SPENDABLE_BALANCE`) + the spendable amount in the message.
- `apps/web` SdexSwapWidget: render that 400 as a friendly, honest message: "Insufficient
  balance: X.XX XLM available — the rest is reserved by the Stellar network." No silent
  disable without explanation.
- Applies to both networks (testnet behavior identical, it just never hit the case).
- Same check for the Blend deposit build (it shares the account fetch) — cheap while in there.
- Tests: unit-test the spendable computation (subentries, liabilities, non-native asset);
  one controller test for the 400 path.

## F3 — Real logos, served by the backend

Beta-first version (decision — no runtime TOML/stellar.expert fetching, no scraping):

- DB: add nullable `logo_url TEXT` to `venues` and `assets` (raw SQL migration consistent
  with the v1 pipeline; Prisma models untouched).
- Seed (bootstrap script, one-shot, idempotent upsert): official logo URLs for the 5 venues
  (Blend, Soroswap, Aquarius, Stellar/native, DeFindex) + Allbridge, and the whitelisted
  assets (XLM, USDC, EURC, AQUA, yXLM, PYUSD). Prefer stable official sources (project brand
  assets / GitHub raw); record each URL's source in the seed comments.
- API: expose `logoUrl` in `/v1/protocols`, `/v1/pools` (per pool venue + per reserve asset
  where the payload already carries assets). Null when unset.
- Web: render with graceful fallback to the current placeholder (initial/monogram) via
  `@error` — a dead URL must never show a broken-image icon.
- Note in the seed: hotlinked URLs are acceptable for beta; vendoring the images into our own
  hosting is a post-beta hardening line.

## F4 — Logged-out state + Get-started (one subject: the "empty" Portfolio)

The dashboard/analytics stay public — that is a strength, don't gate them. This step gives
the two empty states a real design instead of a hollow shell:

1. **No wallet connected** (Portfolio + wallet-dependent sections): a proper state component
   (not a new page, no router change): one-line value prop ("Track your Stellar DeFi
   positions across wallets — non-custodial, read-only until you act"), CTA → existing
   ConnectModal (Wallets Kit + add-by-address/watch-only both reachable).
2. **Wallet connected, no positions**: a "Get started" card with up to three real actions:
   fund your wallet (plain copy, no on-ramp integration), try a swap (opens the real swap
   action), deposit in Blend (opens the real deposit action, shows the pool's REAL current
   supply APY from our API data with its freshness). Copy rules (firm): APY labeled as
   current/variable, never projected earnings; real-funds warning + the 100 XLM cap mention
   on mainnet; "non-custodial — you sign everything in your wallet" line. Card disappears as
   soon as a position exists. No sponsored placement of any kind in this lot; if that ever
   ships it will be explicitly labeled.
3. While in there: the failed-tx UX copy — when a submitted action returns failed, the error
   state explains "the transaction failed atomically on-chain — no funds moved (network fee
   ~0.00001 XLM)" with the retry affordance. Pairs with F2.

## Sequencing

F1 (CSS, ~1h) → F2 (API + widget) → F3 (DB/seed/API/front) → F4 (states + copy).
Each step: builds green, web tests green, screenshot to `docs/evidence/lot-f/`, commit.

## Definition of done

- Contrast of `--dig-faint` text usages ≥ 4.5:1 verified against the real backgrounds;
  scrollbars consistent in Chrome + Firefox.
- A swap for more than the spendable balance returns the clean 400 and the widget explains
  it; the underfunded failure mode of tx `a3acf8fa…` can no longer reach the signing step.
- `/v1/protocols` and `/v1/pools` expose `logoUrl`; UI shows real logos with safe fallback.
- Both empty states shipped with the honest copy above; get-started disappears when a
  position exists.
- Evidence folder populated (advisor feedback, failed-tx writeup, before/after captures).
- Flag for next docs sync: `current-state.md` (frontend + API sections), `status-board.md`
  T3-D3 row.

## Out of scope

Sponsored/get-started monetization · marketing landing page · runtime TOML/stellar.expert
logo resolution · vendoring logo images · mobile responsive pass · light mode · INV-4.4
(server-side destMin — separate backlog line) · any change to validators or the flags regime.
