# EP1 — dark deploy to the VPS (2026-10-21)

Scope: the first production deploy of Lot EP (EP1) — API on the VPS, web on Vercel — with the
campaign dark (`CAMPAIGN_ENABLED` unset) and the cron line not installed. Sequence as in
`docs/deployment.md` (Lot ST order) with the v6 schema applied before the API build. Every
number below is from the founder's command outputs of 2026-10-21; nothing is inferred.
Env variables are named, never valued.

## 1. Window

Run between two refresh ticks after checking the cron locks were free
(`/tmp/dig-stellar-refresh.lock`, `/tmp/dig-stellar-alert.lock`).

## 2. Code

- `git fetch` + `git merge --ff-only origin/main`: `6ee8721` → `e266481`, 50 files,
  +8752 −118.
- HEAD `e266481`, 2026-10-21 12:52:54 +0200,
  "docs(runbooks): campaign retroactive awards and supported proof wallets".

## 3. Schema (before the API build)

- `stellar_v6_campaign.sql` applied through `docker exec … psql` with `ON_ERROR_STOP=1`:
  7 `CREATE TABLE` + 15 `CREATE INDEX`, no error.
- Count of the seven campaign tables (`wallet_auth_challenges`, `wallet_ownership_proofs`,
  `campaign_enrollments`, `social_task_claims`, `points_ledger`, `wallet_daily_checkins`,
  `referrals`): **7**.

## 4. Build and restart

| Step | Output |
|---|---|
| `pnpm install --frozen-lockfile` | lockfile up to date; +275 −7 packages; 25 s. The additions are Kit 1.9.5's transitive dependencies, including native builds (`secp256k1`, `blake-hash`, `tiny-secp256k1`, `utf-8-validate`, `usb`) |
| `prisma generate` | ok |
| `nest build` | OK |
| `pm2 restart dig-stellar-api --update-env` + `pm2 save` | online, restart count 12 |

## 5. Verification

| Check | Output |
|---|---|
| `GET /health` | `status: ok`, `version: e266481`, `db: ok`, latency 10 ms |
| `GET /v1/campaign` | `active: false`, `reason: campaign-disabled`, `startsAt: null`, `rules` block present (`CAMPAIGN_ENABLED` unset in `.env`) |
| `POST /v1/auth/challenge` (mainnet address) | `nonce`, `message` and `expiresAt` returned |
| `crontab -l \| grep -c dig-stellar` | 2 (refresh + alert; the campaign line is NOT installed — EP3) |
| Web (Vercel, same push) | deployed; the picker shows the seven wallets; no DEV panel |

## 6. Mainnet smoke (Freighter, Kit 1.9.5 `signTransaction`)

| Action | Tx hash | Ledger | Closed (UTC) | Result |
|---|---|---|---|---|
| SDEX swap | `1bec824f1263454d965cf3b6dd5cd6640124231f27220ac0fcd90e651528e30a` | 65058921 | 2026-10-21 10:59:48 | successful |
| Blend deposit | `7759966b0e1e2bcf7d79999f412ac560757c420133b6af0729264985aebf1295` | 65058940 | 2026-10-21 11:01:23 | successful (Soroban; fee charged 0.0469812 XLM) |

Both signed through the normal action path, i.e. the Kit's `signTransaction` after the
1.0.0 → 1.9.5 bump and the removal of the `setNetwork` watcher (explicit `networkPassphrase`
on every signing call).

`action_witnesses` check (mainnet, last hour, read-only; columns `kind`, `network`,
`meets_min_notional`, `ledger_closed_at`):

```
sdex-swap|mainnet|t|2026-10-21 10:59:48+00
blend-deposit|mainnet|t|2026-10-21 11:01:23+00
```

Both witnesses are present, both `meets_min_notional = t`, and the close times match the
ledgers above.

## 7. State after this deploy, plainly

- **Campaign dark.** `GET /v1/campaign` answers `campaign-disabled`; no enrolment is possible
  yet, so no points can be earned and the award job has nothing to do.
- **Proofs are live.** `/v1/auth/challenge` + `/v1/auth/verify` are an always-on primitive
  (not gated by `CAMPAIGN_ENABLED`), and the no-session account-recovery path now requires
  one (`5554108`).
- **Cron not installed.** Two `dig-stellar` cron lines on the VPS (refresh, alert); the campaign
  line waits for EP3.
- **VPS has pending OS updates and a required reboot.** Out of scope here; tracked in the
  backlog.
- **Web and API went live from the same push** (Vercel builds on the push to `public-origin`);
  the API restart followed within the same refresh gap.
