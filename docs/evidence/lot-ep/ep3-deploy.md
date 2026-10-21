# EP3 — dark deploy to the VPS, then activation (prepared 2026-10-21) — NOT EXECUTED

Scope: the production deploy of Lot EP3 (perks, campaign metrics, status section, v8) — API on
the VPS, web on Vercel — with the campaign STILL DARK, followed by a separate activation section
the founder runs on the chosen day. Same shape as `ep2-deploy.md`. Fill every output cell from
the real command output; nothing is inferred. Env variables are named, never valued.

## Part A — dark deploy (campaign stays `campaign-disabled`)

### 0. Before touching the VPS

- [ ] CI green on `main` after the EP3 merge.
- [ ] `git merge --ff-only` of `feat/lot-ep3` into `main`; pushed to both remotes (the push to
      `public-origin` triggers the Vercel build of the web).

### 1. Window

- [ ] Run between two refresh ticks, locks free (`/tmp/dig-stellar-refresh.lock`,
      `/tmp/dig-stellar-alert.lock`; the campaign lock does not exist yet).

### 2. Code

| Step | Output |
|---|---|
| `git fetch` + `git merge --ff-only origin/main` | `3ca1d62` → `<sha>`, N files, +/− |
| HEAD | `<sha>`, date, title |

### 3. Schema (BEFORE the API build)

| Step | Output |
|---|---|
| `docker exec -i … psql -U dig -d dig_stellar -v ON_ERROR_STOP=1 < apps/api/src/db/stellar_v8_campaign_perks.sql` | expect `CREATE TABLE`, `CREATE INDEX`, no error |
| `\d wallet_perks` | expect 5 columns, PK `wallet_perks_pkey (campaign, address, perk_key)`, `idx_wallet_perks_campaign_key`, 3 CHECKs |
| `select count(*) from wallet_perks` | expect 0 |

### 4. Build and restart (same refresh gap)

| Step | Output |
|---|---|
| `pnpm install --frozen-lockfile` | expect "lockfile up to date, already up to date" (EP3 adds no dependency) |
| `prisma generate` | |
| `nest build` | |
| `pm2 restart dig-stellar-api --update-env` + `pm2 save` | restart count |

### 5. Verification — API (still dark)

| Check | Expected | Output |
|---|---|---|
| `GET /health` | `status: ok`, `version: <sha>`, `db: ok` | |
| `GET /v1/campaign` | `active: false`, `reason: campaign-disabled`; `rules.perks` = the three tiers | |
| `GET /v1/campaign/metrics` | `active: false`, `dark: true`, every count 0, `boundary` present; header `Cache-Control: public, max-age=60` | |
| `GET /v1/campaign/me?address=<mainnet G…>&userId=<uuid>` | `perks: []`, `nextPerk: {early-access, 100, 100}`, `flags: {beta: false}` | |
| `crontab -l \| grep -c dig-stellar` | 2 (the campaign line is installed in Part B) | |

### 6. Verification — web (Vercel build of `<sha>`, https://stellar.getdig.ai)

| Check | Expected | Output |
|---|---|---|
| Sidebar | no "Earn" entry while dark | |
| `#status` bottom | NO "Campaign metrics" section while dark; the pipeline rows and the footer unchanged | |
| `#earn` | the "not running" card | |

### 7. State after Part A, plainly

- Campaign dark; v8 applied; `/v1/campaign/metrics` live but zeroed; no perk can exist yet.
- Cron line not installed (Part B).

## Part B — activation (founder, on the chosen day; runbook "Activate the campaign")

The three env names, never valued here: `CAMPAIGN_STARTS_AT`, `CAMPAIGN_ENABLED`,
`CAMPAIGN_X_REPOST_URL` (`apps/api/.env`). `CAMPAIGN_ENDS_AT` stays unset unless a deadline is
decided.

### B0. Pre-activation checklist (all BEFORE the flag flip)

| Item | Output |
|---|---|
| `CAMPAIGN_STARTS_AT` chosen as a UTC instant (ISO with `Z`) | the instant: |
| Paul's X post published; its https URL at hand for `CAMPAIGN_X_REPOST_URL` | yes / no |
| `\d wallet_perks` (v8 applied in Part A) | |
| Cron line installed (`crontab -e`, exact line from the runbook) → `crontab -l \| grep -c dig-stellar` | expect 3 |
| First manual run while dark: `cd /root/dig-stellar && pnpm --dir apps/indexer job:campaign` | expect `[campaign-award] campaign dark, nothing to award (campaign=1)` and exit 0 |
| `tail -n 5 /var/log/dig-stellar-campaign.log` after the next tick | expect the same dark lines written by cron |
| `GET /v1/campaign` baseline | `active: false`, `reason: campaign-disabled` |

### B1. The flip

| Step | Output |
|---|---|
| `apps/api/.env`: set `CAMPAIGN_STARTS_AT`, `CAMPAIGN_ENABLED=true`, `CAMPAIGN_X_REPOST_URL` | names set (values not pasted) |
| `pm2 restart dig-stellar-api --update-env && pm2 save` | restart count |

### B2. Verification

| Check | Expected | Output |
|---|---|---|
| `GET /v1/campaign` | `active: true`, `startsAt` = the instant, `rules.socialTasks["x-repost"].available: true` with the URL | |
| `GET /v1/campaign/metrics` | `active: true`, `dark: false`, `window.startsAt` = the instant, counts 0 on day one | |
| Second manual run: `pnpm --dir apps/indexer job:campaign` | `window …`, `actions candidates=0 awarded=0 …`, `referrals …`, `perks wallets=0 granted=0`, `summary … perks_granted=0` | |
| Web, fresh tab on https://stellar.getdig.ai (NO redeploy: the web polls `GET /v1/campaign` every 60 s) | sidebar shows "Earn"; `#earn` shows the enrol card; `#status` shows the "Campaign metrics" section with zeros | |
| Next cron tick, `tail -n 6 /var/log/dig-stellar-campaign.log` | the live summary lines | |

### B3. State after activation, plainly

- Campaign running from the instant; every surface visible on every open tab at its next poll.
- Perks are granted by the cron tick, at most 15 min after a wallet reaches a tier.
- To pause: `CAMPAIGN_ENABLED=false` + `pm2 restart --update-env`; ledger and perks untouched.
