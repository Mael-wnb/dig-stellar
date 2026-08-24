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

Project Node.js version set to **24.x** (via Vercel's account-wide one-click migration
assistant). Note: the "Production Overrides" field on the settings page is read-only —
it reflects the version baked into the deployment currently serving prod — so the
"Node.js Version Override" warning clears with the next production build, which was the
Lot AC merge deploy itself. `apps/web` `engines` pin `24.x` (AC0) is respected.

## Raw terminal outputs

Recovered from the founder's Cowork session transcript (pasted there block by block
during execution); pm2 process tables trimmed to the relevant rows.

### Step 0 — preflight state

```
# node -v && which node && pnpm -v && which pnpm
v20.19.4
/root/.nvm/versions/node/v20.19.4/bin/node
10.32.1
/root/.nvm/versions/node/v20.19.4/bin/pnpm
# pm2 -v
6.0.8
# pm2 ls → dig-stellar-api | fork | pid 655674 | 16h | ↺15 | online   (+ pm2-logrotate 2.7.0 online)
# systemctl is-enabled pm2-root
enabled
Environment=PATH=/root/.nvm/versions/node/v20.19.4/bin:/usr/local/sbin:...
Environment=PM2_HOME=/root/.pm2
ExecStart=/root/.nvm/versions/node/v20.19.4/lib/node_modules/pm2/bin/pm2 resurrect
# crontab -l
*/15 * * * * cd /root/dig-stellar && /usr/bin/flock -n /tmp/dig-stellar-refresh.lock bash -lc 'export PATH=/root/.nvm/versions/node/v20.19.4/bin:$PATH && export EVENTS_LIMIT=50 MAX_EVENT_PAGES=10 LEDGER_LOOKBACK=5000 && pnpm --dir apps/indexer job:refresh' >> /var/log/dig-stellar-refresh.log 2>&1
7,22,37,52 * * * * cd /root/dig-stellar && /usr/bin/flock -n /tmp/dig-stellar-alert.lock bash -lc 'export PATH=/root/.nvm/versions/node/v20.19.4/bin:$PATH && pnpm --dir apps/indexer job:wallet-alert' >> /var/log/dig-stellar-alert.log 2>&1
# curl -s http://127.0.0.1:3000/health | head -c 600
{"status":"ok","version":"3618c03","uptimeSeconds":60231,"db":{"ok":true,"latencyMs":4},
 "staleAfterSeconds":2700,"freshness":[allbridge asOf null (expected-dormant),
 aquarius/blend/defindex/soroswap/stellar-native asOf 2026-08-21T08:52:34Z, ageSeconds 80, isStale false]}
```

### Steps 1–4 — Node 24 + rebuild (no downtime)

```
# nvm install 24 → Now using node v24.19.0 (npm v11.17.0); default -> 24
# N24BIN=/root/.nvm/versions/node/v24.19.0/bin
# npm i -g pnpm@10.32.1 → /root/.nvm/versions/node/v24.19.0/bin/pnpm, 10.32.1
# rm -rf node_modules (root + 4 workspaces); pnpm install --frozen-lockfile
Lockfile is up to date, resolution step is skipped · Packages: +953 · Done in 10.3s
(postinstalls OK: @prisma/engines, @nestjs/core, unrs-resolver, bufferutil, esbuild, @prisma/client)
(one expected WARN: apps/web wanted node "20.x" — repo on main pre-merge; harmless)
# pnpm -C packages/db prisma:generate → Generated Prisma Client (v5.22.0)
# pnpm --dir apps/api build → OK; dist/main.js fresh (Aug 21 09:00)
```

### Step 5 — pm2 switch + reboot simulation (PASS)

```
# which pm2
/root/.nvm/versions/node/v24.19.0/bin/pm2
# pm2 unstartup systemd → Removed /etc/systemd/system/multi-user.target.wants/pm2-root.service
# pm2 kill → All Applications Stopped, PM2 Daemon Stopped
# pm2 startup systemd → unit written; systemctl enable pm2-root OK
# systemctl is-enabled pm2-root
enabled
Environment=PATH=/root/.nvm/versions/node/v24.19.0/bin:...
ExecStart=/root/.nvm/versions/node/v24.19.0/lib/node_modules/pm2/bin/pm2 resurrect
# GIT_SHA=$(git rev-parse --short HEAD) pm2 start dist/main.js --name dig-stellar-api --time; pm2 save
dig-stellar-api online (pid 807782); Successfully saved in /root/.pm2/dump.pm2

# pm2 kill && pm2 resurrect; sleep 3
[PM2] Process /root/dig-stellar/apps/api/dist/main.js restored → online (pid 808450)
# curl -s http://127.0.0.1:3000/health | head -c 600
{"status":"ok","version":"3618c03","uptimeSeconds":3,"db":{"ok":true,"latencyMs":22}, ...}
# pm2 info dig-stellar-api | grep -i 'node.js version'
│ node.js version   │ 24.19.0
```

### Step 6 — crontab migration + post-migration cron cycle

```
# crontab -l | sed "s|/root/.nvm/versions/node/v20.19.4/bin|$N24BIN|g" | crontab -
# crontab -l → both jobs now export PATH=/root/.nvm/versions/node/v24.19.0/bin:$PATH (no v20.19.4 left)

# (after the 09:45 tick) curl -s http://127.0.0.1:3000/health | head -c 600
{"status":"ok","version":"3618c03","uptimeSeconds":2995,"db":{"ok":true,"latencyMs":7},
 "freshness":[allbridge null (expected-dormant); other 5 venues asOf 2026-08-21T09:52:40Z, ageSeconds 146, isStale false]}
# tail -5 /var/log/dig-stellar-refresh.log
All steps succeeded (10 total)
Total job duration: 460.6s
=== Refresh completed successfully ===
=== Global refresh job completed successfully ===
# tail -5 /var/log/dig-stellar-alert.log
=== Wallet alert sweep completed successfully ===
```
