# EP1 — Earn & Points, implementation evidence (2026-10-21)

Scope: what EP1 delivers on `feat/lot-ep1` at `733a454`, and the local end-to-end run that
exercised it. Points only: no payout, no token, no new key. Not deployed anywhere; the campaign
is dark (`CAMPAIGN_ENABLED` unset) and the cron line is not installed (EP3). Every number below
comes from a command output of 2026-10-21 (Node 24.22.0, pnpm 10.32.1) or from the founder's
local e2e run of the same day, each labelled.

## 1. Delivered, by commit

| Commit | What |
|---|---|
| `ebb9042` | **Schema v6** `apps/api/src/db/stellar_v6_campaign.sql`: seven tables (`wallet_auth_challenges`, `wallet_ownership_proofs`, `campaign_enrollments`, `social_task_claims`, `points_ledger`, `wallet_daily_checkins`, `referrals`), additive, idempotent, `create … if not exists`. **Pure rules** `campaign-rules.ts` (no I/O, no Nest, no env) with the values in §2. **Verify-only helper** `verify-wallet-signature.ts`: the ONE file allowed to use `Keypair` outside the faucet, and only `Keypair.fromPublicKey(...).verify(...)` (INV-1.2 narrow exception, `docs/security-invariants.md` §1); its spec asserts that against the source text. |
| `98ad284` | **Routes** `POST /v1/auth/challenge`, `POST /v1/auth/verify` (`auth.controller.ts`), `GET /v1/campaign`, `POST /v1/campaign/enroll`, `POST /v1/campaign/checkin`, `GET /v1/campaign/me`, `GET /v1/campaign/leaderboard` (`campaign.controller.ts`); service, repository, challenge message; the DEV-only proof panel and `signProof` in the web. |
| `5554108` | **Recovery-path fix**: no-session account recovery now requires an unbound ownership proof (`wallets.service.ts`, `wallets.recovery-proof.spec.ts`); before, a stranger could attach to a known `userId` by address alone. |
| `842f022` | Connect answers 200 with a reason on refusal; dedicated copy when a wallet cannot sign messages. |
| `e4831fc` | **Award job** `apps/api/src/scripts/84-campaign-award.ts` (+ pure `84-campaign-award.lib.ts`), the ONLY writer of `action:*` / `referral:*` ledger rows, every insert `on conflict do nothing`; **wrapper** `apps/indexer/src/scripts/85-run-campaign-job.ts` (`job:campaign`); **runbook** section "Campaign award job" in `docs/runbooks.md` (summary line, stuck-pending checklist, revoke-by-adjust). |
| `a84f1df` | Kit 1.9.5 (message signing actually implemented for Freighter and xBull), picker pinned to the seven 1.0.0 modules, `setNetwork` watcher removed. |
| `733a454` | SEP-53 accepted as the third signature variant (see `ep1-wallet-matrix.md` §2). |

## 2. Rule values (from `campaign-rules.ts` / `campaign-config.ts`, read 2026-10-21)

| Rule | Value |
|---|---|
| `sdex-swap` | 50 base points, cap 5 per wallet per UTC day, requires `meets_min_notional` |
| `blend-deposit` | 100 base points, cap 3 per UTC day, requires `meets_min_notional` |
| `blend-withdraw` | 0 (recorded in the witness ledger, never awarded) |
| daily check-in | 5 points (`STREAK_DAILY_POINTS`) |
| streak multiplier on action points | ×1.00 below 7 days, ×1.20 from 7, ×1.35 from 30 (`STREAK_MULTIPLIERS`) |
| social | daily cap 50 (`SOCIAL_DAILY_CAP`) |
| referral | 100 referrer / 50 referee, credited only after the referee's first qualifying witness |
| challenge TTL | 300 s; unbound recovery proof max age 600 s |
| leaderboard | top 50, 60 s cache, shortened address only |

## 3. Local end-to-end (founder's run, 2026-10-21, testnet, API at `733a454`)

Sequence and the values reported from each step's output:

1. Enrol with Freighter: proof `sep53`, enrolment row created.
2. Check-in: +5 (`STREAK_DAILY_POINTS`). A second check-in the same UTC day → `already-checked-in`.
3. Testnet SDEX swap of 5 XLM through the normal action path; `POST /v1/actions/witness` stored
   the witness with `meets_min_notional: true`, notional 5.
4. `pnpm -C apps/indexer job:campaign`, run 1: `candidates=1 awarded=1`, ledger row
   `action:sdex-swap` 50 × 1.00 = 50, `counted_day 2026-10-21`.
5. `GET /v1/campaign/me`: balance 55, `pendingVerification 0`.
6. Job run 2: `candidates=0 awarded=0` (idempotent: the ledger's unique indexes refuse a second
   row for the same witness).
7. `GET /v1/campaign/leaderboard`: the shortened address only, no full address.

## 4. Test runs (this session, 2026-10-21, Node 24.22.0)

| Command | Output |
|---|---|
| `pnpm -C apps/api test` | `Test Suites: 2 skipped, 24 passed, 24 of 26 total` · `Tests: 25 skipped, 263 passed, 288 total` |
| `CAMPAIGN_IT=1 pnpm -C apps/api test` (local Postgres) | `Test Suites: 26 passed, 26 total` · `Tests: 288 passed, 288 total` |
| `pnpm -C apps/web test` | `Test Files 3 passed (3)` · `Tests 111 passed (111)` |
| `pnpm -C apps/web build` | `✓ built`; main chunk `1,802.67 kB │ gzip: 513.27 kB` |
| `grep -rl "DevProofPanel\|__digProof\|signProof" apps/web/dist \| wc -l` | `0` (the DEV panel and the proof call are absent from the production bundle) |
| `pnpm install --frozen-lockfile` (repo root, pnpm 10.32.1) | `Lockfile is up to date, resolution step is skipped` · `Done` |

The two skipped suites in the default run are the integration specs
(`campaign.repository.integration.spec.ts`, `84-campaign-award.integration.spec.ts`), gated by
`CAMPAIGN_IT=1` because CI has no Postgres.

## 5. Not done, said plainly

- **Not deployed.** Neither the API nor the web carries EP1 in production; v6 is applied only to
  the founder's local DB.
- **Campaign dark by design.** `CAMPAIGN_ENABLED` unset → `GET /v1/campaign` answers
  `active: false, reason: campaign-disabled`; the `/v1/auth/*` proof primitive is always on.
- **Blend deposit not exercised on testnet.** The Blend pool is disabled there. The deposit uses
  the same Kit `signTransaction` path as the swap that was exercised, so the witness path is
  shared, but the deposit award (100 points, cap 3) has only its unit tests behind it.
- **Lobstr unsupported.** Kit 1.9.5's Lobstr module does not implement `signMessage`
  (`ep1-wallet-matrix.md` §3); Lobstr users cannot enrol or recover without a session.
- **Integration specs run locally only.** CI has no Postgres; the 25 DB-backed tests are skipped
  there.
- **Cron line not installed.** The draft line in `docs/runbooks.md` waits for EP3.
- **Known EP1 limit.** A witness refused by the daily cap stays in `pendingVerification`
  (documented in the runbook's stuck-pending checklist).
