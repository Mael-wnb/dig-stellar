# Lot A2 — Blend Deposit on Mainnet (T3-D2) — Implementation Brief

Execution brief for Claude Code. Completes **T3-D2 criterion 1** ("swaps **and vault/lending
interactions** on the Mainnet from the dashboard") — the swap half is live since Aug 2; this lot
extends the **Blend deposit**, whose 2-step trustline-gated path is already **proven E2E on
testnet** (deposit tx `a842f370…`). So this is a mainnet extension of a working flow, not a first
build. Companion contract: `docs/security-invariants.md`; pattern: `docs/lot-a1-mainnet-swap.md`.
Written 2026-08-04 against current `main`; re-verify file states before editing.

**Principle: gate replacement, not gate removal — and the deposit gets its OWN kill-switch**, so
its rollout is independent of the (already live) swap. Flags unset = byte-for-byte today's
behavior: deposit testnet-only, mainnet 400.

## Scope

`apps/api` actions module + `apps/web` BlendDepositCard/DigDashboard + a NEW client-side deposit
validation gate. No indexer changes, no new tables.

### 1. Mainnet Blend registry (extend `network-registry.ts`)

Launch scope: **ONE pool — Blend "Fixed" (the main pool, ≈$171M TVL)**, deposit assets **XLM and
USDC** (both already in the testnet card; XLM needs no trustline → simplest first mainnet deposit).

Candidate mainnet constants, taken from the prod refresh logs / DB entities on 2026-08-04 —
**re-verify each against the DB (`entities` where venue `blend`) AND blend.capital before
committing** (never from memory):
- Fixed pool: `CAJJZSGMMM3PD7N33TAPHGBUGTB43OC73HVIK2L2G6BNGGGYOSSYBXBD` (`blend-fixed-pool`)
- USDC SAC: `CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75`
- XLM SAC (native): `CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA`
- USDC classic: `USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN` (already in the
  swap registry)

Confirm the Fixed pool actually holds XLM and USDC reserves (it does per the pool detail; check
`reserve_snapshots`/blend.capital) and that it is a **V2** pool (the builder uses
`PoolContractV2`).

Env (all default OFF/conservative): `ACTIONS_MAINNET_BLEND_ENABLED` ("true" = on; independent
kill-switch, 403 otherwise for `network:"mainnet"` deposits), cap reuses
`ACTIONS_MAINNET_MAX_SEND_XLM` (default 100) applied to the deposit amount whatever the asset.

### 2. API — `actions.service.ts` / `actions.controller.ts`

- `buildBlendDeposit` takes `network: ActionNetwork`. Per-network: rpc server (reuse the swap's
  lazy `rpcFor`), Horizon for `hasClassicTrustline`, passphrase, pool contract, SACs, decimals.
  Testnet path byte-identical (same constants, same 2-step `trustlineRequired` behavior).
- The 2-step trustline gate carries over unchanged to mainnet (USDC deposit without the classic
  trustline → ChangeTrust-only response first; the deposit is never built while the trustline is
  missing).
- Controller: `blend/deposit` replaces its hard testnet-only 400 with `resolveBlendNetwork`
  (absent/'testnet' → testnet; 'mainnet' → 403 unless `ACTIONS_MAINNET_BLEND_ENABLED`); mainnet
  asset whitelist = XLM | USDC only; mainnet cap on amount (400 with the cap + asset in the
  message).

### 3. Web — NEW client-side deposit validation gate (the real security work of this lot)

The swap has `validateSwapXdr`; the deposit needs its Soroban equivalent. New pure module
`apps/web/src/lib/validateDepositXdr.ts` + spec, mirroring the swap gate's style (collect ALL
violations, fail closed, no network calls):

For the **deposit XDR** (single Soroban tx):
- parses under the intent passphrase; passphrase ∈ {TESTNET, PUBLIC}; not a fee-bump;
- tx source = user;
- exactly ONE operation, type `invokeHostFunction`;
- the invoked **contract ID equals the expected pool from a CLIENT-SIDE registry** (new
  `config/blendPools.ts`: per-network pool id + label + SACs — never taken from the API response);
- decode the `submit` invocation args and assert: fn name `submit`; `from`/`spender`/`to` all
  equal the user's address; exactly one request; `request_type` = SupplyCollateral (**verify the
  enum value from `@blend-capital/blend-sdk` source, not memory**); request `address` = the
  expected asset SAC for the chosen asset; request `amount` = the user's amount scaled to the
  asset decimals (exact BigInt compare);
- fee cap: Soroban fees include the resource fee (observed ≈0.06 XLM) — cap total fee at
  **2 XLM** (20,000,000 stroops), generous but catches a corrupted fee field.

For the **trustline XDR** (when `trustlineRequired`): reuse/extend the same module — single
`changeTrust` op for exactly the expected classic USDC (code AND issuer from client constants),
source = user, recognized passphrase, classic fee cap.

Red tests per invariant: wrong contract ID, wrong request amount, foreign `to`, extra op, wrong
asset SAC, inflated fee, wrong trustline issuer.

### 4. Web — `BlendDepositCard.vue` + `DigDashboard.vue`

- `VITE_ACTIONS_MAINNET_BLEND_ENABLED` (UX flag; the API kill-switch is the enforcement);
  `mainnetDepositBlocked = isMainnet && !flag`. Flags unset → today's testnet-only card exactly.
- DigDashboard: the card currently renders only when `network === 'testnet'` (with the
  "Testnet-only for now" note on mainnet) — make it flag-aware like the swap.
- Mainnet mode: pool header shows the **Fixed pool** (from `config/blendPools.ts`, not hardcoded
  testnet CCEBVD…), real-funds warning banner (+ cap mention), network-aware stellar.expert links,
  submit to the network's RPC, and the **validation gate wired before EVERY signing prompt**
  (trustline tx AND deposit tx).
- Honest UI copy on mainnet: withdrawals ship next; funds are non-custodial and always manageable
  directly on blend.capital with the same wallet (this is true and defuses the "can I get it
  back?" question).
- Portfolio synergy (free demo material): after a mainnet deposit, trigger the wallet refresh —
  the T2-D1 position resolver picks the new Blend position + health factor up into the portfolio.
  Note it in the evidence.

### 5. Docs (same change set)

- `docs/runbooks.md`: extend the "Mainnet actions" section — new flags row, and the deposit
  ungating procedure: security-invariants checklist top-to-bottom → re-verify pool/SAC ids vs DB +
  blend.capital → API flag on VPS + PM2 restart → curls (flag off → 403; on → build for a real
  address returns XDR + simulation success; over-cap → 400; EURC asset → 400) → Vercel flag →
  ONE small real deposit (a few XLM) from the dashboard → verify the position appears in the
  portfolio AND on blend.capital → record evidence (`docs/evidence/`).
- `docs/security-invariants.md`: add the deposit gate to §2/§3 (mark implemented items ✅).

## Definition of done

- `pnpm -C apps/web test` green (existing 23 + new deposit-validator spec) · both builds green.
- Flags unset: testnet deposit E2E unchanged (re-run it once); mainnet deposit request → 403.
- Flags set locally: XLM deposit build returns simulated XDR for a real mainnet address; USDC
  path returns the trustline step first for an account without the trustline; over-cap and EURC
  → 400.
- No real mainnet deposit in this lot — the first one happens via the runbook procedure after
  review (its tx hash = the "vault/lending" evidence for T3-D2).

## Out of scope

Withdraw / borrow / repay UI (fast-follow — the blend.capital escape hatch is documented in the
UI copy) · other Blend pools (orbit/etherfuse/yieldblox — one registry line each later) · EURC
deposits · DeFindex vault deposits (not in the grant's action scope) · fee sponsorship.
