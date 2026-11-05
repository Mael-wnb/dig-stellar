# W1 — Identity fix: connect-signer attaches to the session account

Date: 2026-08-14 · Status: implemented, all green, awaiting line-by-line founder
review (the W1 review gate). Nothing committed.

## Rulings implemented (founder review of W0)

1. **Recovery preserved, made correct** — session userId present → attach in that
   account only; absent → deterministic signer-preferring recovery; watch-only
   elsewhere never recovers; no signer match → fork (unchanged old path).
2. **Demo-UUID fallback**: untouched (out of W1 scope), flagged as standing debt
   with a code comment on `normalizeUserId` (see Standing debt below).
3. **Same-userId watcher trap**: explicit wallet-store reload after attach; red
   tests (a)/(b)/(c) added.

## Diff map (for the line-by-line review)

### apps/api/src/modules/wallets/wallets.controller.ts
- `ConnectWalletBody` gains optional `userId` (the session account) + doc comment.
- `POST /v1/wallets/connect` passes it through to the service.

### apps/api/src/modules/wallets/wallets.service.ts
- `normalizeUserId`: STANDING-DEBT comment added (behavior unchanged).
- NEW `normalizeOptionalUserId`: absent/empty → null (recovery path); present →
  must be a valid UUID (400). Never defaults to the demo account.
- REMOVED `getWalletByAddress` (the global `limit 1`, no-ORDER-BY lookup that
  caused arbitrary account switching).
- NEW `getWalletByAddressForUser`: same row shape, `where user_id = $1::uuid`
  scoped.
- NEW `findSignerWalletByAddress`: recovery lookup — `is_active_signer = true`
  filter + `order by updated_at desc, id asc` (deterministic total order).
- `connectWallet` rewritten around the W1 rule set:
  - session userId → scoped lookup: found (watch-only OR signer) → single
    `promoteToActiveSigner` (promote-in-place / idempotent re-select); not
    found → `createWalletForUser` in the SESSION account + promote.
    `createdUser: false` on every session branch.
  - no session → signer-preferring recovery; only a signer-owning account is
    returned; else fork via `randomUUID()` exactly as before.
  - `promoteToActiveSigner` and the DB backstop index
    (`user_wallets_one_signer_per_user`) reused untouched — the singleton holds
    through every branch.

### apps/web/src/types/wallet.ts
- `ConnectWalletRequest` gains optional `userId`.

### apps/web/src/composables/useConnectFlow.ts
- `connect()` snapshots `previousUserId` and sends it in the connect payload.
- After `setUserId(backendUserId)`: if the id is UNCHANGED (attach to the same
  account) the `useSharedWallets` watcher never fires, so the store is reloaded
  explicitly (`loadOverview()`) — the W0 "watcher trap".

### apps/api/src/modules/wallets/wallets.connect.spec.ts (new)
Mock-prisma spec (style of `alerts.ownership.spec.ts`), 6 tests:
- (a) session present + unknown address → wallet row inserted under the SESSION
  user id; scoped lookup SQL asserted; `createdUser: false`.
- (a2) address already in the session account → promote in place, NO insert.
- (b) address watched by another account → no executed statement binds the other
  user; demote/promote WHERE clauses carry the session user only.
- malformed session userId → 400, no demo-UUID fallback.
- (c) no session → recovery SQL asserted (`is_active_signer = true`,
  `order by updated_at desc, id asc`, no user scoping) → signer owner recovered.
- (c2) watch-only-elsewhere only (no signer match) → fork: fresh UUID inserted,
  `createdUser: true` (guards the preserved fallback, green on old code too).

## Red-test proof (old behavior fails)

Ran the new spec against the pre-W1 `wallets.service.ts` (`git checkout HEAD --`,
then restored):

```
Test Suites: 1 failed, 1 total
Tests:       5 failed, 1 passed, 6 total
```

5/6 red — the only pass is (c2), which intentionally matches the preserved fork
fallback. Post-fix full runs:

```
apps/api : Test Suites: 6 passed · Tests: 48 passed (42 baseline + 6 new)
apps/api : nest build — clean
apps/web : Test Files 3 passed · Tests 111 passed (baseline unchanged)
apps/web : vue-tsc -b && vite build — clean
```

## Standing debt (ruling 2)

`normalizeUserId` (wallets.service.ts) silently maps an ABSENT userId to the
hardcoded demo account `00000000-0000-0000-0000-000000000001`; multiple read
routes depend on it. Out of W1 scope; flagged in-code. Any future auth work must
remove the fallback route-by-route.

## Pending (founder)

- Line-by-line review of the diff above (W1 review gate) before W2 starts.
- Manual flow capture for the DoD: connect a signer while a session account
  exists → wallet appears in the SAME account (the watch-only-first workaround
  is obsolete); recovery flow: cleared localStorage + reconnect → own account
  recovered.
- Commit (founder commits manually per the brief).
