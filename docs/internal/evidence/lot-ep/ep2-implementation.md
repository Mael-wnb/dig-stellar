# EP2 — Earn view, leaderboard, social tasks: implementation evidence (2026-10-21)

Scope: what EP2 delivers on `feat/lot-ep2` (uncommitted at the time of writing; the founder
commits) and the local runs that exercised it. Points only: no payout, no token, no new key.
Not deployed anywhere; the campaign is dark (`CAMPAIGN_ENABLED` unset) and the cron line is not
installed (EP3). Every number below comes from a command output or a browser run of
2026-10-21 (Node 24.22.0, pnpm 10.32.1, local Postgres 16 with v6 + v7 applied), labelled.

## 1. Delivered

| Area | What |
|---|---|
| **Web — `#earn` view** | `components/views/EarnView.vue` on the five-file pattern of `#status` (`useView.ts` union + `VIEWS`, `App.vue` `v-if`, `AppTopbar.vue` title, `AppSidebar.vue` nav item + one `ICONS` entry). The nav entry exists only while the API reports `active: true`; the view itself is reachable by URL and shows a "not running" card otherwise. |
| **Web — `components/earn/`** | `EnrollCard` ("This is NOT a transaction" shown before the wallet prompt; Lobstr gets "This wallet cannot sign messages; use Freighter or xBull to join."), `StreakStrip` (check-in button), `TasksList` (shared handle input, claim / remove with inline confirm, "Coming soon" when the API says `available: false`), `ReferralCard` (copy code / copy invite link, link built from `window.location.origin` only: `lib/inviteLink.ts`), `LeaderboardTable` (BridgeRoutesTable pattern, shortened addresses from the API, "you" highlight), `EarnFaq`, `PointsChip`. |
| **Web — state** | `composables/useCampaign.ts`, one module singleton on the `useFaucet` shape: `active` only when the API says so, `null` (unknown) hides every surface. Enrol = `signProof(address, userId)` → `POST /campaign/enroll`. `api/campaign.ts` extended (getCampaign, me, leaderboard, enroll, checkin, social claim, social delete). Nothing in `apps/web` computes points, streaks or multipliers; `lib/pointsForAction.ts` only looks a value up in the API rules block. |
| **Web — `#earn?ref=CODE`** | `useView.ts` parses the `?ref=` query of the hash (8 chars, A-Z/2-9), keeps it in a module ref, passes it to enrol once, never persists it. |
| **Web — PointsChip** | "+N pts" from the API rules block only, as a sibling node next to the APY in `GetStartedCard.vue` (both tiles) and inside the success blocks of `SdexSwapWidget.vue` and `BlendDepositCard.vue` (deposits only). Hidden when the campaign is inactive or unknown. APY nodes and helpers untouched. |
| **API — social routes** | `POST /v1/campaign/social {address, userId, task, handle}` and `DELETE /v1/campaign/social/:id {address, userId}` (`campaign.controller.ts`, thin validation: handle normalised lowercase / leading `@` stripped / `^[a-z0-9_.]{1,32}$`). Decisions in `social-claims.ts` (pure), SQL in `social-claims.queries.ts`, orchestration in `campaign-social.service.ts`: one transaction, `SELECT … FOR UPDATE` on the enrollment row, facts → pure decision → claim row → ledger row (`social_claim_id`). Unique violations mapped by key columns like enrol. `GET /v1/campaign/me` lists `tasks` with claimed state and claim id (never the handle). |
| **API — repost URL** | `CAMPAIGN_X_REPOST_URL` (https, lazy env, name in `.env.example`) served as `rules.socialTasks['x-repost'].url`; `rules.socialTasks` entries are now `{ points, url, available }`. Unset → `available: false` and claims refused with `task-unavailable`. No hard-coded fallback link. |
| **Schema v7** | `apps/api/src/db/stellar_v7_social_claim_delete.sql`: `deleted_at` on `social_task_claims`, the two unique indexes re-created as partial (`where deleted_at is null`). Additive, idempotent; v6 unchanged. Listed in compose (`51-`), runbooks, deployment, reference-deployment. |
| **Docs** | `docs/runbooks.md` "Social tasks (EP2)" paragraph; `docs/security-invariants.md` §11 (INV-11.1 … 11.4 + review check); this file. |

## 2. Founder rulings taken (STOP-AND-SHOW 1 → 2, 2026-10-21)

- **Soft delete, not physical.** A physical delete needed a v6 patch (FK `on delete set null` +
  a relaxed reference CHECK on `points_ledger`); the ruling keeps v6 exactly as deployed and the
  ledger constraints intact. Delete = `deleted_at = now()` + `handle_normalized = 'deleted'` on
  the claim + a negative `adjust:social-delete` ledger row with `adjusts_id` → the credited row,
  in one transaction under the enrollment row lock. The credited row keeps its
  `social_claim_id`. The task can be claimed again afterwards (partial indexes).
- **Daily social cap counts GROSS:** a claim deleted the same UTC day still counts toward that
  day's 50, so a same-day re-claim is refused until the next UTC day.
- **One handle per wallet across all tasks** (`handle-mismatch`), and a handle declared by
  another wallet for any task is refused (`handle-already-used`); the per-task unique index is the
  race backstop.
- **Disclaimer once per surface:** chips carry it as a `title` attribute; one visible line under
  the Get-started card, one in each success block, once at the top of the Earn view and once in
  its FAQ.
- **Repost URL from the API env**, "coming soon" and unclaimable while unset.
- **Copy frozen** as shown in the STOP-AND-SHOW 2 screenshots; the only later change is the
  invite link form (origin only).

## 3. Browser-verified flows (local, campaign active via env, founder's GD4D… wallet)

| Flow | UI | DB check (read-only queries after each step) |
|---|---|---|
| Claim `x-follow` with `@Dig_Test_EP2` | 55 → 75 pts, "Claimed: +20 pts.", Claimed ✓ + Remove | `social_task_claims`: one row, `handle_normalized = dig_test_ep2`, `deleted_at` null; `points_ledger`: `social:x-follow`, 20, `social_claim_id` = the claim id |
| Remove → Confirm | 75 → 55 pts, "Removed. 20 pts reversed.", task claimable again | claim row: `deleted_at` set, `handle_normalized = 'deleted'`; credited row keeps its `social_claim_id`; new row `adjust:social-delete`, −20, `adjusts_id` = the credited row id; `sum(points)` = 55 |
| API log | — | 0 occurrences of the handle in the API log for the run |
| Not enrolled + `#earn?ref=PQMUUPW7` | EnrollCard with "Referral code PQMUUPW7 will be applied when you join." and the NOT-a-transaction block | — |
| Campaign dark | no Earn nav entry; `#earn` shows "The Earn & Points campaign is not running right now." | — |
| Get-started card | "+50 pts" / "+100 pts" chips next to the APY, one disclaimer line under the card | — |

Screenshots: `shots/01…07` and `04b/05b/07b` of 2026-10-21 (founder's copy). Test rows written
by these runs were removed afterwards; the local DB is back to the EP1 state (55 pts).

## 4. Test and build runs (2026-10-21, Node 24.22.0)

| Command | Output |
|---|---|
| `pnpm -C apps/api test` | `Test Suites: 3 skipped, 26 passed, 26 of 29 total` · `Tests: 32 skipped, 291 passed, 323 total` |
| `CAMPAIGN_IT=1 pnpm -C apps/api test` (local Postgres, v6 + v7) | `Test Suites: 29 passed, 29 total` · `Tests: 323 passed, 323 total` |
| `pnpm -C apps/web test` | `Test Files 5 passed (5)` · `Tests 120 passed (120)` |
| `pnpm -C apps/web build` | `✓ built`; main chunk `1,833.04 kB │ gzip: 521.02 kB` (EP1: 1,802.67 kB / 513.27 kB) |
| `grep -rl "DevProofPanel\|__digProof" apps/web/dist \| wc -l` | `0` |
| v7 idempotency (scratch DB, full schema chain, then drop the seven v6 tables, v6 twice, v7 twice, `ON_ERROR_STOP=1`) | all runs ok; indexes left: `social_task_claims_pkey`, `uq_social_task_claims_address_task_active`, `uq_social_task_claims_task_handle_active` |

New specs: `social-claims.spec.ts` (pure rules, every branch), `campaign-social.service.spec.ts`
(transaction order, unique-key mapping, PII boundary, repost gate, soft delete),
`social-claims.integration.spec.ts` (`CAMPAIGN_IT=1`: concurrent claims under the lock, DB
CHECKs, one handle per wallet, `/me` tasks, soft delete, gross cap, next-day re-claim with a
seeded `counted_day`), `PointsChip.spec.ts` (renders the API value only, title = disclaimer,
`pointsForActionIn`), `inviteLink.spec.ts`. The three skipped suites in the default run are the
DB-backed ones (CI has no Postgres).

## 5. Not done, said plainly

- **Success-block chips not screenshotted.** They are mounted inside the swap and Blend
  success blocks (code-reviewed, build-checked) but a screenshot needs a real signed action.
- **Lobstr unsupported** for joining (no `signMessage` in Kit 1.9.5's module); the EnrollCard
  says so.
- **Campaign still dark**, `CAMPAIGN_X_REPOST_URL` unset: the repost task is "coming soon".
- **Cron line not installed** (EP3).
- **Not deployed**; v7 is applied only to the founder's local DB. Deploy checklist:
  `ep2-deploy.md`.
- **Social tasks are self-declared** by design; the handle uniqueness and the gross daily cap
  bound the damage (recon §9.7).
