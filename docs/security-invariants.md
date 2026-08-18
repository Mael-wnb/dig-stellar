# Dig Stellar — Mainnet Action Security Invariants

## Purpose

This document is the security contract for **every non-custodial action executed on Mainnet**
(T3-D2). It serves two roles:

1. **Invariants** — properties that must hold at all times in the action path. A violation is a
   release blocker, not a bug to triage.
2. **Review checklist** — every PR that touches the action path (`apps/api` `actions/` module,
   `apps/web` swap/deposit widgets, signing flow) is reviewed against this list before merge, and
   again before any Mainnet ungating.

Scope: SDEX swap, Blend deposit and Blend withdraw; any future action inherits these invariants by
default. Testnet is the rehearsal environment — the invariants apply there too, but enforcement
becomes non-negotiable the moment `PUBLIC` network execution is possible.

Maps to the T3-D2 criterion: "Validation of strict security: backend stores only public addresses
and never processes private keys."

Status markers: ✅ implemented · 🔲 to implement before Mainnet ungating (Lot A1).

---

## 1. Non-custodial boundary (backend)

- **INV-1.1** ✅ The backend accepts and stores **public addresses only**. No endpoint, DTO, log
  line, or DB column may accept, persist, or transit a secret key, mnemonic, or
  signed-envelope-with-secret material.
- **INV-1.2** ✅ Action endpoints (`POST /v1/actions/*`) take `{public address, action params}` and
  return **unsigned XDR** (plus quote/metadata). No server-side signing code path exists for
  anything a USER owns — the `stellar-sdk` `Keypair` signing APIs must not appear in `apps/api`
  action code. *Sole scoped exception (Lot R, 2026-08-17): the reward-faucet treasury — DIG's own
  wallet, DIG's own funds, isolated in `modules/faucet/faucet-payout.service.ts`. See §9.*
- **INV-1.3** ✅ Signing happens **exclusively in-wallet** via Stellar Wallets Kit. The web app
  never handles raw secrets either (no manual secret-key input field, ever).
- **INV-1.4** ✅ Submission uses the wallet-signed envelope as returned by the Kit, unmodified.

Review check: grep the diff for `Keypair`, `secret`, `sign(` in `apps/api`; confirm no new DB
columns or logs carry envelope + signature material beyond what submission requires. A hit
anywhere OUTSIDE `modules/faucet/faucet-payout.service.ts` (the §9 exception) is a defect.

## 2. Client-side XDR validation before signing

The backend is trusted-but-verified: the web app **decodes the returned XDR and asserts it matches
the action the user asked for** before the Kit is invoked (`apps/web/src/lib/validateSwapXdr.ts`,
wired in `SdexSwapWidget.onSwap`). The intent is derived from **user input + client-side config**
(`config/testnetSwapPairs.ts` — vetted (code, issuer) pairs), never from the API response. Refuse
to open the signing prompt on any mismatch — fail closed, show every violation.

For the SDEX swap, the validator asserts:

- **INV-2.1** ✅ **Network**: the XDR parses under the intent passphrase, that passphrase is one
  this app signs on (TESTNET / PUBLIC), the tx is not a fee-bump wrapper, and the SAME passphrase
  validated with is the one used to sign. (An unsigned classic envelope does not embed its
  network — the passphrase pairing at sign time is the real guarantee.)
- **INV-2.2** ✅ **Source account**: the transaction source (and any op-level source) equals the
  connected address, which equals the active-signer wallet (T2-D1 guardrail stays in force).
- **INV-2.3** ✅ **Operation whitelist**: the swap is the **sole** operation by default. The ONLY
  exception is an explicitly-permitted trustline setup (`allowTrustlineFor`): a single ChangeTrust
  whose `line` matches the dest asset **exactly (code AND issuer)**, from the user's own account —
  required for a first swap into a not-yet-trusted asset. Any other extra op (payment, setOptions,
  a ChangeTrust for any other asset, liquidity-pool trustlines) is rejected. The ChangeTrust
  *limit* is deliberately unconstrained: a wrong limit cannot credit a foreign account or change
  the asset — worst case the swap fails on-chain.
- **INV-2.4** ✅ **Assets**: send and dest asset match the intent's code AND issuer (issuer
  comparison is mandatory — code alone is spoofable by look-alike tokens).
- **INV-2.5** ✅ **Amounts**: `sendAmount` equals the user's input exactly (stroop-exact BigInt
  comparison); on-chain `destMin` ≥ the accepted slippage-adjusted minimum.
- **INV-2.6** ✅ **Fee cap**: total envelope fee ≤ 100,000 stroops (0.01 XLM). The API builds at
  BASE_FEE per op (100–200 stroops total); the cap catches a corrupted or malicious fee field
  before it can burn XLM.
- **INV-2.7** **Time bounds**: envelopes carry short time bounds (server sets `setTimeout(300)`),
  so a stale approved-but-unsubmitted XDR cannot execute much later at a worse price.
  *Enforced server-side today; not yet client-asserted — acceptable for launch, tighten later.*

Review check: the validation module stays pure (XDR in → verdict out) and unit-tested per
invariant, including red tests (wrong issuer, extra op, foreign source, inflated fee, worse
destMin). Suite: `apps/web/src/lib/validateSwapXdr.spec.ts`.

### 2b. Client-side XDR validation for the Blend deposit (Soroban path) — Lot A2

The Blend deposit is a Soroban `invokeHostFunction`, so it gets its own gate,
`apps/web/src/lib/validateDepositXdr.ts`, wired in `BlendDepositCard.onDeposit` **before EVERY
signing prompt** (the ChangeTrust step AND the deposit step). Intent derives from user input +
client config (`apps/web/src/config/blendPools.ts` — per-network pool id + reserve SACs + classic
USDC issuer), **never** from the API response. Same fail-closed, collect-all-violations contract.

For the **deposit XDR**, the validator asserts (`validateDepositXdr`):

- **INV-2.8** ✅ **Network / envelope**: parses under the intent passphrase, that passphrase is one
  this app signs on (TESTNET / PUBLIC), and the tx is not a fee-bump wrapper — same guarantee as
  INV-2.1, signed with the same passphrase validated with.
- **INV-2.9** ✅ **Source + single op**: tx source (and op source, if set) equals the connected
  active-signer address, and the deposit is the **sole** operation, of type `invokeHostFunction`.
- **INV-2.10** ✅ **Pool pinning** (generalized to N pools in Lot A5): the invoked contract id equals
  the expected pool from the CLIENT registry (`config/blendPools.ts`), and the called function is
  `submit`. A swapped pool/contract is rejected regardless of what the API returned.
  Since A5 the registry holds **several vetted pools per network**, and the gate pins the
  **REQUESTED** one — the pool the card resolved from its own registry for the slug the modal was
  opened with, never a default and never the pool named in the API response. Generalizing the pool
  from a constant into a parameter is exactly the kind of change that can quietly weaken a gate, so
  it is held by cross-pool red tests over every ORDERED PAIR of real registry pools
  (`validateDepositXdr.spec.ts`, Lot A5 blocks): an XDR built for pool A must fail an intent that
  pins pool B, for deposit and withdraw alike. A slug absent from the client registry resolves to
  `null` and the card renders **no form at all** — an unvetted pool id must never reach the gate.
- **INV-2.11** ✅ **Submit args**: `from` / `spender` / `to` all equal the user; exactly ONE request;
  `request_type` = `SupplyCollateral` (enum value `2`, verified against `@blend-capital/blend-sdk`
  source); request `address` = the expected reserve SAC for the chosen asset; request `amount` =
  the user's amount scaled to the asset decimals (exact BigInt compare).
- **INV-2.12** ✅ **Fee cap**: total fee ≤ **2 XLM** (20,000,000 stroops). Soroban fees include the
  resource fee (observed ≈0.06 XLM); the cap is generous but catches a corrupted fee field.

For the **trustline XDR** (`validateTrustlineXdr`, when `trustlineRequired`): a single `changeTrust`
op for exactly the expected classic USDC (code AND issuer from client constants), source unset/the
user, recognized passphrase, classic fee cap (0.01 XLM).

Review check: pure module, unit-tested per invariant with red tests (wrong contract id, wrong
request amount, foreign `to`/`from`/`spender`, extra op, wrong asset SAC, wrong request_type,
inflated fee, wrong trustline issuer/code). Suite: `apps/web/src/lib/validateDepositXdr.spec.ts`.

### 2c. Client-side XDR validation for the Blend withdraw — Lot A3

The withdraw is the same Soroban `submit` envelope as the deposit, so it reuses the same module
and the same decoder (`validateSubmitXdr`), parameterized by the expected request type. Wired in
`BlendDepositCard.onWithdraw` before the signing prompt, intent from user input + client config —
never the API response. INV-2.8 → INV-2.12 apply to `validateWithdrawXdr` unchanged, with:

- **INV-2.13** ✅ **Request-type pinning is per action, and the two are mutually exclusive.** The
  deposit gate pins `SupplyCollateral` (`2`); the withdraw gate pins `WithdrawCollateral` (**`3`**),
  both read from the `@blend-capital/blend-sdk` enum source (`Supply=0, Withdraw=1,
  SupplyCollateral=2, WithdrawCollateral=3, Borrow=4, Repay=5, …`), never from memory. A
  SupplyCollateral envelope can therefore never pass the withdraw gate and vice versa — red-tested
  both directions, on hand-built fixtures AND on real API-built envelopes in the testnet E2E. Note
  `WithdrawCollateral` (3) ≠ `Withdraw` (1): the latter unwinds a non-collateral supply this app
  never creates, and is rejected.
- **INV-2.14** ✅ **`to` = the user, on the withdraw too.** On a withdraw `to` is the account
  CREDITED with the returned tokens, so a foreign `to` is a direct fund-diversion vector. Same
  assertion as the deposit, red-tested.
- **INV-2.15** ✅ **No cap on the withdraw — deliberate, at every layer.** A cap protects a user
  from over-committing funds INTO a protocol; a withdraw returns the user's own funds to their own
  wallet, and a cap could strand a position larger than it. The exact-amount invariant (INV-2.11)
  is unchanged, so the user still signs precisely what they asked for.

Suite: same file, 72 tests. Evidence + testnet tx pair: `docs/evidence/lot-a3-blend-withdraw.md`.

## 3. Simulation before signature (Soroban path)

- **INV-3.1** ✅ The Blend deposit **and withdraw** are **simulated** and must succeed before any
  signing prompt; a simulation failure is surfaced, the response carries an empty `xdr`, and
  nothing is signed. (Proven for the withdraw: a withdraw against an empty position returns
  Contract #1217 and no signable XDR — see `docs/evidence/lot-a3-blend-withdraw.md`.)
- **INV-3.1b** ✅ **Declared Soroban resources carry headroom** (`padResources`, Lot A3). A
  simulation measures resources against the ledger at that instant and those limits are enforced
  exactly at apply time, so state drift in between fails a transaction the user already signed
  (observed once: `scecExceededLimit`, needed 1024 write-bytes, declared 996). Both Blend builders
  widen the declared limits ×1.25 (+128 bytes) and the resource fee ×1.5. The declared fee is a
  ceiling, not a charge, and the client fee cap (INV-2.12) still applies.
- **INV-3.2** ✅ **Trustline gate (2-step, honest)**: when the classic USDC trustline is missing,
  the API returns ONLY the ChangeTrust step (`trustlineRequired: true`, empty deposit XDR) — the
  deposit is never built, signed, or submitted while the trustline is missing (the SAC transfer
  would trap with Contract #13, and cannot even be simulated). The client **validates that
  ChangeTrust XDR client-side** (§2b `validateTrustlineXdr`), signs + confirms the trustline
  on-chain, then re-requests the deposit build.
- **INV-3.3** ✅ Classic SDEX swaps rely on the live quote (`/v1/actions/sdex/quote`, direct routes
  only — matching the swap's empty path) fetched seconds before build; min-receive is derived from
  it with bounded slippage, never hand-entered.

## 4. Launch controls (Mainnet gating regime) — Lot A1

Ungating Mainnet is **not** deleting the Testnet-only guard. It is replacing it with a controlled
regime (see `docs/tasks/lot-a1-mainnet-swap.md` for the implementation brief):

- **INV-4.1** ✅ **Feature flag**: Mainnet execution sits behind `ACTIONS_MAINNET_ENABLED` in
  `apps/api` (kill-switch, default OFF → 403) and `VITE_ACTIONS_MAINNET_ENABLED` in `apps/web`
  (UX only, not enforcement). Unset flags = exactly today's testnet-only behavior. Enforced in
  `actions.controller.ts` (`resolveSwapNetwork`); `network-registry.ts` reads the env lazily.
- **INV-4.2** ✅ **Per-transaction cap**: a send-amount cap (`ACTIONS_MAINNET_MAX_SEND_XLM`,
  default 100) enforced **in the API** (`actions.controller.ts` `sdex/swap`, 400 over-cap), not
  only the UI. Raise deliberately as confidence grows.
- **INV-4.3** ✅ **Mainnet asset whitelist**: the API accepts arbitrary `{code, issuer}` on
  testnet (vetted client-side), but on Mainnet the server rejects any asset outside its own
  whitelist — `MAINNET_ASSET_WHITELIST` + `isWhitelistedMainnetAsset` in `network-registry.ts`,
  applied to `sdex/quote` + `sdex/swap`. Launch set (Lot A1b): native XLM + USDC, EURC, AQUA,
  yXLM, PYUSD — each vetted on-chain (direct book fills both directions at the 100 XLM cap within
  5% slippage) AND issuer-verified against the issuing org; evidence in
  `docs/evidence/pair-vetting-2026-08-01.md`. Every whitelist entry mirrors one
  `MAINNET_SWAP_PAIRS` entry in `apps/web` (the two lists are cross-referenced both ways).
  Client-side vetted pairs are UX; the server whitelist is the enforcement.
- **INV-4.4** ✅ **Slippage bound**: tolerance is fixed at 5% in the widget; min-receive is
  quote-derived. 🔲 server-side rejection of a worse requested `destMin` still pending (client
  gate `validateSwapXdr` already asserts on-chain `destMin` ≥ accepted minimum).
- **INV-4.5** ✅ **The Testnet demo path stays intact**: gating replaces, never removes, the
  testnet-only guard — with flags unset the testnet flow is byte-for-byte today's (web build +
  vitest specs green, testnet swap path untouched).
- **INV-4.6** ✅ **Blend deposit has its OWN kill-switch (Lot A2)**: `ACTIONS_MAINNET_BLEND_ENABLED`
  in `apps/api` (default OFF → 403 for `blend/deposit` `network:"mainnet"`) + `VITE_ACTIONS_MAINNET_BLEND_ENABLED`
  in `apps/web` (UX only). Independent of the swap switch, so each ungates on its own. The mainnet
  deposit reuses the shared per-transaction cap (`ACTIONS_MAINNET_MAX_SEND_XLM`) on the deposit
  amount, and its asset set is XLM | USDC only (any other → 400). Enforced in `actions.controller.ts`
  (`resolveBlendNetwork`); pool + reserve SACs read per-network from `network-registry.ts`
  (`resolveBlendPool`). Flags unset = testnet deposit byte-for-byte today's.
- **INV-4.7** ✅ **The Blend withdraw rides the SAME kill-switch (Lot A3)** — no new flag.
  `blend/withdraw` and `blend/position` both go through `resolveBlendNetwork`, so with the flags
  unset a mainnet withdraw is a **403** exactly like a mainnet deposit and no mainnet endpoint is
  contacted (verified in the testnet E2E). Same asset set (XLM | USDC, anything else 400).
  **The per-transaction cap deliberately does NOT apply** — see INV-2.15 for why.
- **INV-4.8** ✅ **Multi-pool resolution never falls back (Lot A5).** `blend/deposit`,
  `blend/withdraw` and `blend/position` accept an optional `pool` slug. Absent = the network's
  default pool (pre-A5 behavior, so older clients are unaffected); **unknown = 400**, never a
  silent substitution — acting on a pool the caller did not name is the defect A5 fixes, and on a
  money path it would mean supplying funds somewhere the user never chose. An asset the resolved
  pool has no reserve for is also a **400** naming the pool (`assertPoolSupportsAsset`); the Orbit
  pool is XLM-only, verified on-chain. The kill-switch is checked BEFORE pool resolution, so with
  the flags unset every pool returns 403 (verified for all 4 pools × 3 endpoints). Each pool's
  asset list comes from a **live SDK read**, never from `reserve_snapshots`, which retains rows for
  reserves a pool no longer has — see `docs/evidence/lot-a5-blend-multipool.md`.

## 5. Known defects — status

- **INV-5.1** ✅ **Fixed.** `buildSdexSwap` previously used `rpc.getAssetBalance` to detect the
  destination trustline, misreporting existing trustlines as missing and re-bundling a redundant
  ChangeTrust. Both action paths now use the Horizon-based `hasClassicTrustline` (authoritative
  for classic trustlines). ChangeTrust is bundled IFF the trustline is genuinely missing; on a
  Horizon failure we fail safe toward bundling (redundant CT is a no-op; a missing one guarantees
  `op_no_trust`).
- **INV-5.2** 🔲 Missing/invalid action bodies must return a clean 400, not a 500 — on Mainnet,
  ambiguous server errors in the action path are a trust problem, not cosmetics.

## 6. Execution feedback & failure handling

- **INV-6.1** ✅ Every submission reaches a terminal, honest UI state: pending → success (tx hash +
  stellar.expert link) or failure (decoded reason). ✅ the explorer link follows the network
  (`explorerNetwork` in `SdexSwapWidget.vue`: `public` on mainnet, `testnet` otherwise).
- **INV-6.2** ✅ No automatic rebuild-and-resubmit. A failed or timed-out submission requires an
  explicit new user action (which re-quotes and re-validates).
- **INV-6.3** Failures are logged server-side with enough context to debug (public address, action,
  error class) — and nothing more (no envelopes with signatures in long-term logs).

## 7. Beta API access model & rate limiting (Lot S — §S3)

An honest statement of what protects the user-scoped API during the beta:

- **The model:** `userId` (a UUID kept in the web app's localStorage) acts as the
  bearer token. Whoever presents a userId can read and mutate that user's wallets,
  alert rules and notifications. There are no accounts, no sessions, no signatures.
  **Its limits:** userIds can leak (URLs are query-string based, so they appear in
  server/nginx logs and browser history) and cannot be revoked or rotated except by
  abandoning the account. This is accepted beta scope; a real auth system is
  post-beta. Nothing custodial is behind it — no keys, no signing capability, only
  watch data and alert preferences (section 1 invariants are independent of this model).
- **What makes it tolerable now:** (1) userIds are 122-bit random UUIDs — not
  guessable, and every user-scoped endpoint validates the UUID shape (400) then
  scopes queries `WHERE user_id = $userId`, returning **404 for anything not owned
  — never 403 —** so the API is not an existence oracle for other users' resources
  (pattern verified across wallets/alert-rules/notifications in the S0 sweep;
  regression-guarded by `alerts.ownership.spec.ts`). (2) Since Lot S the whole
  surface sits behind per-IP nginx rate limits (zones in `deployment.md`), which
  turns bulk userId probing from free into expensive.
- **Known quirk (standing W1 debt, still open):** on several wallet *read* routes an
  ABSENT userId falls back to the shared demo account by design. Invalid userIds are
  always 400 — the fallback applies only when the parameter is missing entirely.
- **Ops endpoints are deliberately public** (founder decision, S0 2026-08-17):
  `/v1/ops/metrics` and `/v1/ops/adoption` stay unauthenticated for grant
  transparency — adoption counters are citable KPI evidence. Their payloads are
  verified to contain no secrets, env values or internal URLs; they do reveal
  aggregate usage levels, which is accepted.

## 8. Review process

For every action-path PR:

1. Diff reviewed against sections 1–7; each touched invariant named in the PR description.
2. Red-path evidence for anything new: at least one deliberately-invalid XDR rejected client-side,
   one over-cap request rejected by the API.
3. Before each ungating step (swap, then deposit): run the full checklist top to bottom and record
   the result (date, commit SHA, checker) in the PR or runbook — this record is part of the T3-D2
   security-validation evidence for the SCF claim.

Doc updates: mirror the flag + caps regime into `runbooks.md` and `deployment.md` once implemented.

## 9. Reward-faucet treasury (Lot R, 2026-08-17) — the ONLY server-side key

The Lot R faucet pays 5 XLM from a DIG-owned hot wallet after a verified qualifying action.
This is the FIRST time a funded secret key lives server-side. It changes nothing about user
funds — the §1 non-custodial boundary for anything a USER owns is untouched.

- **INV-9.1** The treasury is **DIG's own money, never the user's**. A dedicated fresh keypair,
  funded manually with **200 XLM — the hard exposure cap**. Worst case if everything fails, the
  hot wallet drains: bounded, accepted, and the only reason this is beta-shippable. Never fund
  beyond the cap; refills are manual and deliberate.
- **INV-9.2** `FAUCET_SECRET_KEY` exists ONLY in the VPS env — never committed, never logged,
  never in an error message or API payload, never in chat. The keypair is generated locally by
  the founder.
- **INV-9.3** Code isolation: `modules/faucet/` imports nothing from the user action paths
  (`modules/actions/**`) and vice versa. Key access + `Keypair` signing are confined to
  **`faucet-payout.service.ts`**, which can express exactly ONE transaction shape: a single
  native payment of the reward with memo `dig-reward`. The pinned-shape spec
  (`faucet-payout.spec.ts`) is part of this invariant.
- **INV-9.4** Kill-switch `FAUCET_ENABLED` defaults **false** — the faucet deploys dark; the
  founder flips it. While dark, the treasury is never queried and no key state is observable.
- **INV-9.5** Payment discipline: payouts are strictly serial; **a failed payout is NEVER
  auto-retried** (an ambiguous failure may still have paid) — the claim row blocks the
  wallet/user until founder review. One claim per wallet AND per user, ever, DB-enforced.
- **INV-9.6** Brakes: 40-claim campaign budget, max 10 claims per rolling hour (a full drain
  takes ≥ 4h of sustained abuse), payouts auto-halt when treasury spendable < reward.
- **INV-9.7** Public surfaces (`/v1/faucet/*`, `/v1/ops/metrics`) never expose the treasury
  address or anything about the key beyond the spendable balance. `POST /v1/faucet/claim` sits in
  the Lot S strict nginx rate-limit zone; `GET /v1/faucet/eligibility` was moved to the general
  zone (2026-08-17 incident — it is a polled read surface and the strict zone starved it; the
  money-moving claim POST stays strict).

Review check (every faucet-path PR): grep the diff for `FAUCET_SECRET_KEY` and `Keypair` —
confined to `faucet-payout.service.ts`; confirm no new transaction shapes; confirm the red
tests (double claim, disabled flag, below-notional, exhausted, velocity, drained) still pass.
