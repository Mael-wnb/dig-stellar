# EP2 — dark deploy to the VPS (2026-10-21) — EXECUTED

Scope: the production deploy of Lot EP2 (social tasks, Earn view, v7) — API on the VPS, web on
Vercel — with the campaign dark (`CAMPAIGN_ENABLED` unset), `CAMPAIGN_X_REPOST_URL` unset and
the cron line still not installed (EP3). Same shape as `ep1-deploy.md`. Every number below is
from the founder's command outputs of 2026-10-21; nothing is inferred. Env variables are named,
never valued.

## 0. Before touching the VPS

- [x] CI green on `main` after the EP2 merge.
- [x] `git merge --ff-only` of `feat/lot-ep2` into `main`; pushed to both remotes (the push to
      `public-origin` triggers the Vercel build of the web).

## 1. Window

- [x] Run between two refresh ticks, locks free (`/tmp/dig-stellar-refresh.lock`,
      `/tmp/dig-stellar-alert.lock`).

## 2. Code

| Step | Output |
|---|---|
| `git fetch` + `git merge --ff-only origin/main` | `e266481` → `3ca1d62`, 46 files, +3001 −29 |
| HEAD | `3ca1d62`, 2026-10-21 15:12:19 +0200, "docs(lot-ep): EP2 runbook, invariants §11, evidence and deploy checklist" |

## 3. Schema (BEFORE the API build)

| Step | Output |
|---|---|
| `docker exec -i … psql -U dig -d dig_stellar -v ON_ERROR_STOP=1 < apps/api/src/db/stellar_v7_social_claim_delete.sql` | `ALTER TABLE`, `DROP INDEX`, `CREATE INDEX`, `DROP INDEX`, `CREATE INDEX`, no error |
| `\d social_task_claims` | `deleted_at` column present; indexes: `social_task_claims_pkey`, `uq_social_task_claims_address_task_active`, `uq_social_task_claims_task_handle_active` (the two v6 names gone) |
| `\d points_ledger` | unchanged from EP1 (v7 touches only `social_task_claims`) |

## 4. Build and restart (same refresh gap)

| Step | Output |
|---|---|
| `pnpm install --frozen-lockfile` | lockfile up to date, already up to date, 3.7 s (EP2 adds no dependency) |
| `prisma generate` | ok |
| `nest build` | OK |
| `pm2 restart dig-stellar-api --update-env` + `pm2 save` | ok, restart count 13 |

## 5. Verification — API

| Check | Output |
|---|---|
| `GET /health` | `status: ok`, `version: 3ca1d62`, `db: ok`, latency 12 ms |
| `GET /v1/campaign` | `active: false`, `reason: campaign-disabled`; `rules.socialTasks` now objects: `x-follow {points 20, url null, available true}`, `x-repost {10, null, false}`, `community-join {20, null, true}` |
| `GET /v1/campaign/me?address=<mainnet G…>&userId=<uuid>` | `active: false`, `proven: false`, `enrolled: false`, `balance: 0` |
| `crontab -l \| grep -c dig-stellar` | 2 (refresh + alert; the campaign line is NOT installed — EP3) |

## 6. Verification — web (Vercel build of `3ca1d62`, https://stellar.getdig.ai)

| Check | Expected | Output |
|---|---|---|
| Sidebar | no "Earn" entry while dark | YES — no Earn entry |
| `https://stellar.getdig.ai/#earn` | "The Earn & Points campaign is not running right now." card | YES — the "not running" card is shown |
| Dashboard Get-started card | no "+N pts" chip, no points disclaimer line | Not observable in the founder's session state: the connected wallet has positions, so the Get-started card is not displayed. The chip is gated on `active` by code (`pointsForActionIn` returns null while the campaign is inactive) and the dist grep (`DevProofPanel` / `__digProof`: 0) is the evidence |

## 7. State after this deploy, plainly

- **Campaign dark.** `GET /v1/campaign` answers `campaign-disabled`; the social routes are live
  but answer `campaign-disabled` on claim (and `ownership-proof-required` / `not-found` on delete,
  as there is no enrolment yet).
- **v7 applied in production** (`deleted_at` + the two partial unique indexes); `points_ledger`
  untouched.
- **`CAMPAIGN_X_REPOST_URL` unset:** the repost task will show as "coming soon" the day the
  campaign opens unless it is set first.
- **Cron not installed** (EP3). Two `dig-stellar` cron lines on the VPS.
- **Web and API went live from the same push**; the two observable web checks pass, the
  Get-started chip check is covered by code gating + the dist grep (see §6).
