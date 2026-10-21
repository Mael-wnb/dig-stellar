# EP2 — dark deploy checklist (prepared 2026-10-21, NOT executed yet)

Same shape as `ep1-deploy.md`; the "Output" cells are filled by the founder from the real
command outputs when the deploy runs. Until then this file is a checklist, not evidence.
Campaign stays dark (`CAMPAIGN_ENABLED` unset); `CAMPAIGN_X_REPOST_URL` stays unset; the cron
line is still not installed (EP3). Env variables are named, never valued.

## 0. Before touching the VPS

- [ ] CI green on `main` after the EP2 merge.
- [ ] `git merge --ff-only` of `feat/lot-ep2` into `main`; push to both remotes (origin via the
      git bundle path if the origin key is still broken, and `public-origin` which triggers the
      Vercel build of the web).

## 1. Window

- [ ] Start at :10 / :25 / :40 / :55 (between two refresh ticks) after checking the locks are free:
      `/tmp/dig-stellar-refresh.lock`, `/tmp/dig-stellar-alert.lock`.

## 2. Code

| Step | Output |
|---|---|
| `git fetch` + `git merge --ff-only origin/main` (old → new HEAD, file count) | |
| HEAD hash, date, title | |

## 3. Schema (BEFORE the API build)

| Step | Output |
|---|---|
| `docker exec -i <postgres> psql -U dig -d dig_stellar -v ON_ERROR_STOP=1 < apps/api/src/db/stellar_v7_social_claim_delete.sql` | expected: `ALTER TABLE`, `DROP INDEX`, `CREATE INDEX`, `DROP INDEX`, `CREATE INDEX`, no error |
| `\d social_task_claims` | expected: `deleted_at timestamptz`; indexes `uq_social_task_claims_address_task_active` and `uq_social_task_claims_task_handle_active`, both `WHERE deleted_at IS NULL`; the two v6 names gone |
| `\d points_ledger` | expected: unchanged from EP1 (`points_ledger_social_claim_id_fkey` without an ON DELETE action, `points_ledger_reference_check` present) |

## 4. Build and restart (same refresh gap)

| Step | Output |
|---|---|
| `pnpm install --frozen-lockfile` | expected: lockfile up to date, no additions (EP2 adds no dependency) |
| `prisma generate` | |
| `nest build` | |
| `pm2 restart dig-stellar-api --update-env` + `pm2 save` | online, restart count |

## 5. Verification — API

| Check | Expected |
|---|---|
| `GET /health` | `status: ok`, `version` = the new HEAD, `db: ok` |
| `GET /v1/campaign` | `active: false`, `reason: campaign-disabled`; `rules.socialTasks` entries are now objects `{ points, url, available }` with `x-repost.available: false`, `url: null` |
| `GET /v1/campaign/me?address=<mainnet G…>&userId=<uuid>` | 200, `enrolled: false`, `tasks` array of 3 with `claimed: false` |
| `POST /v1/campaign/social` with a valid body | 200 `claimed: false`, `reason: campaign-disabled` (dark) |
| `crontab -l \| grep -c dig-stellar` | 2 (campaign line NOT installed) |

## 6. Verification — web (Vercel, same push)

| Check | Expected |
|---|---|
| Sidebar | no "Earn" entry while dark |
| `https://stellar.getdig.ai/#earn` | "The Earn & Points campaign is not running right now." card, the disclaimer under it |
| Dashboard Get-started card (a connected wallet without positions) | no "+N pts" chip, no points disclaimer line |
| Swap / Blend forms | unchanged (no chip while dark) |
| `view-source` / bundle | no `DevProofPanel`, no `__digProof` |

## 7. State after this deploy (to be written plainly once done)

- Campaign dark; social routes live but answer `campaign-disabled` (delete answers
  `ownership-proof-required` / `not-found` as there is no enrolment yet).
- `CAMPAIGN_X_REPOST_URL` unset: the repost task is "coming soon" the day the campaign opens
  unless it is set first.
- Cron not installed (EP3).
