# W0 — Account-model recon (report only, no code)

Date: 2026-08-14 · Scope: how identity works today, the connect-fork bug's mechanism,
label support, and everything W1 could break. All file:line refs verified against HEAD
(`85722dd`).

---

## 1. Where `userId` comes from, and why connect forks a new account

### Client side

- `userId` lives in localStorage under `dig_stellar_user_id`, restored/managed by
  `apps/web/src/composables/useAppUser.ts:4-44` (`restoreUser` / `setUserId`). It is a
  backend-minted UUID, not derived client-side.
- The Kit session (connected address + provider) is persisted SEPARATELY under
  `dig_stellar_connected_address` / `dig_stellar_connected_provider`
  (`apps/web/src/composables/useWalletSession.ts:17-18,49-55`). Two independent
  localStorage keys → the "session account" and the "connected wallet" can diverge.
- The connect flow: `useConnectFlow.connect()` at
  `apps/web/src/composables/useConnectFlow.ts:37-58` opens the Kit, then calls
  `POST /wallets/connect` with **only** `{ chain, address, label: '' }` (lines 43-47).
  **The current session `userId` is never sent.** It then unconditionally
  `setUserId(res.userId)` (line 52) — whatever account the backend answers with
  becomes the session.

### Server side

- The connect endpoint: `apps/api/src/modules/wallets/wallets.controller.ts:38-45`.
  Its body type `ConnectWalletBody` (lines 11-15) **has no `userId` field at all** —
  the API contract cannot express "attach to my account" today.
- `WalletsService.connectWallet` at
  `apps/api/src/modules/wallets/wallets.service.ts:484-537`:
  1. Looks the address up **globally** via `getWalletByAddress` (lines 310-338):
     `where lower(chain)=… and lower(address)=… limit 1` — **no `user_id` scoping and
     no ORDER BY**.
  2. If a row exists → promotes it to active signer **in whatever account owns that
     row** and returns `existingWallet.user_id` (lines 498-514).
  3. If no row exists → `const newUserId = randomUUID()` (line 516) →
     `createWalletForUser` + promote (lines 518-526). **This is the fork**: a fresh
     user is minted even when the caller already had a session account, because the
     request carries no userId to attach to.

### Is identity derived from the wallet address?

Effectively yes, on the connect path: the returned `userId` is either "the account
that first added this address" (service:502) or a brand-new UUID (service:516) —
never "the session's account". The frontend then adopts that answer verbatim
(`useConnectFlow.ts:52`). Elsewhere, identity is explicit: every other wallet route
takes `?userId=` (controller:60-151), and `useWallets.requireUserId()` threads the
stored id (`apps/web/src/composables/useWallets.ts:41-47`).

One more identity quirk: `normalizeUserId` **defaults a missing userId to the
hardcoded demo UUID** `00000000-0000-0000-0000-000000000001`
(`wallets.service.ts:200-214`) — any wallet read/mutation without an explicit userId
silently lands on the shared demo account. (v3 alerting documents the same default,
`apps/api/src/db/stellar_v3_alerting.sql:16`.)

## 2. What happens when the connected address already exists

DB constraint first: uniqueness is per-account — `unique (user_id, chain, address)`
(`apps/api/src/db/stellar_v2_multiwallet.sql:17-18`). The same address CAN legally
sit in several accounts (watch-only-anyone relies on this).

- **Already in the session account as watch-only** — `getWalletByAddress` may find
  *that* row, in which case promote-in-place works by accident and `setUserId`
  re-sets the same id (benign). BUT the lookup is global `limit 1` with **no ORDER
  BY** (service:329-331): if the address also exists in another account, Postgres
  returns an arbitrary row — the session can be switched to a stranger's account
  nondeterministically.
- **Already in ANOTHER account (only)** — the existing-wallet branch promotes the
  signer in *that* account and returns *that* `user_id` (service:501-505);
  `useConnectFlow.ts:52` adopts it → **the session silently switches to the other
  account** (exactly what W1 forbids). Side effect: the OTHER account's active-signer
  singleton is moved without its owner doing anything.
- **Not in any account** — new user forked (service:516) even if a session account
  existed. This is the founder-reported bug; the "watch-only-first workaround" works
  because watch-only add (`createWallet`, service:539-618) is user-scoped, so a later
  Kit connect finds the row inside the session account… as long as the address isn't
  in any other account too (same arbitrary-row hazard).

`promoteToActiveSigner` (service:1184-1229) itself is correctly user-scoped
(demote-others + promote, both `where user_id`), and the DB backstop is the partial
unique index `user_wallets_one_signer_per_user` (`stellar_v2_multiwallet.sql:119-120`).

## 3. Label support today

- **Watch-only add** — accepts a label: ConnectModal shows the optional label input
  (only when a watch address is typed — `v-if="watchInput.trim()"`,
  `apps/web/src/components/modals/ConnectModal.vue:108-114`) → `addWallet({ address,
  label })` (ConnectModal.vue:40) → `useWallets.addWallet`
  (`apps/web/src/composables/useWallets.ts:160-186`) → `POST /wallets` →
  `createWallet` persists it (service:548,607-612). Re-adding an existing address
  updates the label via `coalesce($2, label)` (service:575-599) — today's ONLY
  label-update path, and it's accidental.
- **Signer connect** — NO label anywhere: the modal's signer button has no label
  field, and `useConnectFlow.connect()` hardcodes `label: ''`
  (`useConnectFlow.ts:46`), which `normalizeLabel` nulls out (service:255-260).
- **Rename endpoint** — **none.** The controller exposes PATCH only for
  `/primary`, `/signer`, `/active` (controller:104-139) plus DELETE. No
  `PATCH /v1/wallets/:id { label }`. W2 must add it.
- **Render sites** (all use `label || fallback`):
  - Portfolio wallet cards: `apps/web/src/components/views/PortfolioView.vue:209`
    (`w.label || 'Wallet'`), also 65 (delete confirm), 114 (positions rows), 164
    (panel title).
  - Sidebar wallet list: `apps/web/src/components/shell/AppSidebar.vue:61,146`.
  - Pool-detail position panel: `apps/web/src/components/common/YourPositionsPanel.vue:56`.
  - Alert-rule modal wallet targets: `apps/web/src/components/AlertRuleModal.vue:66`.
  - Fallback is the literal string `'Wallet'` in most places, not the short address —
    W2's "short-address fallback everywhere" will need to touch these.

## 4. Everything keyed by user/wallet that W1 could break

**Keyed by `user_wallets.id` (FK, `on delete cascade`)** — survives a userId change
on the parent row, dies with the row:

- `wallet_balance_snapshots.user_wallet_id` (`stellar_v2_multiwallet.sql:34`)
- `wallet_protocol_positions.user_wallet_id` (v2 SQL:71)
- `wallet_pool_health.user_wallet_id` (v2 SQL:135)
- `alert_rules.user_wallet_id` (nullable = "all my wallets";
  `stellar_v3_alerting.sql:34`)
- `alert_rule_state.user_wallet_id` (v3 SQL:61)

**Keyed by plain `user_id` uuid (NO users table, NO FK)** — these silently detach if
an account forks or a wallet's `user_id` moves:

- `user_wallets.user_id` itself (v2 SQL:7)
- `alert_rules.user_id` — the ownership scope for every rule read/mutation
  (`apps/api/src/modules/alerts/alerts.repository.ts:286,303,362,378`) and the
  wallet-ownership check `assertWalletOwnedByUser`-style query (repository:393-395:
  `from user_wallets where id=… and user_id=…`)
- `notifications.user_id` (v3 SQL:76; feed queries repository:551,570,589)
- The alert evaluator joins `wallet_pool_health → user_wallets` to recover `user_id`
  at sweep time (repository:210-214) — so a forked account's new wallets are
  evaluated under the NEW user_id, while the old account's rules (old user_id) never
  match them.

**Concrete W1 hazards this implies**

- A rule with `user_wallet_id = NULL` means "all wallets of `user_id`" — fork the
  user and newly connected wallets fall outside every existing rule's scope.
- Notifications history is keyed by user_id: switching the session's userId (today's
  existing-wallet branch does this) orphans the feed the user was looking at.
- `deleteWallet` cascade wipes balances/positions/health/rule-state for that wallet
  (all the FKs above) — any W1 "merge/move" strategy must move rows, never
  delete+recreate.
- The actions module (`apps/api/src/modules/actions/`) is **address-based only** — no
  `user_id` / `user_wallets` references (verified by grep) — and the signing
  guardrail is client-side: `useActiveSigner` marks a context live iff the connected
  Kit address equals the designated signer address
  (`apps/web/src/composables/useActiveSigner.ts:3-19`), fed exclusively by
  `useWallets.syncActiveSigner()` (`useWallets.ts:55-58`). W1 stays out of both.
- `useWallets.hydrateFromConnect` (`useWallets.ts:303-322`) has **no callers**
  (grep-verified) — the connect response's embedded overview is currently discarded;
  `useSharedWallets` reloads via the `userId` watcher instead
  (`apps/web/src/composables/useSharedWallets.ts:17-27`). W1 can rely on that watcher:
  attaching to the SAME userId won't retrigger it (same value) — the fix must
  explicitly reload the overview after attach.

---

**Bug in one sentence:** the connect request cannot carry the session's userId
(neither the client sends it — `useConnectFlow.ts:43-47` — nor the API accepts it —
`wallets.controller.ts:11-15`), so the backend can only answer "the address's
existing owner, chosen arbitrarily across accounts" or "a fresh `randomUUID()` user"
(`wallets.service.ts:493-516`), and the client adopts whichever comes back
(`useConnectFlow.ts:52`).

STOP — awaiting founder review before W1.
