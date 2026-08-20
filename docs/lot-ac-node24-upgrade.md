# Lot AC — Node 24 Runtime Upgrade — Handoff Brief

Repo: `~/Documents/Eon/Dig/dig-stellar` · Scope: runtime/config/docs only — NO app-code
changes. Branch: `feat/node-24` · Evidence: `docs/evidence/lot-ac/`

Claude Code: you may adjust implementation details when the codebase shows a better
path; the Workflow Rules (§1 in `delivery-playbook.md`, standing policy) and the
Invariants below are not overridable. Flag conflicts instead of silently deviating.

## Context

- Node.js 20 reached upstream end-of-life on 2026-04-30 — no security patches since.
  The VPS (public API + indexer) runs `v20.19.4` via nvm.
- Vercel disables Node 20 for NEW deployments on 2026-10-01 (existing ones keep
  running). Vercel only builds the static Vite frontend — no serverless functions —
  so the Vercel side is build-tooling only.
- Target: Node 24 (active LTS, maintained to April 2028). Node 22 would only buy one
  extra year over 20.
- No faucet campaign is live. SCF review is ongoing — prod stability matters; the
  order below is deliberate: prove compatibility locally and in CI before touching
  the VPS, and do Vercel last (lowest risk).

## Invariants

- Zero app-code changes. Allowed files: `package.json` engines fields, lockfile,
  `.github/workflows/ci.yml`, docs, evidence. If ANY dependency requires a code
  change to run on Node 24 — STOP and report; that becomes a founder decision.
- Widgets/validators/flags/campaign logic: untouched (as always).
- The VPS keeps Node 20 installed as instant rollback until AC4 sign-off.

## Sub-lots

### AC0 — Local compatibility proof (no push yet)

- `nvm install 24` locally; fresh `pnpm install` (native deps rebuild — watch
  Prisma engines, puppeteer-core, anything with postinstall).
- Build all three apps; run the full suites (web + api); typecheck.
- Decide and set `engines` in the workspace `package.json`s (floor `>=24` unless a
  dep forces otherwise — flag if one does).
- Output: a short compat note in `docs/evidence/lot-ac/ac0-compat.md` (versions,
  anything that needed a lockfile refresh, anything suspicious).

### AC1 — CI on Node 24

- Bump the Node version in `.github/workflows/ci.yml` to 24 — CI on a clean machine
  is the real compatibility gate.
- Branch `feat/node-24`, §1 gates (build + tests local, CI green on the pushed
  branch). Docs/config-only → no Vercel-preview/phone gate needed; founder go is
  still required before merge.

### AC2 — VPS migration procedure (founder executes, you prepare)

Produce an exact, copy-pasteable runbook in `docs/evidence/lot-ac/ac2-vps-runbook.md`
BEFORE the founder touches the VPS. It must cover, at minimum:

- Enumerate every place the `v20.19.4` nvm path is hardcoded: `runbooks.md`,
  `deployment.md`, `reference-deployment.md`, the VPS crontab (indexer refresh
  jobs), and the pm2 layer.
- The pm2 trap: the pm2 daemon AND the `pm2-root` systemd unit were installed under
  the Node 20 nvm tree. The procedure must reinstall pm2 under Node 24, regenerate
  the startup unit (`pm2 startup` → new unit → `systemctl daemon-reload`), restart
  `dig-stellar-api` under the new runtime, and `pm2 save` — with a verification step
  (`pm2 kill && pm2 resurrect` reboot simulation, then `/health`: correct SHA,
  db ok) exactly like the Lot S validation did.
- Crontab: update any absolute node/pnpm paths for the indexer jobs; verify the next
  cron run completes (freshness timestamps advance).
- Rollback: exact commands to fall back to `v20.19.4` (kept installed) if anything
  misbehaves.

### AC3 — Vercel build setting (founder clicks)

- Project Settings → Build and Deployment → Node.js Version → 24 (clears the
  "Node.js Version Override" warning). Trigger a redeploy; verify build green and
  the site renders. If `engines` was set in AC0, confirm Vercel respects it.

### AC4 — Docs + close-out

- Update every `v20.19.4` reference in `runbooks.md` / `deployment.md` /
  `reference-deployment.md` to the new path.
- Evidence: AC0 compat note, AC2 runbook + the founder's pasted execution output,
  post-migration `/health`, one cron cycle with fresh timestamps.
- Merge per §1 (FF, both remotes), delete the branch.

## Explicitly out of scope

Dependency major-version upgrades (NestJS, Vite, Prisma majors), pnpm major bump,
Docker/containerization, any app-code refactor, the Wallets Kit 2.x upgrade
(separate future lot).

## Definition of done

- CI green on Node 24; local suites green on Node 24.
- VPS API + indexer running on Node 24, pm2 boot-persistent (reboot simulation
  passed), cron cycle verified, `/health` clean.
- Vercel building on Node 24, warning gone.
- No `v20.19.4` reference left in docs; evidence folder complete; rollback path
  documented and still available.
