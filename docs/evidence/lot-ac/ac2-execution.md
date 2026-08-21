# AC2 — VPS migration execution record

Executed by the founder on 2026-08-21 per `ac2-vps-runbook.md`; results reported in chat
and validated as GO for merge. Vercel (AC3) done the same day.

## Reported results (founder summary, 2026-08-21)

- **Reboot simulation (runbook step 5e): PASS** — `pm2 kill && pm2 resurrect`, then
  `/health`: `version` `3618c03` (the SHA deployed on the VPS at migration time),
  `db.ok: true`; `pm2 info dig-stellar-api` reports Node.js version **24.19.0**.
- **pm2 boot layer**: `pm2-root` systemd unit regenerated from the Node 24 pm2; all
  paths in the unit point at the v24.19.0 tree; `systemctl is-enabled pm2-root` → enabled.
- **Crontab migrated**: both indexer jobs (`job:refresh`, `job:wallet-alert`) now export
  `/root/.nvm/versions/node/v24.19.0/bin`; pre-migration copy kept at
  `/root/crontab-node20.bak`.
- **Post-migration cron cycle verified**: the 09:45 UTC refresh completed **10/10 steps
  in 460.6s under Node 24**; freshness `asOf 2026-08-21T09:52:40Z` (advancing);
  wallet-alert sweep clean.
- **Rollback preserved**: Node `v20.19.4` kept installed on the VPS until AC4 sign-off,
  per the invariant.

## AC3 (Vercel)

Project Node.js version set to **24**; production redeploy green; the "Node.js Version
Override" warning is cleared. `apps/web` `engines` pin `24.x` (AC0) is respected.

## Raw terminal outputs

> **PENDING PASTE** — the founder's chat message contained the placeholder
> `[colle ici bloc 0, bloc 4, et le check final]` but the raw blocks (step 0 preflight,
> step 4/5 build + pm2 verification, final check) did not come through. Paste them below
> when available; the summary above is the founder's reported validation.

```
(step 0 — preflight state)

(step 5e — reboot simulation + /health)

(step 6 — post-migration cron cycle check)
```
