# Lot S follow-up — API supervision (pm2) + the "nohup" correction

Date: 2026-08-17 (~08:45–08:55 UTC).

## Correction: pm2 was NEVER lost — the runbook's pm2 restarts were real

The S1/S2 report claimed the API ran as an "unsupervised nohup process". That was a
misdiagnosis, corrected here for the record:

- The pm2 daemon has run continuously since **Jun 19** — it was started manually from
  an SSH session, so the daemon and all its children live in an *abandoned systemd
  session scope* (`session-5375.scope`). That scope is what I misread as "nohup-style,
  unsupervised". `pm2 ls` was the check that would have settled it, and it wasn't run
  until this follow-up.
- The API was pm2-managed the whole week (`dig-stellar-api`, defined as
  `bash -c "pnpm --dir apps/api start:prod"`). **Runbook pm2 restarts were never
  silently no-oping.** Direct proof from earlier today: during the S1 deploy I
  `kill`ed the API process chain and started my own detached copy — pm2 auto-respawned
  its process, which won the `:3000` port race, and *my* copy is the one that died
  (its log file stayed empty; `pm2 ls` afterwards showed the serving pid belonged to
  pm2, restart counter ↺ 35). The supervision worked; I fought it without realizing.

## The two real gaps (now closed)

1. **No boot persistence** — no `pm2-root` systemd unit existed, so a DO reboot would
   have left the API (and the pm2 daemon itself) down until manual intervention. This
   was the founder's demo-week risk, and it was real.
2. **Stale dump** — `/root/.pm2/dump.pm2` dated **Jun 19**; `pm2 resurrect` would have
   restored a two-month-old definition (same single app, but pre-everything env).

## What was done

```
pm2 delete dig-stellar-api                       # old bash -c "pnpm start:prod" wrapper
cd /root/dig-stellar/apps/api                    # cwd so dotenv finds .env
GIT_SHA=8737439 pm2 start dist/main.js --name dig-stellar-api --time
pm2 save                                         # fresh dump
pm2 startup systemd                              # installed + enabled pm2-root unit
```

## Verification (all passed)

- `systemctl is-enabled pm2-root` → **enabled**; unit file present.
- `pm2 restart dig-stellar-api --update-env` → `/health` ok (version 8737439, db ok).
- **Reboot simulation**: `pm2 kill` → API down (expected) → `pm2 resurrect` →
  `dig-stellar-api` **and** `pm2-logrotate` back online, `/health` ok, bind still
  `127.0.0.1:3000`, external `https://stellar-api.getdig.ai/v1/pools` → 200.
- No stray non-pm2 API processes (`ps` sweep clean).

`deployment.md` §"API process" rewritten from the (wrong) nohup procedure to the pm2
one, including the always-`pm2 save` rule and an explicit "do not nohup" warning.
