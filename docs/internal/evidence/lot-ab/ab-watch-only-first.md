# Lot AB — watch-only as first wallet (API mini-lot)

Date: 2026-08-20 · Branch `feat/ab-watch-only-first` · Scoped out of Lot AA by
founder ruling (2026-08-20): **Lot AA keeps its zero-API-change invariant**;
this is the one backend change the mobile entry path needs, isolated here.

## Why (AA0-a appendix finding, founder-confirmed on real device)

Mobile signing is not reliable (consultation-first verdict), and watch-only —
the natural mobile entry — required a connected signer first: `ConnectModal`
blocked it client-side, and the backend couldn't support it anyway because
`POST /v1/wallets` (`WalletsService.createWallet`) resolved an ABSENT `userId`
through `normalizeUserId()`, whose silent fallback is the shared demo account
(`00000000-…-0001`) — the W1 standing debt. A mobile visitor had no entry path.

## Change (wallets.service.ts only)

`createWallet` now resolves the userId with `normalizeOptionalUserId` (the
strict variant `connectWallet` uses):

- **Absent userId** → mint a real user (`randomUUID()` — the same pattern as
  `connectWallet`'s no-session recovery fork), insert the wallet under it, and
  return `{ created: true, createdUser: true, userId, wallet }` so the client
  adopts the new session. The row is **never promoted to signer** — tracking an
  address must not create signing power (non-custodial rule).
- **Present userId** → prior behavior unchanged (dedupe within the account,
  insert otherwise); response now also carries `userId` + `createdUser: false`
  (additive, no consumer breaks).
- **Invalid userId** → still 400; a typo never silently mints an account.
- Read routes keep the demo-account default — they depend on it; the rest of
  the W1 debt stays flagged, out of AB's scope.

Idempotency note: repeated no-session tracks of the same address mint separate
accounts by design — "watch-only-anyone legitimately allows duplicates" (W1);
within a session the client passes the adopted userId and dedupes as before.

## Evidence

- `wallets.watch-only-first.spec.ts` (4 tests, mock-prisma style of the W1
  connect specs): minted-user-not-demo · primary-but-never-signer ·
  present-userId-unchanged · invalid-userId-400.
- API suite: 129/129 green (125 before AB). `nest build` green.

## Deploy ordering constraint (IMPORTANT)

The AA3 frontend makes watch-only the primary mobile entry and calls
`POST /v1/wallets` **without** a userId on first track. Against a pre-AB API
that call attaches the wallet to the shared demo account and the client would
adopt the demo session. **Deploy AB to the VPS BEFORE (or with) the AA3
frontend merge to main** — the frontend prod deploy is instant on push,
the API deploy is manual.
