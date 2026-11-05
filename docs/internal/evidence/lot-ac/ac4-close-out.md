# AC4 — Lot AC close-out

Date: 2026-08-21 · Branch `feat/node-24` merged FF into `main` per §1.

## Definition of done — status

| Item | Status |
|---|---|
| CI green on Node 24 | ✅ ci.yml on `node-version: 24`, green on every branch head (public-repo run 32396206613 + follow-ups) |
| Local suites green on Node 24 | ✅ api 129 jest + web 111 vitest + builds + full `job:refresh` 10/10 (`ac0-compat.md`) |
| VPS API + indexer on Node 24, pm2 boot-persistent, cron verified, `/health` clean | ✅ founder-executed 2026-08-21: reboot simulation PASS, node 24.19.0 in pm2, 09:45 cron cycle 10/10 in 460.6s, freshness advancing (`ac2-execution.md`) |
| Vercel building on Node 24, warning gone | ✅ AC3 done 2026-08-21, prod redeploy green |
| No `v20.19.4` reference left in docs | ✅ `runbooks.md` / `deployment.md` / `reference-deployment.md` updated; crontab example reconciled to the real `/root/dig-stellar` path (the old `/srv/dig-stellar` never matched the VPS). Historical mentions remain only in the Lot AC brief + this evidence folder, by design |
| Evidence folder complete | ⚠️ `ac0-compat.md`, `ac2-vps-runbook.md`, `ac2-execution.md` filed — but the **raw terminal outputs are still pending paste** (see `ac2-execution.md`); the founder's reported summary stands as validation |
| Rollback documented and available | ✅ runbook rollback section; Node `v20.19.4` still installed on the VPS. **Post-sign-off cleanup (founder, optional): `nvm uninstall 20` on the VPS and delete `/root/crontab-node20.bak` once confident** |

## Invariants held

- Zero app-code changes across the lot (engines fields, lockfile untouched, ci.yml, docs,
  evidence only).
- Widgets/validators/flags/campaign logic untouched; no faucet campaign was live.
