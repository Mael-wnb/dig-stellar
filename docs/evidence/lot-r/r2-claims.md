# Lot R — R2 evidence: claims backend + payout worker

Built 2026-08-17, after R1 ratification (+ the blend-withdraw witness
amendment). **Money path — A2/A3 review bar.** Deployed dark by construction:
`FAUCET_ENABLED` defaults false; while dark the treasury is never queried.
Nothing was paid during this build — no funded key existed anywhere; the
funded-payout E2E is R4 scope, after the founder's line-by-line review.

## What landed

- **`faucet_claims`** (`stellar_v4_faucet.sql`): status machine pending→paid |
  pending→failed only. One claim per wallet AND per user, ever — DB-enforced
  via unique indexes on `lower(wallet_address)` and `user_id` (plus
  `witness_tx_hash`), deliberately GLOBAL across networks; budget + velocity
  counts are network-scoped in the service. A `failed` row blocks the
  wallet/user until founder review — payments are never auto-retried.
- **`GET /v1/faucet/eligibility[?wallet=]`** — wallet-less form = the cheap
  campaign poll for R3's promo surface (`{active, remainingClaims, rewardXlm,
  network, minNotionalXlm}`); with `?wallet=` adds `{eligible, reason?,
  claim?}`. Reasons in check order: `faucet-disabled`, `campaign-exhausted`,
  `temporarily-paused` (velocity), `no-qualifying-witness`,
  `below-min-notional`, `claim-failed-pending-review`, `already-claimed`,
  `treasury-unavailable`, `treasury-drained`. Blend-withdraw witnesses are
  excluded from eligibility by kind (KPI ledger only).
- **`POST /v1/faucet/claim {wallet}`** — re-runs the FULL eligibility
  server-side (the GET is advisory), refuses before inserting anything if the
  key is unavailable (an ops mistake must not consume the wallet's one slot),
  inserts `pending`, pays, records `paid` + payout hash or `failed` + reason.
- **Payout isolation** (`faucet-payout.service.ts` — the ONLY file in apps/api
  allowed to read `FAUCET_SECRET_KEY` / invoke Keypair signing, per
  security-invariants §9): can express exactly ONE tx shape — a single native
  payment of the reward, memo `dig-reward`, fixed 10000-stroop fee, 60s
  timebound. Secret read lazily per payout, never cached/logged/thrown.
  Ambiguous submit failures (timeout/5xx) carry `maybePaid` and the stored
  failure reason says "verify on explorer before resolving"; only a definitive
  Horizon 400 is recorded as not-paid.
- **Concurrency**: the whole claim (re-check → insert → payout → record) runs
  through one in-process serial queue; the hot wallet's sequence number makes
  parallel submits fail anyway — designed for, not discovered. Single pm2
  process (Lot S); the DB unique indexes are the multi-process backstop.
- **Brakes**: 40-claim budget (counts pending+paid+failed — conservative:
  an ambiguous failure may have paid), 10 claims/rolling hour (full drain ≥ 4h
  of sustained abuse), auto-halt when treasury spendable < reward (spendable =
  native − 1.5 XLM reserve/fee buffer), 30s treasury cache so eligibility
  polls don't hammer Horizon.
- **Drain visibility**: `/v1/ops/metrics` now carries a `faucet` block
  (enabled, network, claim counts incl. paid24h + remaining, treasury
  spendable). Never the treasury address. Dark deploy exposes no key state.
- **The one pure decision procedure** (`faucet-eligibility.ts`) is shared by
  the GET and the claim path, and unit-locked (`faucet-eligibility.spec.ts`,
  16 cases) together with the pinned payout tx shape
  (`faucet-payout.spec.ts`, 4 cases). API suite: **117 tests green**.

## Validation run (2026-08-17, local API on :3111, no key anywhere)

- v4 schema applied twice — idempotent.
- **Dark** (env unset): campaign `active:false`; wallet eligibility + claim →
  `faucet-disabled`; malformed wallet → 400; `/v1/ops/metrics` faucet block
  shows `enabled:false, treasurySpendableXlm:null` (treasury never queried).
- **Enabled, testnet, no key** — staged witness rows walked the whole chain:
  no witness → `no-qualifying-witness`; witness with `meets_min_notional=false`
  → `below-min-notional`; witness ok → `treasury-unavailable`; claim with ok
  witness + no key → refused **without inserting a row** (count stayed 0).
- **Double-claim**: staged paid claim → eligibility `already-claimed` +
  `claim:{status:'paid', payoutTxHash}` (feeds R3's paid state); re-claim →
  `already-claimed`; direct SQL duplicates rejected by BOTH unique indexes
  (case-insensitive wallet, user). All smoke rows deleted after the run.

## Red-test coverage map (brief → where proven)

| Red test | Unit spec | Live smoke | R4 E2E |
|---|---|---|---|
| double claim (both keys) | ✅ eligibility spec | ✅ + DB backstops | pending |
| unwitnessed wallet | ✅ | ✅ | pending |
| below-notional | ✅ | ✅ | pending |
| disabled flag | ✅ | ✅ | pending |
| drained balance | ✅ (spec) | — (needs funded key) | pending |
| velocity brake | ✅ (spec) | — (needs claims volume) | pending |

## For the line-by-line review

- Grep check per §9: `FAUCET_SECRET_KEY` and `Keypair` appear ONLY in
  `faucet-payout.service.ts` (+ its spec, test keypairs only).
- Isolation: `modules/faucet/` imports nothing from `modules/actions/**`
  (Horizon URLs/passphrases deliberately duplicated in `faucet-config.ts`).
- Docs updated in this change: security-invariants §9 + INV-1.2 scoped
  amendment, runbooks apply line, `.env.example`. Flagged for later:
  `docs/TECHNICAL_ARCHITECTURE.md` + CLAUDE.md data-architecture block gain a
  "v4 — faucet" family line (founder call whether at R2 commit or R4).
- Go-live runbook (funding, pausing, draining, resolving `failed`) is R4
  scope. Must include (review fix 2, 2026-08-17): a claim row stuck in
  `pending` > 5 min means the post-payout UPDATE failed — verify the payout
  hash on the explorer and resolve the row manually, same procedure as
  `failed`.

## Review fixes (2026-08-17, same commit)

1. The claim-insert catch now distinguishes Postgres 23505 (unique violation →
   `already-claimed`) from any other error (logged, returned as a distinct
   `claim-error`) — a DB outage no longer masquerades as already-claimed.
   Helper `isUniqueViolation` exported + unit-locked.
2. Stuck-pending procedure recorded in the v4 schema header (above) for the R4
   runbook.
3. Ratified as-is: third-party-triggerable claims (payout always goes to the
   witnessed wallet itself); treasury cache not network-keyed (single active
   network per process — comment added).
