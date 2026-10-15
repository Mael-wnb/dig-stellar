# AD0 — Read-only recon of the deploy surface (2026-09-28)

Scope: verify the topology, CI state, cron/lock lines, how `GIT_SHA` reaches the process,
and `docs/deployment.md` vs reality — before designing the AD1 fail-closed deploy script.
Everything below traces to a file in the repo at `0d0a868` (main), a local command, or a
public GitHub API call. Nothing was run on the VPS; the VPS commands to confirm are listed at
the end (read-only, outputs to be pasted into `ad0-vps-preflight.md`).

Branch: `lot-ad` created from `main` = `origin/main` = `public-origin/main` = `0d0a868`
(`git fetch` both remotes, then `git switch -c lot-ad`). Working tree clean except the
untracked `agent-world.json` (left alone).

## 1. The three incidents and what each one needs from the design

| Incident | What actually happened (source) | Step that must make it impossible or loud |
|---|---|---|
| 2026-08-17 — SQL skipped | An aborted `git pull` skipped `stellar_v1_ops_metrics.sql`; `action_events.metadata` missing in prod; every build-event insert failed silently (`docs/evidence/lot-r/incident-2026-08-17-prod.md`) | The script applies **one** committed, ordered, complete SQL list (AD1: all idempotent files; AD2: versioned runner with a tracking table). `psql -v ON_ERROR_STOP=1` + `set -e` abort **before** build/restart. Skipping is not an option the operator has. |
| 2026-09-28 — pulled, not rebuilt | VPS at `18072ca` in git, pm2 still serving the old `dist/`; `/health.version` still `a5bedbf` because pm2 was not restarted (`docs/evidence/hotfix-lending-supplied-side/README.md` §Deploy incident) | The build writes `dist/build-info.json` (SHA of the built tree); the API reads it at boot; the gate compares it to the target SHA. A restart without build now reports the **old** SHA and fails the gate loudly. The script always builds, so the case cannot occur on the scripted path. |
| Early Sept — stuck on `3618c03` for ~3 weeks | A locally rewritten root `package.json` (`packageManager` field) blocked `git pull` (`docs/lot-ad-cicd-deploy.md` §Context; `/health.version: 3618c03` on 2026-09-03 in `docs/evidence/status-page/00-recon-2026-09-03.md:15`) | Clean-tree check fails loudly with the diff (never stash/discard). Root cause fix so it cannot recur: commit `packageManager` at the root (§6). Drift becomes visible on every deploy attempt instead of silently blocking a bare `pull`. |

## 2. Topology — verified vs the brief

| Item | Verified | Source |
|---|---|---|
| Local remotes | `origin` = Digbot-ai/dig-stellar with two push URLs (Digbot-ai + Mael-wnb); `public-origin` = Mael-wnb/dig-stellar | `git remote -v` |
| Mael-wnb visibility | **public** repo, default branch `main` | `GET https://api.github.com/repos/Mael-wnb/dig-stellar` → 200, `visibility: public` |
| Digbot-ai visibility | **private** (404 unauthenticated) | `GET https://api.github.com/repos/Digbot-ai/dig-stellar` → 404 |
| VPS remote naming | VPS clone's only remote is `origin` = Mael-wnb | `docs/deployment.md` §Lot ST deploy sequence (b) |
| Health `version` | `process.env.GIT_SHA?.trim() \|\| 'unknown'` — env only, nothing read from `dist/` | `apps/api/src/app.controller.ts:29` |
| How `GIT_SHA` reaches the process | `GIT_SHA=$(git rev-parse --short HEAD) pm2 restart dig-stellar-api --update-env`, i.e. from the **checkout**, at restart time | `docs/deployment.md` (pm2 block + Lot ST block) |
| Health semantics | `status` = `ok` \| `degraded` (degraded when any venue stale); HTTP 200 always; 503 only when the DB query throws; payload carries `db.ok`, `db.latencyMs`, `version` | `app.controller.ts:27-82` |
| API build | `nest build` with `deleteOutDir: true` → `dist/` is wiped on every build; `dist/main.js` is what pm2 runs | `apps/api/nest-cli.json`, `docs/deployment.md` |
| Cron lines (real, from the AC2 capture) | `*/15 … flock -n /tmp/dig-stellar-refresh.lock … job:refresh` and `7,22,37,52 … flock -n /tmp/dig-stellar-alert.lock … job:wallet-alert`; both `cd /root/dig-stellar`, export the Node 24 bin, log to `/var/log/dig-stellar-{refresh,alert}.log` | `docs/evidence/lot-ac/ac2-execution.md:52-53` (Node 20 paths, migrated to v24.19.0 in step 6) |
| Refresh duration | 460.6 s (10/10 steps) under Node 24 on the VPS; 668 s locally | `ac2-execution.md:108`, `ac0-compat.md:28` |
| Indexer runtime | `tsx` from the working tree (no build); the API's wallet on-demand refresh also spawns `pnpm tsx` in `apps/indexer` (working tree), **outside any flock** | `apps/indexer/package.json`, `apps/api/src/modules/wallets/wallets.service.ts:476-484` |
| Node / pnpm on the VPS | Node v24.19.0 (nvm), pnpm 10.32.1 installed with `npm i -g pnpm@10.32.1` under the v24 tree (not Corepack, per the runbook) | `ac2-vps-runbook.md:56`, `ac2-execution.md` |
| pm2 | `dig-stellar-api`, `dist/main.js`, cwd `apps/api` (dotenv), `pm2-root` systemd unit + dump | `docs/deployment.md` §pm2, `docs/evidence/lot-s/s-supervision-pm2.md` |
| Local dev machine (for AD1 validation runs) | Node **v20.20.1** / pnpm **9.14.4** active; v24.19.0 installed in nvm, default alias → 20 | `node -v`, `pnpm -v`, `nvm ls` |

## 3. SQL schema files — three lists, three different contents

11 schema files exist in `apps/api/src/db/` (plus `seed_blend_v1.sql`, a legacy seed with
`on conflict do nothing` inserts — not referenced by any doc or the compose file):

| File | `docs/deployment.md` (7) | `docs/runbooks.md` (10) | `docker-compose.yml` init mounts (10) |
|---|---|---|---|
| stellar_v1.sql | yes | yes | 10 |
| stellar_v1_metrics.sql | yes | yes | 11 |
| stellar_v1_logos.sql | **no** | **no** | 12 |
| stellar_v1_network_tvl.sql | yes | yes | 13 |
| stellar_v1_ops_metrics.sql | yes | yes | 14 |
| stellar_v1_bridge.sql | yes | yes | 15 |
| stellar_v1_action_witness.sql | **no** | yes | 16 |
| stellar_v2_multiwallet.sql | yes | yes | 20 |
| stellar_v3_alerting.sql | yes | yes | 30 |
| stellar_v4_faucet.sql | **no** | yes | 40 |
| stellar_v5_faucet_campaign2.sql | **no** | yes | **no** |

The list an operator follows depends on which doc they open. This is the 2026-08-17 failure
class in document form. AD1 fixes it by making the script's list the single source; AD2
replaces the list with versioned migrations.

Idempotency check (grep for `create`/`alter`/`drop`/`insert`/`update` not guarded by
`if not exists`, then read each hit in context): all 11 files are re-runnable.
- `stellar_v3_alerting.sql:105-107`: `drop constraint if exists` + `add constraint` — idempotent as a pair.
- `stellar_v5_faucet_campaign2.sql:39-47`: a **data** migration (`update … where action_family = 'any'`), guarded so re-runs are no-ops; `alter column … drop default` is idempotent; `drop index if exists`. Note for AD2: migrations already mix DDL and DML.
- Everything else is `create … if not exists` / `add column if not exists`.

Dependency order (the compose numbering is the only explicit contract): v1 base → v1
satellites → v2 → v3 (needs v1 `entities` + v2 `user_wallets`) → v4 (needs
`action_witnesses`) → v5 (alters `faucet_claims`).

## 4. CI — what runs, what does not

`.github/workflows/ci.yml` (Lot E): `on: push` to `main`, `alpha`, `feat/**`, `fix/**` + every
`pull_request`. Steps: pnpm 10 / Node 24, `pnpm install --frozen-lockfile`, `prisma:generate`,
api `build` + `test`, web `build` (vue-tsc) + `test` (vitest).

- **Green**: last 8 runs on Mael-wnb are all `success`; latest = `main @ 0d0a868`,
  2026-09-28T16:26:07Z (public API `GET …/actions/runs`). Digbot-ai runs are not visible
  without a token.
- **Not covered**: `apps/indexer` has no build, no typecheck, no tests (`"test": "echo … exit 1"`).
  `tsc --noEmit` there has known debt: third-party `.d.ts` (stellar-sdk / urijs) + 2 `TS2352`
  casts in `src/scripts/discovery/qa-reconcile.ts` (`ac0-compat.md:27`). Its `tsconfig.json`
  has no `skipLibCheck`, no `include`, no `noEmit`.
- **Trigger gap**: `lot-ad` and `lot-lm` do **not** match `feat/**` / `fix/**` → CI does not run
  on either branch today (no `lot-lm` run appears in the runs list). The §1 playbook rule 1
  says `feat/*`, the current lots are named `lot-*`. AD1 adds `'lot-*'` to the push triggers;
  the first push of `lot-ad` carrying the modified workflow triggers on itself.
- No dependabot / other workflows (`find .github -type f` → `ci.yml` only).

## 5. Branch protection — not verifiable from here

No `gh` CLI on this machine and Digbot-ai is private; protection rules need an authenticated
read on both repos. Commands for Maël below (§9). Working assumption until then: none
(the committed brief says "likely none").

## 6. The `packageManager` rewrite (early-Sept incident) — root cause candidates

Facts:
- Root `package.json` has **no** `packageManager` field; `apps/indexer/package.json` has
  `"packageManager": "pnpm@10.32.1"`. pnpm only honours the field in the **workspace root**
  (`pnpm-workspace.yaml` is at the root), so the indexer pin is inert for the workspace.
- CI pins pnpm major `10` (`pnpm/action-setup@v4`, `version: 10`) and Node 24; both Dockerfiles
  pin `pnpm@10.32.1` but on `node:20-bookworm-slim` (pre-Lot-AC, stale).
- No `.npmrc` anywhere in the repo (`cat .npmrc apps/*/.npmrc` → none).
- The VPS pnpm was installed with `npm i -g pnpm@10.32.1` (AC2 step 2), so a `pnpm` on PATH
  is *expected* to be the npm-installed binary, not a Corepack shim.

Two known mechanisms write `packageManager` into a package.json that lacks it:
1. **Corepack auto-pin** (`COREPACK_ENABLE_AUTO_PIN`, default on in recent Corepack): if
   `corepack enable` was ever run in the Node 24 tree, its `pnpm` shim can shadow or be
   shadowed by the npm-installed binary depending on install order, and the first
   `pnpm install` writes the field.
2. **pnpm's own version management** (`manage-package-manager-versions`, default on in
   pnpm 10) — it *reads* the field; the write path is `pnpm self-update`, not `install`.

Which one hit the VPS is decided by the read-only commands in §9 (which `pnpm` is on PATH,
is it a Corepack shim, is `COREPACK_ENABLE_AUTO_PIN` set). The fix does not depend on the
answer: commit `"packageManager": "pnpm@10.32.1"` at the **root** (matches the VPS binary, the
Dockerfiles and CI major; then neither Corepack nor pnpm has anything to write), keep
`.nvmrc` = `24` and `engines >= 24` (already there). If the VPS pnpm turns out to differ from
10.32.1, align the VPS binary rather than the pin (one `npm i -g pnpm@10.32.1`).

## 7. `docs/deployment.md` vs reality

- Two deploy blocks disagree: the canonical pm2 block does `git pull` → `pnpm --dir apps/api
  build` → restart (no `pnpm install`); the Lot ST block adds `pnpm install` (not
  `--frozen-lockfile`). Neither applies SQL; SQL is a separate section listing 7 of 11 files.
- Both use a bare `git pull` (the exact primitive that produced the Sept drift and the Aug
  aborted pull).
- `pm2 save` is in both; `--update-env` in both. Fine.
- `docs/reference-deployment.md` + compose: the Lot Z path bootstraps SQL via init mounts on
  an **empty** volume only, and lists 10 of 11 files (no v5). The indexer loop container runs
  `job:refresh` only — **`job:wallet-alert` has no container equivalent** (relevant to the AD3
  option (a) comparison, not to AD1/AD2).
- `docs/lot-ad-cicd-deploy.md` (committed 2026-09-05) describes an earlier cut of this lot:
  branch `feat/ad-cicd`, AD2 = CI hardening, AD3 = branch protection (explicitly "do NOT require
  PRs"), AD4 = proof. Today's brief supersedes it (branch `lot-ad`, AD2 = versioned migrations,
  AD3 = runtime gate, PR question open). The committed brief is updated at the AD1 commit point
  so the repo does not carry two plans.

## 8. `lot-lm` inventory (read-only)

`origin/lot-lm` = `public-origin/lot-lm` = `17ac4dc`: **1 commit ahead** of main (docs only:
`docs/evidence/lot-lm/l0-recon.md`, 947 lines), **2 behind** (`18072ca`, `0d0a868`).
`git diff --name-status origin/main...origin/lot-lm -- '*.sql'` → **no SQL files**. The
rebase before AD2 is trivial and there is nothing to fold into the AD2 baseline yet; any
lending schema on `lot-lm` will be its first versioned migration.

## 9. VPS preflight — read-only commands for Maël (paste outputs into `ad0-vps-preflight.md`)

Nothing here writes. `pm2 env` prints **names only** (values are cut).

```bash
export PATH=/root/.nvm/versions/node/v24.19.0/bin:$PATH   # same tree the cron uses

# A. Versions and WHO is `pnpm` (Corepack shim vs npm-installed binary)
node -v; which node; pnpm -v; which pnpm; readlink -f "$(which pnpm)"; head -c 200 "$(which pnpm)"; echo
corepack --version 2>&1; env | grep -i corepack; ls -la ~/.cache/node/corepack 2>&1 | head -3
cat ~/.npmrc 2>/dev/null; cat /root/dig-stellar/.npmrc 2>/dev/null; echo "(npmrc end)"

# B. Git state of the deploy clone
cd /root/dig-stellar && git status --short && git log -1 --format='%h %ci %s' && git remote -v
git diff --stat; grep -n packageManager package.json apps/indexer/package.json

# C. Cron + locks (as they are, not as documented)
crontab -l; ls -la /tmp/dig-stellar-*.lock 2>&1

# D. pm2 process: script, cwd, runtime, env KEY NAMES only
pm2 describe dig-stellar-api | grep -E 'script path|exec cwd|node.js version|restarts|uptime|status'
pm2 env "$(pm2 id dig-stellar-api | tr -d '[] ')" | cut -d= -f1 | sort | tr '\n' ' '; echo

# E. Health as served right now
curl -s http://127.0.0.1:3000/health | head -c 400; echo

# F. Memory / disk baseline (cheap now, needed for the AD3 comparison)
free -m; df -h / | tail -1; docker stats --no-stream --format '{{.Name}} {{.MemUsage}}'
```

GitHub (read-only), either in the UI or with `gh` if installed anywhere:
```bash
# Settings → Branches (classic) and Settings → Rules → Rulesets, for BOTH repos:
#   https://github.com/Digbot-ai/dig-stellar/settings/branches
#   https://github.com/Mael-wnb/dig-stellar/settings/branches
# or, with gh authenticated:
gh api repos/Digbot-ai/dig-stellar/branches/main/protection 2>&1 | head -c 300; echo
gh api repos/Mael-wnb/dig-stellar/branches/main/protection 2>&1 | head -c 300; echo
gh api repos/Digbot-ai/dig-stellar/rulesets; gh api repos/Mael-wnb/dig-stellar/rulesets
gh run list -R Digbot-ai/dig-stellar --workflow ci.yml -L 5
```

## 10. Findings that shape AD1 (summary)

1. `version` must come from the build output, not the env (`app.controller.ts:29` + `deleteOutDir: true` → write `dist/build-info.json` in a post-build step, read at boot, env `GIT_SHA` as fallback only).
2. One ordered SQL list, complete (11 files), applied with `ON_ERROR_STOP` before build/restart.
3. Deploy holds both cron locks (`/tmp/dig-stellar-refresh.lock`, `/tmp/dig-stellar-alert.lock`) with a blocking `flock -w` (a refresh can take ~8 min); cron uses `-n` so ticks during the deploy are skipped, not queued. Residual: the API-spawned wallet refresh is unlocked; ordering migrate immediately after the ff-merge shrinks that window to seconds, and the API is restarted last.
4. Root `packageManager` pin + `pnpm install --frozen-lockfile` in the script (never in today's canonical block).
5. CI: add `lot-*` triggers; add an indexer typecheck step (green and meaningful, the 2 casts fixed type-level only, third-party `.d.ts` handled explicitly).
6. Mael-wnb is public → the "CI green on the target SHA" check can use the unauthenticated GitHub API (`/repos/Mael-wnb/dig-stellar/commits/<sha>/check-runs`, 60 req/h) — **no token on the VPS** for the read side.
7. Gate = `build-info` SHA == target (full 40-char, compared full; short shown in logs) AND `db.ok == true`, retried for a bounded time; `status: degraded` never blocks.
