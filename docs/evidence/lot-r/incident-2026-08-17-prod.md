# Lot R — prod incident 2026-08-17: broken Blend modal + frozen claim panel

Two prod bugs after the Lot R deploy; founder applied two server-side fixes
(re-applied `stellar_v1_ops_metrics.sql` — the `action_events.metadata` column
was missing after an aborted pull skipped that file, so every build insert
failed silently → no build events → witnesses honestly returned
`no-matching-build`; and moved `GET /v1/faucet/eligibility` to the general
nginx zone while the claim POST stays strict). This note covers the code-side
root causes and fixes (uncommitted — founder commits + deploys).

## Bug 1 — Blend supply modal rendered no form (root cause: v-if chain break)

The R3 faucet promo note was inserted BETWEEN the card's
`v-if="mainnetBlendBlocked"` and `v-else-if="!isVettedPool"` — Vue chains
`v-else-if`/`v-else` off the immediately preceding sibling, so the whole
form's `v-else` chained off the PROMO's condition: campaign live + supply mode
→ promo true → form unreachable. It needed a live campaign on the card's
network to trigger, which the R3 validation (captures without opening the
modal) never exercised; locally it also hid behind a network mismatch
(mainnet card vs testnet campaign) until the modal was toggled to the
campaign's network.

Fix (R3c): the promo note moved INSIDE the form's `<template v-else>`; the
FaucetClaimPanel instances (which broke the success→pending and success→error
chains the same way — deposit-pending info box was silently skipped) moved
INSIDE their state blocks. Warning comments now sit at each chain.

Repro + proof: `fix-blend-modal-before.png` (live campaign, testnet toggle —
header/tabs/promo only, form gone) → `fix-blend-modal-after.png` (form back,
promo inside it). Verified after fix: supply AND withdraw panes render
(mainnet + testnet), and a real funded-account testnet deposit build returns
a simulated XDR.

## Bug 2 — claim panel UX (witness reasons, caching, 429)

1. **Witness-first verification**: the panel now re-POSTs the tx hash to the
   idempotent witness endpoint and SURFACES the honest witness reason
   (`no-matching-build`, `no-qualifying-op`, `unknown-wallet`, …) instead of
   polling eligibility forever. Only "not settled yet" reasons
   (`tx-not-found` / `tx-not-successful`) re-poll, inside a hard ~60s budget;
   every terminal state has a "Check again" button. An infinite spinner is
   impossible by construction.
2. **Caching**: `GET /v1/faucet/eligibility` now sends
   `Cache-Control: no-store` (verified via curl) AND the client fetches it
   with `cache: "no-store"` — a polled endpoint is never served 304/stale
   again.
3. **429 handling**: witness/eligibility polls and the claim POST detect 429
   (new `ApiError` with status in the web client), back off (10s) with honest
   "Rate-limited — retrying…" copy; the claim retries at most 3 times (safe:
   an edge 429 never reached the API).

## Data note (KPI evidence)

The founder's prod swap `bc3458b43aeb…e28a` can never be witnessed: its build
event was lost to the missing `action_events.metadata` column (insert failed
silently), and the witness's mandatory build-link honestly rejects a tx with
no recorded build. The founder redoes a fresh swap after this deploy — no
backfill invention.

## Validation

- api 122/122 tests, both builds green.
- Live repro before/after via CDP-driven headless Chrome against local
  api+vite with a live campaign (`FAUCET_ENABLED` + `FAUCET_ENDS_AT`).
- Deploy (founder): web build + api build + restart — SQL already applied.
