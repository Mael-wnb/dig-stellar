# EP1 — wallet ownership-proof matrix (2026-10-21)

Scope: which wallets can produce the signed-message proof that `POST /v1/auth/verify` accepts,
on testnet, against the local API at `733a454` (the SEP-53 commit) with the web on
`@creit.tech/stellar-wallets-kit` 1.9.5 (`a84f1df`). Measured on 2026-10-21. Nothing deployed.
Browser runs were made by the founder through the DEV-only proof panel
(`apps/web/src/components/dev/DevProofPanel.vue`, mounted only behind `import.meta.env.DEV`);
the byte-form measurement and the Kit module reads were made in this session and are quoted
from their outputs. Addresses appear only where the founder's own testnet wallet printed them.

## 1. Matrix

| Wallet | Version | Bound proof (`userId` set) | Unbound proof (`userId: null`) | Refusal surfaced | Recovery without session |
|---|---|---|---|---|---|
| Freighter | extension 5.49.0 | ok, `variant: "sep53"` | ok, `variant: "sep53"` | popup rejection → `{ code: -4, message: "The user rejected this request." }` in the panel and in `[signProof] step failed { step: "signMessage" }` | one signature, account recovered |
| xBull | extension, testnet | ok, `variant: "sep53"` | ok, `variant: "sep53"` | not exercised | not exercised |
| Lobstr | — | not tested | not tested | — | not possible (see §3) |

Source for the Freighter and xBull rows: the founder's panel output on 2026-10-21 (the panel
prints the raw API JSON of `/v1/auth/verify`, which carries `signatureVariant`). The Freighter
rejection object is the Kit's `parseError` shape (`code`, `message`) printed by the panel's
`formatError` (raw `JSON.stringify` of a non-`Error` throw), after the "[object Object]" fix of
the same day.

## 2. Byte form: SEP-53, measured, not assumed

First run against `733a454^` (verifier accepting `raw` and `sha256` only): Freighter's popup
opened, the user approved, and `/v1/auth/verify` answered `{ ok: false, reason: "signature-invalid" }`
for both bound and unbound. A throwaway script outside the repo (`/tmp/check-sig-forms.mjs`,
`Keypair.fromPublicKey(address).verify` from the web app's `@stellar/stellar-sdk`) was run on
one real panel output (address `GD4DRCDVBJHUCZOUJ4EXJHOKQAHH6SSDVNEKVLME5BD2S77D6QUBWIIY`,
nonce `76dadf7a32438b88eba434b3803f1fa4`, signature base64, 64 bytes):

```
signature: 64 bytes (decoded as base64)
  (a) raw utf8(message): no
  (b) sha256(utf8(message)): no
  (c) SEP-53: sha256(utf8(prefix + message)): VERIFIES
  (d) utf8(prefix + message), unhashed: no
  (e) sha256(base64decode(message)): no
  (f) utf8(message with CRLF): no
  (f2) sha256(utf8(prefix + message with CRLF)): no
  (g) sha256(sha256(utf8(prefix + message))): no
=> match found above
```

with `prefix = "Stellar Signed Message:\n"`. Exactly one candidate verifies. The same vector
through the committed verifier (`ts-node`, `verifyWalletSignature(address, message, signedMessage)`)
prints `{"ok":true,"variant":"sep53"}`.

Verifier contract after `733a454` (`apps/api/src/modules/campaign/verify-wallet-signature.ts`):
candidates are tried in the order `raw` → `sha256` → `sep53`
(`sha256(utf8("Stellar Signed Message:\n" + message))`) and anything else is
`signature-mismatch`; no other byte form is tried (fail closed). The proof row records the
matched form in `wallet_ownership_proofs.signature_variant`, whose CHECK now lists the three
values (`apps/api/src/db/stellar_v6_campaign.sql:77-78`). The spec
(`verify-wallet-signature.spec.ts`) builds the SEP-53 vector from `Keypair.random()` with the
exact construction, asserts `variant: 'sep53'`, and asserts that the prefix without the hash is
rejected and that the hash without the prefix still reports `sha256` (22 tests in that file,
all green on Node 24.22.0).

## 3. Kit facts (read from the installed modules, not from the type declarations)

Kit 1.0.0 (installed before `a84f1df`, released 2024-08-11, bundling `@stellar/freighter-api` 2.0.0
which contains no `signMessage` at all): the Freighter, xBull and Lobstr modules each
**unconditionally** threw `{ code: -3, message: '<Wallet> does not support the "signMessage"
function' }` (`modules/freighter.module.js:58-62`, `xbull.module.js:47-52`,
`lobstr.module.js:49-54`), before any wallet UI. **Recon correction:** `00-recon.md` §1.6 says
"All seven installed modules declare it" — that was true of the TypeScript declaration
(`KitActions.signMessage` in `types.d.ts`), not of any implementation. With Kit 1.0.0 no wallet
could produce the proof.

Kit 1.9.5 (`a84f1df`):

- Freighter module imports `signMessage` from `@stellar/freighter-api` 5.0.0, treats a returned
  `error` as a throw and normalises a `Buffer` result to base64 itself
  (`modules/freighter.module.mjs:63-77`). Kit changelog: Freighter signMessage 1.1.0, Buffer fix
  1.2.5, dual response handling 1.9.4.
- xBull module calls `xBullWalletConnect.signMessage` (`@creit.tech/xbull-wallet-connect` 0.4.0,
  returns `{ signedMessage: string; signerAddress: string }`) — `modules/xbull.module.mjs:47-59`.
  Changelog: 1.8.0.
- Lobstr module still throws `{ code: -3 }` unconditionally (`modules/lobstr.module.mjs:49-54`);
  its `@lobstrco/signer-extension-api` is still `1.0.0-beta.0`. Consequence: a Lobstr user cannot
  enrol and cannot recover an account without a session. The connect flow shows the dedicated
  copy ("This wallet cannot sign messages, so it cannot recover an existing account…",
  `apps/web/src/composables/useConnectFlow.ts:22`, from `842f022`).
- One API change absorbed by the bump: `kit.setNetwork` no longer exists; the constructor
  network is only a fallback passphrase when a signing call omits `networkPassphrase`
  (`stellar-wallets-kit.mjs:72,78,84`), and every signing call here passes it explicitly, so
  the old network watcher was removed. The modal is pinned to the seven 1.0.0 modules via
  `allowAllModules({ filterBy })` (`useWalletSession.ts:38-51`); HOT, Klever, Ledger and Trezor
  stay out until a matrix covers them.
- Known cost: the main web chunk grew from 1,589 kB to 1,803 kB (gzip 429 → 513 kB), the Kit
  now shipping Ledger/Trezor/HOT/Klever code and an elf/rxjs store.

## 4. Refusals observed (founder's local run, API at `733a454`)

| Attempt | Answer |
|---|---|
| replayed nonce with a genuine signature | `challenge-invalid-or-expired` |
| nonce presented after 301 s (`CHALLENGE_TTL_SECONDS = 300`) | `challenge-invalid-or-expired` |
| stranger address with a known `userId` on connect | `ownership-proof-required` |
| second check-in in the same UTC day | `already-checked-in` |

All four reason strings exist in the closed set used by `modules/campaign` and `modules/wallets`
(grep over `apps/api/src`: `already-checked-in`, `campaign-disabled`, `campaign-ended`,
`campaign-not-started`, `challenge-invalid-or-expired`, `not-enrolled`,
`ownership-proof-required`, `signature-invalid`).

## 5. What this matrix does not show

- Mainnet: nothing was signed on mainnet.
- Lobstr: untested, and unsupported by the Kit module as shipped (above).
- Rabet, Albedo, Hana, WalletConnect: still in the picker, not exercised for proofs.
- xBull refusal and recovery paths: not exercised.
