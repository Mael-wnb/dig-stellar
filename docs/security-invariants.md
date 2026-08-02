# Dig Stellar — Mainnet Action Security Invariants

## Purpose

This document is the security contract for **every non-custodial action executed on Mainnet**
(T3-D2). It serves two roles:

1. **Invariants** — properties that must hold at all times in the action path. A violation is a
   release blocker, not a bug to triage.
2. **Review checklist** — every PR that touches the action path (`apps/api` `actions/` module,
   `apps/web` swap/deposit widgets, signing flow) is reviewed against this list before merge, and
   again before any Mainnet ungating.

Scope: SDEX swap and Blend deposit at launch; any future action inherits these invariants by
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
  return **unsigned XDR** (plus quote/metadata). No server-side signing code path exists — the
  `stellar-sdk` `Keypair` signing APIs must not appear in `apps/api` action code.
- **INV-1.3** ✅ Signing happens **exclusively in-wallet** via Stellar Wallets Kit. The web app
  never handles raw secrets either (no manual secret-key input field, ever).
- **INV-1.4** ✅ Submission uses the wallet-signed envelope as returned by the Kit, unmodified.

Review check: grep the diff for `Keypair`, `secret`, `sign(` in `apps/api`; confirm no new DB
columns or logs carry envelope + signature material beyond what submission requires.

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

## 3. Simulation before signature (Soroban path)

- **INV-3.1** ✅ The Blend deposit is **simulated** and must succeed before any signing prompt; a
  simulation failure is surfaced and nothing is signed.
- **INV-3.2** ✅ **Trustline gate (2-step, honest)**: when the classic USDC trustline is missing,
  the API returns ONLY the ChangeTrust step (`trustlineRequired: true`, empty deposit XDR) — the
  deposit is never built, signed, or submitted while the trustline is missing (the SAC transfer
  would trap with Contract #13, and cannot even be simulated). The client signs + confirms the
  trustline on-chain, then re-requests the deposit build.
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
  23 vitest specs green, testnet swap path untouched).

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

## 7. Review process

For every action-path PR:

1. Diff reviewed against sections 1–6; each touched invariant named in the PR description.
2. Red-path evidence for anything new: at least one deliberately-invalid XDR rejected client-side,
   one over-cap request rejected by the API.
3. Before each ungating step (swap, then deposit): run the full checklist top to bottom and record
   the result (date, commit SHA, checker) in the PR or runbook — this record is part of the T3-D2
   security-validation evidence for the SCF claim.

Doc updates: mirror the flag + caps regime into `runbooks.md` and `deployment.md` once implemented.
