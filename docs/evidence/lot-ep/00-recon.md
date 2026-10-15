# EP0 — Earn & Points: read-only recon (2026-10-15)

Scope: establish, from the code at `6ee8721` (main), what exists today for wallet identity,
action recording, the faucet's anti-abuse logic, the DB, the web shell, the jobs and the
analytics, and derive the smallest credible plan for an in-app points campaign ("Earn"
page + leaderboard). Post-grant product work: it serves product growth and SCF 46 material,
not an SCF 43 criterion.

Nothing was modified, run on the VPS, committed or pushed. Only this file was created.
Every claim below carries a `path:line` reference verified with `grep -n` / `sed -n`.
Env variables are named, never valued.

Decisions already taken (restated so the plan is read against them):

- Points only. No monetary value, not convertible to money or tokens. Perks are non-monetary
  (beta access, early features, priority access, community roles). No token or airdrop promise
  anywhere in code, copy or docs.
- No payouts in v1: no reward transfers, no payout CSV, no new signing key. The faucet payout
  key (`docs/security-invariants.md` §9) stays the only server-side key and is not touched.
- Social tasks earn points, multipliers allowed, self-declared + handle uniqueness in v1 (no X API).
- Third-party APRs/APYs stay exactly as the protocol reports them. Points sit beside them as
  "+N pts", never inside a yield figure.
- Light anti-sybil: one X handle per wallet, on-chain points only after Horizon verification,
  referral credited only after the referee's first verified on-chain action, per-wallet daily
  cap on social points.
- Action validators, flags, whitelists and kill-switches are never touched.

## 0. Summary

- **Wallet identity is a bare `userId` UUID in localStorage, sent as `?userId=`.** There is no
  auth guard, no session, no signed proof, no SEP-10 (§1). The wallet kit already exposes
  `signMessage`; a signed-nonce proof verified with the public key only is the smallest addition.
- **Verified on-chain actions already exist as a ledger:** `POST /v1/actions/witness` verifies a
  tx hash against Horizon and writes `action_witnesses` (§2). The points system should consume
  that table, not re-verify.
- **The faucet's anti-abuse logic is a pure function plus DB unique indexes**; the payout path is
  one isolated service that nothing else can import (§3). Reuse the pattern, not the module.
- **Schema discipline is "one idempotent SQL file, applied by hand in order"** with three
  divergent file lists, one of which already misses `stellar_v5` (§4). A new `stellar_v6` file
  must be added to all three lists.
- **Adding a view is a five-file change** with `#status` as the exact precedent; there is no i18n
  and no shared table component (§5).
- **There is zero product analytics**; the only honest campaign numbers derivable today are
  registrations (`user_wallets.created_at`) and verified executions (`action_witnesses`) (§8).
- **One pre-existing issue matters more once points exist:** the no-session wallet-connect
  recovery path hands an account to anyone who posts a signer's public address (§1.5, §9).

## 1. Wallet identity

### 1.1 Web: which kits, where the state lives

- Both `@creit.tech/stellar-wallets-kit ^1.0.0` and `@stellar/freighter-api ^6.0.1` are declared
  (`apps/web/package.json:14-15`). **Only the Kit is used.** `freighter-api` is imported nowhere
  (grep over `apps/web/src`; the only "Freighter" hits are copy strings in
  `apps/web/src/components/modals/ConnectModal.vue:143,148`).
- Single Kit instance at module scope, all modules enabled:
  `apps/web/src/composables/useWalletSession.ts:30-34`
  (`new StellarWalletsKit({ network, selectedWalletId: XBULL_ID, modules: allowAllModules() })`).
  Installed kit modules: albedo, freighter, hana, lobstr, rabet, walletconnect, xbull
  (`apps/web/node_modules/@creit.tech/stellar-wallets-kit/modules/`). No hardware-wallet module.
- Connected state = module-scoped refs `connectedAddress`, `connectedProvider`, `isConnecting`,
  `initialized` (`useWalletSession.ts:25-28`). `connectWallet()` opens the Kit modal, validates
  `/^G[A-Z2-7]{55}$/`, persists (`useWalletSession.ts:104-150`, regex at `:118`).
- Signing: one call site, `kit.signTransaction(xdr, { networkPassphrase, address })`
  (`useWalletSession.ts:178-181`), after re-pinning the provider (`:176`).
- localStorage keys: `dig_stellar_user_id` (`apps/web/src/composables/useAppUser.ts:4`),
  `dig_stellar_connected_address` and `dig_stellar_connected_provider`
  (`useWalletSession.ts:17-18`), `dig_stellar_network` (`useNetwork.ts:7`). No token, no
  signature, no expiry.
- "Active signer" is a second module ref (`apps/web/src/composables/useActiveSigner.ts:15-20`),
  written only by `useWallets.ts:57-60` from the API's `isActiveSigner` flag.
- **Dead code worth knowing:** `apps/web/src/composables/useStellarWalletConnect.ts` has zero
  importers (grep). It is the only place that ever built an ownership-proof message
  (`:28-30`) and called `kit.signMessage` (`:74-77`); the signature is returned to nobody.
  Its Kit is hardcoded to `WalletNetwork.PUBLIC` (`:23`). Do not revive it; it is a hint that
  the idea was considered, not a foundation.

### 1.2 How identity reaches the API

- `useAppUser` is an opaque UUID minted **server-side** and adopted by the client:
  `POST /wallets/connect` with `{chain, address, label, userId?}` then `setUserId(res.userId)`
  (`apps/web/src/composables/useConnectFlow.ts:49-59`). Watch-only path: `useWallets.ts:170-191`.
- Transport: `?userId=` query param on every read (`apps/web/src/api/wallets.ts:25,31,39,58,68,
  81,96,111,124`), body on the two POSTs (`:18-21`, `:48-51`), same for alert rules and
  notifications (`apps/web/src/api/alertRules.ts:111-142`, `notifications.ts:64-93`), and in the
  witness body (`apps/web/src/api/actions.ts:73-74`). `apiFetch` sets only `Content-Type`
  (`apps/web/src/api/client.ts:35-41`). No `Authorization`, no custom header, no cookie.

### 1.3 API: user / session / grouping

- There is **no `users` table**. `user_id` is an unconstrained UUID grouping key on
  `user_wallets` (`apps/api/src/db/stellar_v2_multiwallet.sql:5-19`; stated at
  `stellar_v3_alerting.sql:15,32,76`). Uniqueness is `(user_id, chain, address)` (`:17-18`), so
  the same address can be tracked by several users by design. One signer per user is
  DB-enforced by a partial unique index (`:119-120`).
- Minted with `randomUUID()` at `apps/api/src/modules/wallets/wallets.service.ts:631` (connect
  fork) and `:674` (first watch-only track).
- Every user-scoped route reads `@Query('userId')` with a body fallback
  (`apps/api/src/modules/wallets/wallets.controller.ts:59-60,71,76,83,105,117,129,141,155,169`;
  `modules/alerts/alerts.controller.ts:30-83`; `notifications.controller.ts:16-48`). Ownership
  is the SQL `where ... and user_id = $n` (`wallets.service.ts:296-327`, 404 never 403).
- **No guard, middleware, interceptor or pipe anywhere**: grep for
  `CanActivate|UseGuards|NestMiddleware|NestInterceptor|APP_GUARD|passport|jwt|bearer` over
  `apps/api/src` returns nothing. `apps/api/src/main.ts:18-49` sets CORS, disables
  `x-powered-by`, binds loopback.
- Absent `userId` silently becomes the shared demo account on reads
  (`wallets.service.ts:205-206`, labelled "STANDING DEBT" at `:200-204`; same in
  `alerts.service.ts:71-79`).
- The model is documented as accepted beta scope: `docs/security-invariants.md:244-262` §7
  ("`userId` acts as the bearer token ... no accounts, no sessions, no signatures").

### 1.4 Any signed proof of wallet ownership today? No.

- grep `sep-10|sep10|signMessage|signAuthEntry|challenge|nonce|verifySignature|Keypair` over
  `apps/api/src`: the only `Keypair` hits are the faucet treasury
  (`apps/api/src/modules/faucet/faucet-payout.service.ts:87,107-111`) and a `Keypair.random()`
  in a spec. The only `nonce` is a bridge-transfer column (`stellar_v1_bridge.sql:15`).
- SEP-10 exists only as a diagram edge, `docs/TECHNICAL_ARCHITECTURE.md:36`
  (`API -->|SEP-10 challenge| WK`), never in code.
- `POST /v1/wallets/connect` validates the address with `value.length < 10` only
  (`wallets.service.ts:259-271`), not even the `G...` regex.

### 1.5 Pre-existing issue that becomes campaign-relevant

With no session, `connectWallet` recovers an account by address alone:
`findSignerWalletByAddress` (`wallets.service.ts:364-399`, `where ... is_active_signer = true`),
then promotes and returns that account's overview including its `userId`
(`wallets.service.ts:609-626`, `:1021`). Signer addresses are public on-chain data. Anyone can
therefore obtain the `userId` of any account whose signer address they know, and with it read
and mutate that account's wallets, alert rules and notifications. Today the blast radius is
watch data and alert preferences (nothing custodial, §7 of the invariants). Once points, perks
and a public leaderboard hang off `userId`, this path lets a stranger act "as" a leader's
account. The specs cover the watch-only exclusion (`wallets.connect.spec.ts:232-250`) but not
this case. See §9 and the EP1 scope.

### 1.6 Smallest ownership proof without the backend touching keys

Recommended: **signed-nonce proof via the Kit's `signMessage`, verified with the public key
only.** No server key, no SEP-10 server signature, no new signing capability.

- Client capability exists: `signMessage(message, { networkPassphrase?, address?, path? }) =>
  Promise<{ signedMessage: string; signerAddress?: string }>`
  (`apps/web/node_modules/@creit.tech/stellar-wallets-kit/types.d.ts:102-109`, surfaced on the
  Kit at `stellar-wallets-kit.d.ts:47`). All seven installed modules declare it.
  Freighter's own API returns the signature as base64 in v4 and as a `Buffer` in v3
  (`apps/web/node_modules/@stellar/freighter-api/build/@stellar/freighter-api/src/signMessage.d.ts`);
  the Kit normalises to a string.
- Server verification needs only `Keypair.fromPublicKey(address).verify(bytes, signature)`,
  already exercised in the repo at `apps/api/src/modules/faucet/faucet-payout.spec.ts:43`.
  `Keypair.fromPublicKey` holds no secret, so INV-1.2's review grep (`Keypair` outside the
  faucet payout service) needs a documented, narrow exception for the verify-only call, or the
  verify call lives behind a one-function helper named for what it does. Decide at the EP1 gate.
- Flow (two calls, both `apps/api`):
  1. `POST /v1/auth/challenge {address}` → server stores `(address, nonce, expires_at)` and
     returns the exact message text to sign. Message is plain, human-readable, and says in
     words that it is not a transaction and moves no funds; it embeds the address, the nonce,
     the issue time and the site name so it cannot be replayed on another site.
  2. Client `kit.signMessage(message, { address })`; `POST /v1/auth/verify {address, nonce,
     signedMessage, userId}` → server rebuilds the message from the stored row, verifies the
     signature against the address, marks the nonce used, and records
     `wallet_ownership_proofs(address, user_id, provider, verified_at)`.
- What the proof then means: the pair `(wallet, user_id)` is proven. Every campaign write
  (enrol, social claim, referral link, daily check-in) requires that the caller's `userId` has a
  proof for the wallet it acts on. The `userId` stays the bearer for reads, as today; the proof
  is the one thing a leaked or guessed `userId` cannot forge.
- Known caveat to test, not assume: SEP-43 wallets differ in what bytes they sign (raw message
  vs a hashed/prefixed form) and in the signature encoding. EP1 must prove verification with at
  least Freighter, xBull and Lobstr on testnet and fail closed on anything else. If a wallet
  cannot be verified, it cannot enrol; it still works as a normal wallet.
- Rejected alternatives: SEP-10 proper (needs a server signing key and a web-auth domain, which
  is a new key by definition); a "challenge transaction" signed through `signTransaction`
  (works everywhere but asks the user to sign a transaction-shaped envelope for a non-transaction,
  which blurs the §2 client-side XDR validation story). Keep the second only as a fallback if
  `signMessage` coverage turns out insufficient at the EP1 gate.

## 2. Actions through Dig

### 2.1 Inventory

Five action endpoints plus the witness, all under `apps/api/src/modules/actions/`
(`actions.module.ts:9-11`):

| Endpoint | Handler | Build event kind |
|---|---|---|
| `POST /v1/actions/blend/deposit` | `actions.controller.ts:184` | `blend-deposit-build` / `trustline-build` |
| `POST /v1/actions/blend/withdraw` | `actions.controller.ts:266` | `blend-withdraw-build` |
| `POST /v1/actions/blend/position` (read) | `actions.controller.ts:321` | none |
| `POST /v1/actions/sdex/quote` (read) | `actions.controller.ts:338` | `sdex-quote` |
| `POST /v1/actions/sdex/swap` | `actions.controller.ts:374` | `sdex-swap-build` |
| `POST /v1/actions/witness` | `witness.controller.ts:52` | writes `action_witnesses` |

Kind union closed at `apps/api/src/modules/ops/ops.service.ts:42-47`. **There is no Soroswap
action path**; the verifier refuses generic Soroban swap invokes by design
(`witness-verify.ts:21-23`). Liquidity tabs are present but disabled
(`apps/web/src/components/modals/ActionModal.vue:26-28`).

### 2.2 Build → validate → sign → submit

- XDR is built in the API with `@stellar/stellar-sdk` + `@blend-capital/blend-sdk`
  (`actions.service.ts:7-20`): `buildBlendDeposit` (`:506`), `buildBlendWithdraw` (`:659`),
  `buildSdexSwap` (`:954`). Blend builds are simulated and assembled
  (`simulateAndAssembleSubmit`, `:787-861`); the swap is a classic `pathPaymentStrictSend`
  with the user as destination (`:1013-1027`). The API never holds keys
  (`actions.service.ts:518,670,963`).
- Client-side validation before any signing prompt: `apps/web/src/lib/validateSwapXdr.ts:133-287`
  and `validateDepositXdr.ts:197-345` (passphrase, fee-bump rejection, source, fee cap, sole op,
  contract/pool pin, function `submit`, request type 2/3, `from/spender/to` = user, exact
  amount, asset by code and issuer). Intent derives from user input + client config, never the
  API response (`BlendDepositCard.vue:55-59,353-378`; `SdexSwapWidget.vue:370-381`).
  Specs: `validateSwapXdr.spec.ts`, `validateDepositXdr.spec.ts`.
- Signing: Kit only (`useWalletSession.ts:178-181`), called from `SdexSwapWidget.vue:391`,
  `BlendDepositCard.vue:516,549,618`.
- Submission: **the browser submits directly to Soroban RPC**, never through the API
  (`SdexSwapWidget.vue:321-338`, RPC/Horizon URLs at `:26-29`; `BlendDepositCard.vue:413-465`,
  polls `getTransaction` 12 times every 2 s). Balances are read from Horizon by the browser
  (`SdexSwapWidget.vue:119`, `BlendDepositCard.vue:91`, `composables/Usewalletbalance.ts:68`).
  This is existing debt per CLAUDE.md's layer rule, not something EP should extend.
- **No memo is set and none is checked**: grep `memo` over `apps/api/src/modules/actions` and
  `apps/web/src` yields prose only. Nothing on-chain marks a tx as "through Dig".

### 2.3 What is recorded today

Two ledgers, both in the API, both storing the raw public address:

1. **Builds**: `action_events(id, kind, network, address, created_at, metadata jsonb)`
   (`apps/api/src/db/stellar_v1_ops_metrics.sql:49-67`), inserted fire-and-forget by the
   controller with pair/asset/amount/pool metadata (`ops.service.ts:297-321`;
   `actions.controller.ts:228-233,300-305,365-369,420-425`). A build is intent, not execution.
2. **Verified executions**: `action_witnesses` (`apps/api/src/db/stellar_v1_action_witness.sql:23-45`):
   `tx_hash` PK, `network`, `wallet_address`, `user_id`, `kind` (`sdex-swap` | `blend-deposit` |
   `blend-withdraw`), `op_summary jsonb`, `notional_xlm`, `min_notional_xlm`,
   `meets_min_notional`, `action_event_id`, `ledger_closed_at`, `verified_at`. Failed
   verifications are never stored (`:18-22`). Insert is `on conflict (tx_hash) do nothing`
   (`witness.service.ts:183-205`).

`WitnessService.witness` (`apps/api/src/modules/actions/witness.service.ts:112-215`) checks, in
order: idempotency (`:126-129`); Horizon tx exists and `successful` (`:132-140`); source is a
known wallet in `user_wallets`, preferring the named `userId` then the active signer
(`:143-146`, query `:241-256`); a qualifying op with matching source
(`findQualifyingOp`, `witness-verify.ts:107-212`: path payments / manage_buy_offer → swap,
`invoke_host_function` transfer wallet→registry pool → deposit, pool→wallet → withdraw);
a matching Dig build within `[-60 min, +5 min]` of the close time (`:30-35`, `:162-170`);
notional priced from `asset_prices` ≤ 24 h (`:38`, `:172-178`, never a rejection).

Who calls it: fire-and-forget `reportActionWitness` with retries at 4/6/6/6 s
(`apps/web/src/api/actions.ts:109-127`), from `SdexSwapWidget.vue:402` and
`BlendDepositCard.vue:581`; awaited in the faucet claim panel
(`FaucetClaimPanel.vue:154-161`). Testnet and mainnet both accepted
(`witness.controller.ts:42-46`). Not gated by the mainnet kill-switches (`:5-9,36-46`).

### 2.4 Minimal record and independent re-verification

The minimal record already exists: `action_witnesses` holds wallet, action type, timestamp
(`ledger_closed_at`), tx hash, and the amount/asset inside `op_summary`. The points ledger
should reference `action_witnesses.tx_hash` (as `faucet_claims.witness_tx_hash` does,
`stellar_v4_faucet.sql:31`) rather than add a parallel record.

Independently re-verifiable from Horizon with the hash alone: existence, success, source
account, close time, operation shape, asset and amount (everything `findQualifyingOp` reads).
Not re-verifiable from chain: `user_id` (private table), the "came through Dig" build link
(private `action_events`, no memo), `notional_xlm` (point-in-time prices).

Gaps relevant to points:

- Amount and asset are jsonb-only (`witness-verify.ts:160-167,197-208`), no typed columns. Fine
  for "N points per verified action"; a notional-weighted scheme would need a typed read of
  `notional_xlm` (nullable) and should be deferred.
- A tx built, signed and submitted but never witnessed (tab closed inside the ~28 s retry
  budget, Horizon lag, `unknown-wallet`) leaves only a build row. §7 proposes the catch-up.
- Web type drift: `apps/web/src/api/actions.ts:87` omits `blend-withdraw` from the witness kind
  union the server can return (`witness-verify.ts:27`). Cosmetic; note for EP2.

### 2.5 Flags, registries and logs (names only, read for awareness)

- API: `ACTIONS_MAINNET_ENABLED` (`network-registry.ts:194`, enforced
  `actions.controller.ts:129-138`), `ACTIONS_MAINNET_BLEND_ENABLED` (`:204`, `:148-157`),
  `ACTIONS_MAINNET_MAX_SEND_XLM` (`:209`), `ACTIONS_MAINNET_RPC_URL` (`:216`),
  `ACTIONS_INCLUSION_FEE_STROOPS` (`actions.service.ts:322`), `FAUCET_MIN_NOTIONAL_XLM`
  (`witness.service.ts:46`). Whitelist `MAINNET_ASSET_WHITELIST` (`network-registry.ts:343-349`),
  pools `MAINNET_BLEND_POOLS` (`:127-152`), `TESTNET_BLEND_POOLS` (`:161-168`).
- Web (UX only): `VITE_ACTIONS_MAINNET_ENABLED` (`SdexSwapWidget.vue:31-35`),
  `VITE_ACTIONS_MAINNET_BLEND_ENABLED` (`BlendDepositCard.vue:28-34`); client registries
  `apps/web/src/config/blendPools.ts`, `mainnetSwapPairs.ts`, `testnetSwapPairs.ts`,
  `testnetBlendPools.ts`.
- The actions module logs nothing (grep `logger|console.` → none). Addresses are persisted raw
  in both ledgers, justified in-schema as public on-chain data
  (`stellar_v1_ops_metrics.sql:46-47`, `stellar_v1_action_witness.sql:26`).

EP touches none of the above. The points system reads `action_witnesses`; it does not call,
import or modify `modules/actions/`.

## 3. Faucet module: what is reusable

### 3.1 Shape

- Routes: `GET /v1/faucet/eligibility?wallet=` and `POST /v1/faucet/claim {wallet, family}`
  (`apps/api/src/modules/faucet/faucet.controller.ts:47-54,56-74`). Wallet regex at `:27`,
  family whitelist `:63-72`. **No `userId` on the wire**; the user is derived from the witness
  row (`faucet.service.ts:261-273`, `:441`).
- Ineligibility and payout failure are 200s with structured reasons; 4xx only for malformed
  input (`faucet.controller.ts:10-11`). Eligibility is `Cache-Control: no-store` (`:48`).

### 3.2 Eligibility: a pure function, one decision procedure

`apps/api/src/modules/faucet/faucet-eligibility.ts:1-7` states "PURE ... no I/O, no Nest, no
env". `walletEligibility` (`:133-150`) checks in order: enabled, campaign started, not ended,
budget left, hourly velocity (`claimsLastHour >= hourlyCap`), witness exists, meets min
notional, no failed prior claim, no prior claim, treasury reachable, treasury ≥ reward. Both
the GET and the claim run this function (`faucet.service.ts:233-243`).

Facts are gathered by `FaucetService.campaignFacts` (`:356`), `claimCounts` (`:370`,
budget = pending + paid + failed, velocity = `created_at > now() - interval '1 hour'`,
`:374-389`), `walletFacts` (`:404`, best witness per family `distinct on (kind)` with
`ledger_closed_at >= campaign start`, `:414-429`; prior claim by wallet OR user, `:442-453`).

Config (env names, lazily read): `FAUCET_ENABLED`, `FAUCET_NETWORK`, `FAUCET_REWARD_XLM`,
`FAUCET_MAX_CLAIMS`, `FAUCET_HOURLY_CLAIM_CAP`, `FAUCET_STARTS_AT` (fail-closed when unset),
`FAUCET_ENDS_AT` (`faucet-config.ts:35-107`); `FAUCET_CAMPAIGN = 2` is a code constant (`:32`).

### 3.3 DB-enforced uniqueness (the real anti-abuse gate)

`faucet_claims` (`stellar_v4_faucet.sql:27-52` + `stellar_v5_faucet_campaign2.sql:32-62`):
unique `(lower(wallet_address), action_family, campaign)`, unique
`(user_id, action_family, campaign)`, unique `(witness_tx_hash)` so every claim consumes a
distinct Horizon-verified tx. FK `witness_tx_hash → action_witnesses(tx_hash)`. Unique
violations map to `already-claimed`, any other error to `claim-error`
(`faucet.service.ts:254-283`, `isUniqueViolation` `:127-132`). No `CHECK` on `status`.

There is no account-age, funded-account or trustline check, and no per-wallet cooldown; a
`failed` row blocks until founder review (`faucet-eligibility.ts:143-146`,
`docs/runbooks.md:745-751`).

### 3.4 The payout key path (do not touch)

`FAUCET_SECRET_KEY` is read in exactly one place, `faucet-payout.service.ts:108`, inside
`treasuryKeypair()` (`:107-115`); signing at `:87`; one transaction shape (native payment,
memo `dig-reward`), pinned by `faucet-payout.spec.ts:25-48`. `FaucetPayoutService` is a
provider of `FaucetModule` and **not exported** (`faucet.module.ts:13-19`); the module imports
nothing from `modules/actions` and nothing imports it except `OpsModule` for the drain
snapshot (`faucet.module.ts:3-6`, `ops.module.ts:4,9-10`). Invariants: §9 INV-9.1 to 9.7.

### 3.5 Reuse verdict

Reuse the **pattern**, not the module: a pure `campaign-rules.ts` with every fact as an input
and a spec per branch; facts gathered by the service; DB unique indexes as the hard backstop;
200-with-reason for ineligibility; a kill-switch env defaulting dark; a campaign window
fail-closed when unset. Concretely borrowable: the hourly-velocity query shape
(`faucet.service.ts:374-389`), the best-witness-per-family query (`:414-429`), the
`isUniqueViolation` detector (`:127-132`), the family map `FAMILY_BY_WITNESS_KIND`
(`faucet-eligibility.ts:19-22`). Nothing from `faucet-payout.service.ts` is needed, imported or
referenced; the campaign module must not import `FaucetModule` at all (the only thing that
module exports is `FaucetService`, which carries the payout service inside it).

Also note: the campaign-2 witness floor (`ledger_closed_at >= FAUCET_STARTS_AT`) is the right
idea for points too: only executions inside the campaign window count, so past actions cannot
be re-earned.

## 4. DB

### 4.1 Existing tables relevant to users / wallets / actions / faucet

| Table | File | Key facts |
|---|---|---|
| `user_wallets` | `stellar_v2_multiwallet.sql:5-28,114-120` | `id` PK, `user_id` (no FK, no users table), `chain`, `address`, `label`, `is_primary`, `is_active`, `is_active_signer`, `metadata jsonb`, `created_at`, `updated_at`; unique `(user_id, chain, address)`; one signer per user (partial unique) |
| `wallet_balance_snapshots` | `:32-66` | per wallet/asset snapshot, FK cascade to `user_wallets` |
| `wallet_protocol_positions` | `:69-102` | per wallet/venue position snapshot |
| `wallet_pool_health` | `:133-155` | per wallet/pool HF rollup |
| `action_events` | `stellar_v1_ops_metrics.sql:49-67` | builds; `address` nullable; `metadata jsonb` nullable |
| `action_witnesses` | `stellar_v1_action_witness.sql:23-45` | verified executions; `tx_hash` PK; indexes on `lower(wallet_address)`, `user_id`, `verified_at desc` |
| `faucet_claims` | `stellar_v4_faucet.sql:27-52`, `stellar_v5_faucet_campaign2.sql:32-62` | money path; see §3.3 |
| `alert_rules` / `alert_rule_state` / `alert_rule_subject_state` / `notifications` / `pool_status_state` | `stellar_v3_alerting.sql:30-146` | user-scoped by `user_id`, no FK |
| `rpc_metrics_runs` / `refresh_step_runs` | `stellar_v1_ops_metrics.sql:11-41` | ops observability |

Prisma (`packages/db/prisma/schema.prisma:10-55`, models `Protocol`, `Venue`, `Snapshot`) is
legacy and disjoint; its single migration (`packages/db/prisma/migrations/20260312113641_init/`)
touches none of the raw-SQL tables. The API uses Prisma only as a raw-SQL connection
(`apps/api/src/db/prisma.service.ts:6-14`; `$queryRawUnsafe` / `$executeRawUnsafe`
everywhere, stated at `alerts.repository.ts:8-9`).

### 4.2 Migration discipline as it stands

- Files are idempotent (`create ... if not exists`, `add column if not exists`), applied **by
  hand** with `psql -f` in dependency order (`docs/runbooks.md:169-182`, "manual; no migration
  runner"). Dependency order is v1 base → v1 satellites → v2 → v3 → v4 → v5.
- Three lists disagree: `docs/runbooks.md:173-182` (10 files, has v5), `docker-compose.yml:80-89`
  initdb mounts (10 files, **no v5**), `docs/reference-deployment.md:128-135` (**no v5**),
  `docs/deployment.md:21-33` (7 files). Already catalogued in
  `docs/evidence/lot-ad/ad0-recon.md:33-56`; AD1 (deploy script applying one committed list) and
  AD2 (versioned runner) are planned, not landed (no `scripts/` directory exists yet).
- Migrations already mix DDL and guarded DML (`stellar_v5_faucet_campaign2.sql:39-47`).
- Per-file headers state their dependency and the manual-apply convention
  (`stellar_v4_faucet.sql:7-9`, `stellar_v5_faucet_campaign2.sql:10-12`).

How EP fits: one new file `apps/api/src/db/stellar_v6_campaign.sql`, idempotent, header stating
"depends on `user_wallets` (v2) and `action_witnesses` (v1 witness)", added to **all three**
lists in the same commit (runbooks, compose mount `50-stellar_v6_campaign.sql`,
reference-deployment loop), and the same commit fixes the missing v5 in compose and
reference-deployment. If AD1 lands first, the file goes into the script's list instead.

### 4.3 Proposed new tables (proposal only, nothing written)

All wallet keys are the public address, lowercased on indexes like the witness table. `user_id`
is carried where useful but is never the ownership key, because it is unauthenticated (§1.3).

1. `wallet_auth_challenges` — `nonce text PK`, `address text`, `message text` (the exact text
   served), `expires_at timestamptz`, `used_at timestamptz null`, `created_at`. Short TTL,
   deletable after use. Index on `expires_at` for cleanup.
2. `wallet_ownership_proofs` — `id uuid PK`, `address text`, `user_id uuid`, `provider text`
   (Kit wallet id), `nonce text`, `verified_at timestamptz`. Unique `(lower(address), user_id)`
   (one proof per pair; re-proving updates `verified_at`). Index on `lower(address)`. This is
   also the only honest "wallet connected with proof" event the campaign can report (§8).
3. `campaign_enrollments` — `address text` (PK lower), `user_id uuid`, `campaign int`,
   `referral_code text` unique (generated at enrol), `referred_by_code text null`,
   `enrolled_at`. Unique `(lower(address), campaign)`. Enrolment requires a proof for
   `(address, user_id)`.
4. `points_ledger` — **append-only**. `id bigint identity PK`, `campaign int`, `address text`,
   `user_id uuid null`, `reason text` (closed set: `action:sdex-swap`, `action:blend-deposit`,
   `action:blend-withdraw`, `social:<task_key>`, `streak:daily`, `referral:referrer`,
   `referral:referee`, `adjust:<note>`), `base_points int`, `multiplier numeric default 1`,
   `points int` (the credited value, may be negative only for `adjust:` rows),
   `source_ref text null` (witness `tx_hash`, social claim id, `YYYY-MM-DD` for streaks, referee
   address for referrals), `created_at`. Unique `(campaign, reason, source_ref) where source_ref
   is not null` makes every award idempotent. Index `(campaign, lower(address))`. FK from
   `source_ref` to `action_witnesses(tx_hash)` cannot be declared on a polymorphic column; the
   awarding query joins on it instead. No `update`/`delete` in code; a revocation is a negative
   `adjust:` row referencing the original id in `source_ref`.
5. `social_task_claims` — `id uuid PK`, `campaign int`, `address text`, `task_key text`
   (closed set in code: `x-follow`, `x-repost`, `community-join`, ...), `handle_normalized
   text` (lowercase, `@` stripped), `status text` (`self-declared` in v1), `claimed_at`.
   Unique `(campaign, lower(address), task_key)` (one claim per task per wallet); unique
   `(campaign, task_key, handle_normalized)` (one handle per task across wallets, i.e. one X
   handle per wallet). The per-wallet daily cap on social points is enforced in the service by
   counting today's `social:` ledger rows, mirroring the faucet velocity query.
6. `wallet_daily_checkins` — `campaign int`, `address text`, `day date`, `created_at`;
   PK `(campaign, lower(address), day)`. Streak length is computed from consecutive days at
   read time; the multiplier table is a code constant.
7. `referrals` — `campaign int`, `referee_address text` (PK with campaign), `referrer_address
   text`, `code text`, `linked_at`, `credited_at null`, `credited_tx_hash text null references
   action_witnesses(tx_hash)`. Credited only when the referee has a witness with
   `ledger_closed_at >= linked_at`; self-referral and referrer = referee rejected in code and by
   a `check (referee_address <> referrer_address)`.
8. `wallet_perks` (EP3) — `campaign int`, `address text`, `perk_key text` (closed set:
   `beta-access`, `early-features`, `priority-rwa`, `community-role`), `granted_at`,
   `points_at_grant int`; PK `(address, perk_key)`. Tier thresholds are code constants, not a
   table, in v1. The "beta flag on the wallet" is a `wallet_perks` row, not a column on
   `user_wallets`, so the wallet table stays untouched.

Leaderboard is a query (`sum(points) group by lower(address)`) with a 60 s in-process cache;
no materialised table in v1.

## 5. Web

### 5.1 Views (hash-based, no router)

- Union and whitelist: `apps/web/src/composables/useView.ts:15-23`
  (`'dashboard' | 'protocols' | 'pool' | 'portfolio' | 'alerts' | 'status'`, `VIEWS` array);
  hash parse `:28-37`; write-through `history.replaceState` `:44-51`.
- Switching: flat `v-if` chain `apps/web/src/App.vue:45-50`.
- Nav: `AppSidebar.vue` `navItems` (`:38-48`, four entries, inline-SVG `ICONS` `:31-36`) plus
  the standalone "System status" button outside the nav (`:176-188`). Topbar titles map
  `AppTopbar.vue:32-39`. `AppDrawer.vue` just re-renders the sidebar (`:52`): nothing to touch.
- Precedent: `#status` (commit `457d3d1`) touched exactly `useView.ts`, `App.vue`,
  `AppTopbar.vue`, `AppSidebar.vue`, new `components/views/StatusView.vue` +
  `components/status/StatusBar.vue` + `composables/useOpsStatus.ts` + `api/ops.ts`.

Where Earn fits: `#earn` as a fifth `navItems` entry (needs one `ICONS` entry), a new
`components/views/EarnView.vue`, `components/earn/` (leaderboard, task list, streak strip),
`composables/useCampaign.ts`, `api/campaign.ts`. The leaderboard is a section of the Earn view
(`#earn`), not a separate view, in v1.

### 5.2 Copy / i18n: none

No i18n library, no locale files, no `$t`; `<html lang="en">` (`apps/web/index.html:2`). Copy is
hard-coded English in templates; the closest central map is `AppTopbar.vue:32-39`. FR/EN would
be greenfield and is out of EP scope; Earn ships English like every other view. The honest-copy
rule to copy is `GetStartedCard.vue:8-9` ("APY is labeled current/variable, never projected").

### 5.3 Where APRs/APYs are displayed today

The codebase says **APY** everywhere; `metrics.supplyApy` / `borrowApy` are ratios
(`apps/web/src/mappers/poolMapper.ts:57-58,80`). Render sites:

| Surface | Lines |
|---|---|
| Protocols cards (weighted averages) | `ProtocolsView.vue:112-127` |
| Protocols pool table | `ProtocolsView.vue:194-201`, render `:480-482` |
| Pool detail tiles + reserves table | `PoolDetailView.vue:98-99,105`, `:760-761,777-778` |
| Get-started Blend tile | `GetStartedCard.vue:54-58,139-147` ("Current supply APY (variable) ... Not a promised or projected return.") |
| Alert rule modal (as a metric) | `AlertRuleModal.vue:42,51,56,117-118,153-157,308` |

Formatting is three identical local helpers (`ProtocolsView.vue:59-62`,
`PoolDetailView.vue:49-52`, `GetStartedCard.vue:54-58`); `utils/format.ts` has no APY
formatter (`formatPct` at `:40-44` is a change formatter). No "as reported by Blend"
attribution exists anywhere; the house pattern is `FreshnessChip.vue` next to the figure.

For points: render a separate `PointsChip` ("+N pts") as a sibling element next to the existing
APY node (e.g. after `GetStartedCard.vue:139` and inside the action success blocks where
`FaucetClaimPanel` already mounts, `SdexSwapWidget.vue:618-625`,
`BlendDepositCard.vue:1027-1034,1066-1073`). The APY nodes and the three helpers are not
modified. The API serves points as its own field (`pointsForAction`), never merged into a
yield field.

### 5.4 Closest existing analog: the faucet surface

`useFaucet.ts` is a module singleton polling `GET /faucet/eligibility` every 60 s with
API-reported gating (`campaignLive`, `campaignLiveFor(network)`, `:39-45`) and fail-closed on
error (`:26-28`). `FaucetPromoBanner.vue` mounts once on the dashboard
(`DashboardView.vue:216`); `FaucetClaimPanel.vue` mounts inside the two widgets' success
blocks with an explicit `wallet` prop (`:26-37`). Copy already says "Earn N XLM"
(`SdexSwapWidget.vue:466-472`, `BlendDepositCard.vue:745-750`). The Earn composable should
mirror this shape: one singleton, API-reported `active`, hidden when unknown.

### 5.5 Reusable table pattern

No shared table component; the only real `<table>` is `PoolDetailView.vue:760-778`. Best
starting point for a leaderboard: `components/bridge/BridgeRoutesTable.vue` (typed rows
`:8-11`, `COLS` `:19-22`, grid header buttons `:34-42`, `tabular-nums` cells `:57-61`).
`utils/format.ts:112-115 shortAddress()` exists for address display.

## 6. API module ownership

New module **`apps/api/src/modules/campaign/`** (`/v1/campaign/*` plus the two `/v1/auth/*`
proof routes; keep auth inside the campaign module in v1 rather than a separate `auth` module,
since the proof's only consumer is the campaign; split later if wallet-connect adopts it).

Why not extend an existing module: `wallets` is a 1,571-line service holding its own SQL and
the W1 connect rules; `faucet` is a money path with a deliberate isolation statement; `actions`
is the validated non-custodial path that EP must not touch; `alerts` is unrelated. A new module
keeps the review surface narrow and lets the isolation rule be stated in its header the way
`faucet.module.ts:3-6` does.

Shape, following house patterns:

- `campaign.module.ts` imports `DbModule` only. **Imports nothing from `modules/actions`,
  `modules/faucet` or `modules/wallets`.** Reads `action_witnesses`, `user_wallets` and its own
  tables by SQL.
- `campaign-rules.ts` pure (points per action kind, streak multipliers, social task catalogue,
  daily cap, referral rule, tier thresholds), with a spec per branch like
  `faucet-eligibility.spec.ts`. This is the one place CLAUDE.md's test note allows: the house
  pattern for anti-abuse paths is a pure-rules spec, not a suite build-out.
- `campaign.repository.ts` for SQL, exported for the periodic award script, exactly as
  `AlertsRepository` is exported for `83-evaluate-alerts.ts` (`alerts.module.ts:3-6`).
- `campaign.controller.ts`: `GET /v1/campaign` (public state: active, window, rules summary,
  disclaimer text), `GET /v1/campaign/me?userId&wallet` (balance, streak, tasks, referral code,
  perks, pending verifications), `GET /v1/campaign/leaderboard` (top N, shortened addresses),
  `POST /v1/campaign/enroll`, `POST /v1/campaign/checkin`, `POST /v1/campaign/social`,
  `POST /v1/campaign/referral/link`, `GET /v1/campaign/metrics` (EP3, public like `/v1/ops/*`).
- Kill-switch `CAMPAIGN_ENABLED` defaulting false, `CAMPAIGN_STARTS_AT` fail-closed,
  `CAMPAIGN_ENDS_AT` optional, `CAMPAIGN_ID` code constant: the faucet config pattern
  (`faucet-config.ts:35-107`).
- Every payload carries a `disclaimer` string stating points have no monetary value and are not
  convertible, so the UI cannot drop it by accident (the faucet's "never fake urgency" idea,
  `faucet-config.ts:81-86`).
- nginx: the new POSTs fall into the existing `api_mutations` zone (2 r/s, burst 20,
  `docs/deployment.md:68-80`); no new zone needed for v1.

Nothing in `apps/web` computes points, streaks or multipliers; the web renders what
`/v1/campaign/me` returns (ai-guidelines layer rule).

## 7. Indexer

- Jobs are cron + `flock -n` + `spawn` chains, no scheduler (`docs/runbooks.md:137-155`).
  Real crontab: `*/15` refresh on `/tmp/dig-stellar-refresh.lock`, `7,22,37,52` alert on
  `/tmp/dig-stellar-alert.lock`, logs `/var/log/dig-stellar-{refresh,alert}.log`
  (`docs/evidence/lot-ac/ac2-execution.md:52-53`, `docs/runbooks.md:149`).
- `82-run-wallet-alert-job.ts` spawns `81` then `pnpm run job:alerts` in `apps/api`
  (`apps/api/package.json:18`: `ts-node --transpile-only src/scripts/83-evaluate-alerts.ts`);
  a non-zero exit from 81 aborts the evaluator (`82-run-wallet-alert-job.ts:67-72`).
- The indexer has no Horizon client helper for verification; Horizon verification lives in the
  API (`witness.service.ts`). There is no adoption job in the indexer; adoption counters are
  computed on request in `ops.service.ts:323-385`.
- The AD1 deploy script design takes both cron locks blocking
  (`docs/evidence/lot-ad/s1-remediation-runbook.md:128`); a third lock must be added there.

Recommendation: **a separate cron-compatible job, not a step in `job:refresh` or
`job:wallet-alert`.** Both existing jobs have strict semantics (refresh = protocol metrics with
a 15-min budget; alert = health then evaluate, abort on failure) and neither should grow a
campaign concern. Shape, mirroring 82 → 83:

- `apps/api/src/scripts/84-campaign-award.ts` (`job:campaign-award` in `apps/api/package.json`),
  pure `CampaignRepository` SQL: (1) award `action:*` points for every `action_witnesses` row
  inside the campaign window for an enrolled wallet that has no ledger row yet (one idempotent
  `insert ... select ... on conflict do nothing`); (2) credit pending referrals whose referee now
  has a witness; (3) EP3: grant perks whose threshold is crossed. Idempotent by the ledger's
  unique index, so re-runs and overlapping runs are harmless.
- `apps/indexer/src/scripts/85-run-campaign-job.ts` (`job:campaign`), a thin 82-style wrapper so
  the cron line looks like the other two, with `/tmp/dig-stellar-campaign.lock` and
  `/var/log/dig-stellar-campaign.log`, offset from both (e.g. `3,18,33,48`).
- Periodic tx-hash verification (catch-up for executions the fire-and-forget witness missed):
  for enrolled wallets only, the job lists Horizon `accounts/{address}/transactions` since the
  wallet's last scan cursor and POSTs each candidate hash to `http://127.0.0.1:3000/v1/actions/
  witness` as a client would. The witness endpoint stays the single verifier (idempotent, build
  link enforced), so the job adds no verification logic and touches no actions code. Bounded
  by enrolment count and a per-run page cap. Defer to EP1's second half; the award step alone
  already covers every tx the widgets witnessed.

Points award latency is then up to one cron interval; the Earn view shows "pending
verification" for a witnessed tx until the ledger row exists. Immediate award at witness time
would mean touching `WitnessService`; not in v1.

## 8. Analytics

- **No product analytics exists.** grep `plausible|umami|posthog|gtag|analytics|mixpanel|
  track(|pageview` over `apps/web/src`, `apps/web/index.html`, `apps/api/src` yields prose and
  the watch-only `onTrack()` handler only (`ConnectModal.vue:43-56`). No page-view logging; view
  changes only mutate the hash (`useView.ts:44-51`).
- **No connect event and no `last_seen`**: a connect is one `user_wallets` insert
  (`wallets.service.ts:401-452`), and reconnecting an existing wallet writes nothing (unique
  constraint). grep `last_seen|lastSeen` → none.
- What exists: `GET /v1/ops/adoption` (`ops.service.ts:323-385`): wallet totals / signers /
  distinct users from `user_wallets`, builds by kind and distinct acting addresses from
  `action_events` (24h / 7d / total), with an explicit boundary string (`:357-363`: builds, not
  executions; executed evidence is `action_witnesses`; counters start at deploy). The one prior
  analytics run, `docs/evidence/analytics/swap-usage-2026-08-16.md`, worked from
  `action_events` by psql and states the same caveats (`:8-32`).
- nginx access logs exist on the VPS and were used once as a traffic baseline
  (`docs/evidence/lot-s/s0-surface-recon.md:72-89`); no path is documented in `docs/*.md`.

To report honestly "N wallets connected, M with a verified on-chain action" for a campaign
window, the only defensible definitions are:

| Figure | Source | Honest wording |
|---|---|---|
| Wallets registered in window | `user_wallets.created_at` | "first registered" (re-connects are invisible) |
| Wallets that proved ownership in window | `wallet_ownership_proofs.verified_at` (new) | "connected with proof" — this becomes the real connect event |
| Wallets enrolled | `campaign_enrollments` (new) | |
| Wallets with ≥1 verified action in window | `action_witnesses` distinct `lower(wallet_address)` with `ledger_closed_at` in window | "Horizon-verified executions" |
| Verified actions in window, by kind | same table | |
| Referrals credited, social claims, points issued | new tables | "self-declared" stated for social |

`GET /v1/campaign/metrics` (EP3) returns these with a boundary string like
`/v1/ops/adoption`. No page views and no funnel are claimable without adding a tracking event,
which is out of EP scope.

## 9. Risks and conflicts

1. **Account recovery by address (pre-existing, §1.5).** `wallets.service.ts:609-626` returns an
   account's `userId` to anyone posting its signer address with no session. Not an EP defect,
   but EP makes `userId` worth stealing (points, perks, leaderboard identity). Mitigation inside
   EP scope: every campaign write requires a `wallet_ownership_proofs` row for `(wallet,
   userId)`, so a stolen `userId` without the wallet's key earns nothing and cannot claim. The
   full fix (require a proof on the no-session recovery path) touches W1 connect rules and is a
   founder decision at the EP1 gate; recommended, small, but it changes a path with specs
   (`wallets.connect.spec.ts:205-250`).
2. **No signed intent for proofs is not a §2 violation**: `signMessage` produces no XDR, so the
   client-side XDR validation invariant does not apply. The UI must still state in the prompt
   text that nothing is being transacted (INV-1.3 spirit), and must never route a proof through
   `signTransaction` without a validator.
3. **INV-1.2 review grep.** `Keypair` appearing outside `faucet-payout.service.ts` is flagged as
   a defect by `docs/security-invariants.md` §1 and §9 review checks. The verify-only call
   (`Keypair.fromPublicKey(...).verify`) holds no secret. Either amend §1's review check with an
   explicit "verify-only, public key" exception naming the one file, or isolate it in a
   `verify-signature.ts` helper whose spec proves it never calls `fromSecret`/`sign`. Decide
   at the EP1 gate; do not leave it implicit.
4. **New PII class: social handles.** The repo stores addresses raw with a stated rationale
   (public on-chain data). An X handle is user-supplied and links a person to a wallet. Store
   normalised, exclude from every log line and every public payload (leaderboard shows
   shortened addresses only), and give the campaign a delete path (`DELETE /v1/campaign/social/
   :id`) before launch. The hashed-identifier rule in CLAUDE.md applies to logs and metrics;
   `action_witnesses` already sets the precedent for raw addresses in tables.
5. **Public leaderboard exposes activity per address.** Addresses are public, but a ranked list
   of "who used Dig most" is new information. Shortened addresses by default, an opt-in display
   label later, top-N only, cached, in the general nginx zone. Founder call at the EP2 gate.
6. **Points next to yields.** Keep points in a separate API field and a separate DOM node; copy
   must never say "APY + points" or compute a combined rate. The disclaimer string travels in
   every payload. This also keeps the "no token/airdrop" line auditable by grep.
7. **Self-declared social tasks are gameable** by construction. Handle uniqueness and the daily
   cap bound the damage; multipliers from social tasks should be small and capped so on-chain
   verified actions dominate the leaderboard. State "self-declared" in the metrics boundary.
8. **Schema drift risk is live** (§4.2): v5 is missing from compose and reference-deployment.
   Adding v6 without fixing the lists repeats the 2026-08-17 incident class. Same commit.
9. **Layer rule.** Points, streaks, multipliers and eligibility are computed in `apps/api` only;
   the web displays. The periodic award runs as an API script launched by an indexer wrapper,
   the 82 → 83 shape, so batch logic stays out of request handlers.
10. **Untouched by design:** `modules/actions/**`, `modules/faucet/**`, the two validators, the
    flags listed in §2.5, the registries, the cron lines of the two existing jobs.
11. **Witness window heuristic** (`[-60, +5] min`, `witness.service.ts:30-35`) means a tx signed
    more than an hour after its build is never witnessed and never earns points. Acceptable;
    document it in the Earn FAQ rather than widen the window.

## 10. Beta-first plan

Estimates are founder-working-day equivalents at the pace of Lots R/N/ST, build plus
evidence, excluding VPS windows. Each stage ends in a STOP-AND-SHOW: nothing is committed or
deployed without the founder seeing the evidence file and the running feature.

### EP1 — proof, ledger, award, read endpoints (no UI) — 3 to 4 days

1. `stellar_v6_campaign.sql`: tables 1–7 of §4.3, idempotent, headers; add to the three lists
   and fix the v5 omission in compose and reference-deployment.
2. `modules/campaign/`: module (DbModule only), `campaign-rules.ts` + spec, repository,
   config (`CAMPAIGN_ENABLED` dark, `CAMPAIGN_STARTS_AT` fail-closed, `CAMPAIGN_ENDS_AT`),
   routes `POST /v1/auth/challenge`, `POST /v1/auth/verify`, `POST /v1/campaign/enroll`,
   `GET /v1/campaign`, `GET /v1/campaign/me`, `GET /v1/campaign/leaderboard`.
3. Signature verification helper with a spec proving public-key-only verification; a one-line
   client hook calling `kit.signMessage` behind a temporary dev-only trigger (no UI) to test the
   wallet matrix on testnet: Freighter, xBull, Lobstr at minimum.
4. `84-campaign-award.ts` + `85-run-campaign-job.ts` + `job:campaign`; idempotent award for
   `action:*` points and referral credit; runbook draft of the cron line and lock.
5. Catch-up scan via the witness endpoint for enrolled wallets, bounded (second half; can slip
   to EP2 if the matrix test eats the budget).
6. Evidence `docs/evidence/lot-ep/ep1-*.md`: curl transcripts, a proof verified for each
   wallet, one testnet swap earning points through the job, a replayed nonce rejected, a
   stolen-`userId` enrol attempt rejected, `pnpm -C apps/api test` output.

Gate questions: INV-1.2 wording (§9.3); proof on the recovery path (§9.1); points table
values per action kind.

### EP2 — Earn view, leaderboard, streaks, referrals, social claims — 4 to 5 days

1. `#earn` view (five-file change per §5.1) + `components/earn/` + `useCampaign.ts` +
   `api/campaign.ts`; enrol flow with the signed-message prompt and its plain-language copy.
2. `POST /v1/campaign/checkin` (streak), `POST /v1/campaign/social` (self-declared + handle
   uniqueness + daily cap), `POST /v1/campaign/referral/link`; rules and specs extended.
3. `PointsChip` next to the existing APY nodes and in the two action success blocks
   (§5.3); APY nodes untouched; a vitest asserting the chip renders from `pointsForAction` only.
4. Leaderboard section from the `BridgeRoutesTable` pattern; shortened addresses.
5. **STOP-AND-SHOW before the UI is finalised**: a mid-stage checkpoint with captures of the
   Earn view on real testnet data, before polish and copy freeze (the Lot C/ST capture
   pattern). Second gate at stage end with the full flow recorded.

Gate questions: leaderboard exposure (§9.5); social task catalogue and point values;
multiplier caps; whether referral codes are shareable URLs (`#earn?ref=CODE` needs the hash
parser at `useView.ts:28-37` to tolerate a query, a small change).

### EP3 — perks, campaign metrics, runbook — 1.5 to 2 days

1. `wallet_perks` (table 8) + tier thresholds in `campaign-rules.ts` + grant step in `84`;
   `GET /v1/campaign/me` returns unlocked perks; the "beta access" perk is readable by the web
   as a flag for gating early features (no `user_wallets` change).
2. `GET /v1/campaign/metrics` with the §8 definitions and a boundary string; a `#status`
   line or a short section in the Earn view for public transparency (founder call).
3. Docs in the same change: `docs/runbooks.md` (cron line, lock, SQL list, "stuck pending
   verification" and "revoke points" procedures), `docs/deployment.md`,
   `docs/security-invariants.md` (new §11: ownership proof + points, no key, no value),
   `docs/current-state.md`, `docs/status-board.md`, a decision note
   `docs/decisions/2026-10-xx-points-have-no-monetary-value.md`.
4. Evidence: metrics endpoint output on testnet, perk grant transcript, a dark-deploy check
   (`CAMPAIGN_ENABLED` unset → every `/v1/campaign/*` read reports inactive, every write 200
   with `campaign-disabled`).

Gate: go/no-go for the VPS deploy (dark), then activation by the founder with `CAMPAIGN_STARTS_AT`.

### Explicitly out of scope (all stages)

Tokens, airdrops or any promise of them; monetary payouts, reward transfers, payout CSVs; any
new server-side signing key or reuse of the faucet key; on-chain reward or points contracts;
X API verification (self-declaration + handle uniqueness only); FR/EN i18n; page-view or funnel
analytics; changes to `modules/actions/**`, `modules/faucet/**`, the XDR validators, the
flags, whitelists, registries and kill-switches; a shared auth guard across the API (the proof
gates campaign writes only); a materialised leaderboard; notional-weighted points.

## 11. Commands for Maël to run (read-only, VPS or local prod tunnel)

Outputs are counts only; nothing here writes. Replace the DSN with the VPS `DATABASE_URL`
(never paste it anywhere else).

```bash
# Campaign baseline: verified executions by network/kind, and distinct wallets (all time)
psql "$DATABASE_URL" -Atc "select network, kind, count(*), count(distinct lower(wallet_address)) from action_witnesses group by 1,2 order by 1,2"

# Registered wallets and distinct users (the only 'connected' proxy that exists today)
psql "$DATABASE_URL" -Atc "select count(*) wallets, count(*) filter (where is_active_signer) signers, count(distinct user_id) users, min(created_at) first from user_wallets"

# Confirm the v5 columns exist in prod (compose and reference-deployment omit the file)
psql "$DATABASE_URL" -Atc "select column_name from information_schema.columns where table_name='faucet_claims' and column_name in ('campaign','action_family')"

# Faucet routes' nginx zone: docs say the claim POST is in api_actions, the committed snapshot has no faucet location
grep -n "location" /etc/nginx/sites-enabled/* 2>/dev/null
```

## 12. Docs to update when EP lands

`docs/runbooks.md`, `docs/deployment.md`, `docs/reference-deployment.md`, `docker-compose.yml`
header + mounts (SQL list), `docs/security-invariants.md` (§1 review check wording, new §11),
`docs/current-state.md`, `docs/status-board.md`, `docs/TECHNICAL_ARCHITECTURE.md` (replace the
aspirational SEP-10 edge at `:36` with the actual signed-message proof), one decision note.
