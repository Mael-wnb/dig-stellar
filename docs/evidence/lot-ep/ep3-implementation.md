# EP3 — perks, campaign metrics, cron and activation: implementation evidence (2026-10-21)

Scope: what EP3 delivers on `feat/lot-ep3` (uncommitted at the time of writing; the founder
commits) and the local runs that exercised it. Points only: no payout, no token, no new key.
Not deployed anywhere; the campaign is dark in prod (`CAMPAIGN_ENABLED` unset) and the cron line
is not installed. Every number below comes from a command output or a browser run of 2026-10-21
(Node 24.22.0, pnpm 10.32.1, local Postgres 16 with v6 + v7 + v8 applied), labelled. Decision
note: `docs/decisions/2026-10-21-points-have-no-monetary-value.md`.

## 1. Delivered

| Area | What |
|---|---|
| **Schema v8** | `apps/api/src/db/stellar_v8_campaign_perks.sql`: `wallet_perks(campaign, address G… CHECK, perk_key CHECK in the three keys, granted_at, points_at_grant >= 0, PK (campaign, address, perk_key))` + one index on `(campaign, perk_key)`. Additive, idempotent, v6/v7 unchanged. In all four lists: compose mount `52-`, `docs/runbooks.md`, `docs/deployment.md`, `docs/reference-deployment.md`. |
| **Rules** | `campaign-rules.ts`: `PERK_TIERS` (early-access 100, beta-features 500, priority-rwa 1500), `perksFor(balance)` (every tier reached, inclusive), `nextPerkFor(balance, granted)` (lowest tier not granted, `pointsRemaining` never negative; 0 = reached, granted at the next job tick). The spec pins the tiers, the six boundaries (99/100, 499/500, 1499/1500), a negative balance, and asserts the keys equal the v8 CHECK set by reading the SQL file. |
| **Award job** | `84-campaign-award.ts` step 4 "perks", after actions and referrals: for every enrolled wallet, balance = `sum(points)`, insert every reached tier `on conflict do nothing` (`CampaignRepository.balancesOfEnrolled` / `insertPerk`). This script is the ONLY writer of `wallet_perks`; nothing updates or deletes a row. Log line `perks wallets=N granted=M`; summary gains `perks_granted`. |
| **API — /me** | `GET /v1/campaign/me` returns `perks: [{key, grantedAt}]`, `nextPerk: {key, threshold, pointsRemaining} \| null`, `flags: {beta}` (true iff `beta-features` is granted). `GET /v1/campaign` serves `rules.perks` (the tiers) for the web. |
| **API — /metrics** | `GET /v1/campaign/metrics`, public, `Cache-Control: public, max-age=60` + 60 s in-process cache, counts only (never an address). Recon §8 definitions: `walletsRegisteredInWindow` (`user_wallets.created_at`), `walletsProvenInWindow` (distinct addresses by `wallet_ownership_proofs.verified_at`), `walletsEnrolled`, `walletsWithVerifiedActionInWindow` (distinct `action_witnesses.wallet_address`, awardable kinds, `ledger_closed_at` in window), `verifiedActionsByKind` (all three kinds, withdraws listed), `referralsCredited`, `socialClaimsActive` (`deleted_at is null`), `pointsIssued` (sum of positive points), `perksGranted` by key, plus `boundary` (builds vs executions, self-declared social, counters start at `CAMPAIGN_STARTS_AT`, no page views), `dark`, `window`, `asOf`, `disclaimer`. **Dark rule (founder-approved at STOP-AND-SHOW A):** `dark = CAMPAIGN_ENABLED unset OR CAMPAIGN_STARTS_AT unset` → every count 0, `active:false` + reason, no DB read. Otherwise the window counters cover `[startsAt, endsAt)` whatever `active` says: a not-started campaign reads real zeros, an ended one keeps its final numbers. |
| **Web — Earn** | `components/earn/PerksBlock.vue` under the streak strip (enrolled wallets only): the three tiers from `rules.perks`, a GRANTED badge + date from `/me.perks`, the "Next: … pts to go" line from `/me.nextPerk` verbatim (0 remaining → "reached · granted at the next sync"). Copy per key lives here (founder wording). Nothing is gated on a perk; `useCampaign` exposes `flags.beta` for later. |
| **Web — status** | `components/status/CampaignMetricsSection.vue` at the bottom of `#status`, independent of the pipeline state: nine count rows + the API's boundary and disclaimer strings verbatim. Renders nothing while `dark` or on fetch failure. |
| **Docs** | `docs/runbooks.md`: "Perks (EP3)", "Install the campaign cron line" (exact line, lock, log, rotation note), "Activate the campaign" (pre-activation checklist, env names, `pm2 restart --update-env`, verification curls, second manual run, no web redeploy), "Revoke a perk" SQL, "Galxe import (later)". `docs/deployment.md` (v8 in the list, campaign cron section), `docs/current-state.md` + `docs/status-board.md` (Lot EP delivered, dark, activation pending, honesty rule), `docs/TECHNICAL_ARCHITECTURE.md` (the aspirational SEP-10 edge replaced by the as-built signed-message proof edges), `docs/security-invariants.md` §11 (v8 in the schema line), the decision note. |

Out of scope, said plainly: Galxe import (later, only as founder-written `adjust:galxe-import-*`
ledger rows); gating any feature on a perk; automated revocation; page-view or funnel analytics.

## 2. Founder rulings taken (STOP-AND-SHOW A, 2026-10-21)

- **Dark zeroing rule** as above (`dark` field on the payload; the web hides on `dark`, not on `active`).
- **Withdraws appear in `verifiedActionsByKind`** (they are verified executions); the
  distinct-wallet count uses awardable kinds only; the boundary string says withdraws never earn.
- **Perk copy stays in the web** (as the social task labels do); the API serves key + threshold.
- Perk tiers, "granted stays granted", founder-only manual revocation: as briefed.

## 3. Local runs (API built from the working tree, campaign env set in the shell only)

Metrics on the founder's local DB, live env (`CAMPAIGN_ENABLED=true`, `CAMPAIGN_STARTS_AT=2026-10-01T00:00:00Z`):

| Field | Value |
|---|---|
| `walletsRegisteredInWindow` | 1 |
| `walletsProvenInWindow` | 2 (a second local address proved ownership during EP1 testing without registering; proofs and registrations are independent tables) |
| `walletsEnrolled` | 1 |
| `walletsWithVerifiedActionInWindow` | 1 |
| `verifiedActionsByKind` | swap 1 · deposit 0 · withdraw 0 |
| `referralsCredited` / `socialClaimsActive` | 0 / 0 |
| `pointsIssued` | 55 |
| `perksGranted` | 0 / 0 / 0 |
| response header | `Cache-Control: public, max-age=60` |

Dark boot (no campaign env): `active:false`, `reason: campaign-disabled`, `dark:true`, every count 0,
`boundary` and `disclaimer` present. `/me` for the local enrolment: balance 55, `perks: []`,
`nextPerk: early-access, 45 remaining`, `flags.beta false`. One manual `job:campaign-award` on the
live env: `perks wallets=1 granted=0`, summary `… perks_granted=0 duration_ms=24`.

## 4. Browser-verified (local, second API on :3077 + second Vite on :5174, founder's processes untouched)

| Capture | What it shows |
|---|---|
| `shots-ep3/01-perks-block-no-perk.png` | Perks block, three tiers with thresholds, "Next: Early access at 100 pts · 45 pts to go." |
| `shots-ep3/02-perks-block-early-access-granted.png` | Same wallet after a TEMPORARY `wallet_perks` row (early-access, inserted by hand for the capture and deleted right after; `select count(*) from wallet_perks` = 0 afterwards): GRANTED badge + "Granted Oct 21, 2026", "Next: Beta features at 500 pts · 445 pts to go." |
| `shots-ep3/03-status-campaign-metrics.jpg` | `#status` bottom: "CAMPAIGN METRICS · EARN & POINTS · RUNNING · SINCE OCT 1, 2026", the nine rows (values of §3), the boundary + disclaimer line. |
| dark check (API restarted without the campaign env, page reloaded) | `[data-testid=campaign-metrics]` absent, no "Earn" nav entry, the status footer still rendered. |

The local DB is back to its pre-EP3 state after the runs (ledger 55 points, `wallet_perks` empty).
The session copied onto the :5174 origin for the captures was cleared and the tab closed.

## 5. Test and build runs (2026-10-21, Node 24.22.0)

| Command | Output |
|---|---|
| `pnpm -C apps/api test` | `Test Suites: 3 skipped, 26 passed, 26 of 29 total` · `Tests: 38 skipped, 303 passed, 341 total` (EP2: 291 / 323) |
| `CAMPAIGN_IT=1 pnpm -C apps/api test` (local Postgres, v6 + v7 + v8) | `Test Suites: 29 passed, 29 total` · `Tests: 341 passed, 341 total` |
| `nest build` | clean |
| `pnpm -C apps/web test` | `Test Files 6 passed (6)` · `Tests 123 passed (123)` (EP2: 5 / 120) |
| `pnpm -C apps/web build` (`vue-tsc -b && vite build`) | `✓ built`; main chunk `1,838.30 kB │ gzip: 522.33 kB` (EP2: 1,833.04 kB / 521.02 kB) |
| v8 idempotency (local DB, `ON_ERROR_STOP=1`, applied twice) | run 1: `CREATE TABLE`, `CREATE INDEX`; run 2: two "already exists, skipping" notices, no error |

New or extended specs: `campaign-rules.spec.ts` (perks tiers, boundaries, next tier, SQL CHECK
parity), `campaign.service.spec.ts` (perks + flags + next tier on `/me`, `rules.perks`, metrics
dark / live / cached / ended / not-started, boundary wording), `campaign.controller.spec.ts`
(metrics pass-through), `campaign.repository.integration.spec.ts` (`insertPerk` idempotency and
CHECKs, `balancesOfEnrolled`, `metricsFacts` window-bounded vs campaign-scoped as deltas against
the local DB, endsAt exclusive), `84-campaign-award.integration.spec.ts` (run 1 grants early-access
to both seeded wallets at 470 and 100 points, run 2 grants nothing, a −60 adjust under 100 keeps
the perk, a +100 adjust crossing 500 grants beta-features once with `points_at_grant 570`, dark
run grants nothing), `PerksBlock.spec.ts` (renders the API values only, a granted badge survives a
low balance, pending / complete lines).

Invariants §11 review greps over the added code: `handle_normalized` only in the integration
spec's seed SQL; `delete from points_ledger` only in its cleanup helper; `Keypair` only as
`Keypair.random()` in a spec; no "reward" / "airdrop" / "earn XLM" in the new web copy ("token"
appears only inside the API disclaimer rendered verbatim); the job's log lines carry no address.

## 6. Not done, said plainly

- **Not deployed**; v8 is applied only to the founder's local DB. Checklist: `ep3-deploy.md`.
- **Cron line not installed**, campaign still dark; both are founder steps in the runbook.
- **The granted-badge capture used a hand-inserted row** (no local wallet reaches 100 points);
  the job path that grants for real is covered by the integration spec, not by a browser run.
- **`docs/TECHNICAL_ARCHITECTURE.md`**: the diagram edge (line 36), the SEPs table row (line 154)
  and the threat-model row (line 610) now describe the as-built signed-message proof (SEP-53
  bytes, public-key verification, no server key, no session token); SEP-10 is stated as not used
  (founder closing item, STOP-AND-SHOW B).
- **Log rotation** for the three cron logs is a documented gap, to be added with the AD1 deploy
  script.
- **Perks appear within one job tick** (≤ 15 min) of reaching a tier; the block says so
  ("granted at the next sync") rather than granting on read.
