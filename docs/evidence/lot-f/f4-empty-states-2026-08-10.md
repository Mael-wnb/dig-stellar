# F4 — Logged-out state + get-started card + failed-tx copy (2026-08-10)

Lot F, step F4. Addresses advisor points **4** (hollow empty/logged-out states) and
**5** (a failed swap the UX didn't explain). See `advisor-feedback-2026-08-10.md`.

## What shipped (all `apps/web` — no API change)

1. **No wallet connected** → `components/common/EmptyPortfolioState.vue`. Replaces the
   bare "No wallets tracked yet" box in `PortfolioView`. Value prop ("Track your Stellar
   DeFi positions across wallets — non-custodial, read-only until you act"), CTA into the
   existing `ConnectModal` (`@connect` → `openConnect`), and a watch-only note. No new page,
   no router change. → `f4-portfolio-loggedout-2026-08-10.png`.

2. **Wallet connected, no positions** → `components/common/GetStartedCard.vue`, rendered by
   `PortfolioView` when `hasAnyPosition` is false (unscoped, so filtering to an empty wallet
   doesn't resurrect it). Up to three real actions:
   - **Fund your wallet** — plain copy only, no on-ramp integration.
   - **Try a swap** — opens the REAL SDEX swap action (`openAction`, `kind: 'amm'`).
   - **Deposit in Blend** — opens the REAL deposit action (`kind: 'lending'`) and shows the
     pool's REAL current supply APY from `/v1/pools` with a `FreshnessChip`.
   Honest copy (firm): APY labeled **"Current supply APY · variable"**, never projected
   earnings; on Mainnet a real-funds warning + the **100 XLM launch cap**; a
   **non-custodial** line always present. Card disappears as soon as a position exists. No
   sponsored placement. → `f4-getstarted-mainnet-2026-08-10.png` (shows real 2.15% APY from
   the Blend "Fixed" pool + an honest "Stale — data older than 45m" chip on the local DB).

3. **Failed-tx copy (F4.3)** in `SdexSwapWidget.vue` + `BlendDepositCard.vue`. A new
   `failedOnChain` flag is set **only** when a *submitted* transaction fails on-chain
   (swap: `sendTransaction` result not PENDING/SUCCESS; deposit: `sendTransaction` ERROR or
   `getTransaction` FAILED) — never for a pre-sign build / validation / preflight (F2) error,
   which never reaches the network. When set, the error card adds an honest explanation,
   worded per transaction type:

   - **Swap** (classic path payment — fee is the flat base fee, ~100 stroops):
     > The transaction failed atomically on-chain — no funds were moved. At most the base
     > network fee (~0.00001 XLM) was charged.
   - **Blend deposit** (Soroban — an included-but-failed invocation can consume part of the
     resource fee, ~0.06 XLM range observed, so no figure is quoted):
     > The transaction failed atomically on-chain — no funds were moved. Only the network
     > fee was consumed.

   plus the existing "Try again" retry affordance. This is the honest explanation the
   underfunded tx `a3acf8fa…` never gave the user; it pairs with F2, which now stops that
   specific case from reaching the signing step at all.

## Verification

- `pnpm -C apps/web build` (vue-tsc typecheck) — green.
- `pnpm -C apps/web test` — 49/49 green (validators untouched).
- Logged-out + get-started states captured headless against the real local API (this folder).
- Failed-tx copy is a conditional block in the two action widgets; exercised only on a real
  on-chain failure, so it is evidenced by code + the honest string above rather than a forced
  screenshot (no fabricated failure state).

## Non-negotiables held

Validators (`validateSwapXdr` / `validateDepositXdr`) and the flags regime untouched. No
direct external-provider fetch for core product data added (the APY comes from our `/v1/pools`).
Honest display throughout: real APY with freshness, no promised yields, no fake statuses.
