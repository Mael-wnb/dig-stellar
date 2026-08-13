# Lot A3 — Blend Withdraw (in-app) — Implementation Brief

Execution brief for Claude Code. The deliberate fast-follow deferred by Lot A2: in-app
**withdraw of supplied Blend collateral**, completing the supply↔withdraw loop in the
action modal. Not required by any SCF criterion (T3-D2's "vault/lending interactions" is
satisfied by the deposit) — this is product completeness before the advisor re-review,
and it produces a bonus mainnet evidence pair (supply tx + withdraw tx). Written
2026-08-13. Pattern: `docs/lot-a2-blend-mainnet.md`; contract:
`docs/security-invariants.md`. This is a MONEY PATH — the review gate is strict.

## Principle carried over from A2

Gate replacement never gate removal; every signing prompt preceded by a client-side
validation gate; flags regime reused (withdraw rides the SAME kill-switches as the
deposit: `ACTIONS_MAINNET_BLEND_ENABLED` / `VITE_ACTIONS_MAINNET_BLEND_ENABLED` — no new
flag; flags unset = testnet-only, byte-for-byte).

## One security decision that DIFFERS from deposit (deliberate — keep it)

**NO amount cap on withdraw.** The 100 XLM cap protects users from over-committing real
funds INTO the protocol; a withdraw returns the user's own funds to their own wallet —
capping it could strand a position larger than the cap. The cap stays on deposit only.

## Scope

### 1. API — `buildBlendWithdraw` (actions module)

- Mirrors `buildBlendDeposit`: network-aware (same registry, same pool, same SACs, same
  passphrase/rpc resolution), `POST /v1/actions/blend/withdraw`, assets XLM | USDC.
- Request type: **`WithdrawCollateral` — verify the enum value from
  `@blend-capital/blend-sdk` SOURCE, never from memory** (the A2 rule; SupplyCollateral
  was verified = 2). Confirm also the contract's amount semantics for withdraw
  (Blend clamps a request above the position to the full position — verify in SDK/docs;
  document what the builder relies on).
- Controller: same `resolveBlendNetwork` gating (mainnet 403 unless the flag), same
  asset whitelist, NO cap (per above — enforce nothing, document why). No trustline
  step needed: withdrawing an asset the user supplied implies the trustline exists
  (USDC withdraw to an account that somehow dropped the trustline will fail on-chain
  atomically — acceptable, note it).
- E3: record `blend-withdraw-build` in `action_events` (add the kind to the closed set).

### 2. Web — validation gate FIRST (the real work, same bar as A2)

Extend `validateDepositXdr.ts` (same module, shared helpers) with
`validateWithdrawXdr`, mirroring the deposit gate exactly:
- parses under intent passphrase ∈ {TESTNET, PUBLIC}; not a fee-bump; tx source = user;
- exactly ONE `invokeHostFunction` op; contract ID = the expected pool from the
  CLIENT-SIDE `config/blendPools.ts` registry (never from the API response);
- decoded `submit` args: fn `submit`; `from`/`spender`/`to` = user; exactly one
  request; `request_type` = WithdrawCollateral (the SDK-verified value); request
  `address` = expected asset SAC; request `amount` = the user's amount scaled to asset
  decimals (exact BigInt compare);
- fee cap 2 XLM (same Soroban budget as deposit).
- **Red tests per invariant** (wrong pool, wrong request type — a SupplyCollateral XDR
  must FAIL the withdraw gate and vice versa, foreign `to`, wrong SAC, wrong amount,
  inflated fee, extra op). The cross-type red tests are the critical new ones: the two
  gates must never accept each other's transactions.

### 3. Web — UI (BlendDepositCard → supply/withdraw tabs)

- The card (inside ActionModal) gains a Supply | Withdraw toggle. Withdraw pane shows
  the user's CURRENT supplied position for the selected asset (the wallets/overview
  positions data already in the shared store — no new endpoint), amount input + Max
  (= the supplied amount), and the same flow: build → validate (`validateWithdrawXdr`)
  → sign in-wallet → submit → tx hash + explorer link.
- Post-withdraw: trigger the wallet refresh so the portfolio position updates (same
  hook the deposit uses). F4 failed-tx copy (Soroban variant) applies as-is.
- Honest copy: no cap on withdraw (say nothing about caps); keep the blend.capital
  escape-hatch line — it stays true and reassuring.
- If the user has NO position in the selected asset: the withdraw pane says so plainly
  and disables the button — never build a doomed tx.

### 4. Validation & evidence

- `pnpm -C apps/web test` green with the new red tests; both builds green.
- Testnet E2E FIRST: supply a few XLM on testnet, withdraw them, both txs confirmed
  (the A2 testnet deposit `a842f370…` precedent). Record hashes.
- Flags unset: mainnet withdraw → 403; testnet unchanged.
- Evidence: `docs/evidence/lot-a3-blend-withdraw.md` — gate description, red-test list,
  testnet tx pair. The MAINNET supply+withdraw pair happens via Maël's wallet after
  review and becomes T3-D2 bonus evidence.
- Docs: runbooks (withdraw added to the mainnet-actions section), security-invariants
  (new gate items, mark ✅), status-board/current-state flagged.

## Out of scope

Borrow / repay · other pools · EURC · partial-liquidation awareness · any change to the
deposit path beyond the shared-module extension · new flags.
