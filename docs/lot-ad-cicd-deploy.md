# Lot AD — CI/CD & Deploy Discipline — Handoff Brief

Repo: `~/Documents/Eon/Dig/dig-stellar` · Scope: deploy tooling, CI workflow, GitHub
settings, docs, evidence. Branch: `feat/ad-cicd` · Evidence: `docs/evidence/lot-ad/`

Claude Code: implementation details are yours when the codebase shows a better path;
the §1 Workflow Rules (`delivery-playbook.md`, standing policy) and the Invariants
below are not overridable. Flag conflicts instead of silently deviating.

## Context

- Status-board weakest area #2: "CI/CD: VPS deploy is still manual — the 2026-08-17
  incident (aborted pull skipping a SQL file) is exactly the failure mode this
  invites."
- SCF 45 feedback: the SCF 46 resubmission (Nov 8) requires full Tranche 4
  validation first. This quiet window is for hardening within SCF 43 scope —
  operational maturity is a first-class T3-D3 theme, and this lot is its most
  legible piece for a reviewer.
- Update 2026-09-05: the "requires full Tranche 4 validation first" condition above is
  **satisfied** — SCF 43 is complete (all four tranches validated and paid; see
  `docs/status-board.md` Global status).
- Observed during the Lot ST prod deploy (2026-09-05): the VPS had drifted to `3618c03`
  (Lot AB) for ~3 weeks, and a locally modified root `package.json` (a `packageManager`
  field written by pnpm/corepack) blocked `git pull`. Two requirements for this lot: the
  deploy script must detect a dirty tree and STOP (never stash/discard silently), and the
  `packageManager` field should be either committed or disabled via `.npmrc` so it cannot
  dirty the tree again.
- Post-Lot-AC facts to reuse: VPS runs Node 24 under pm2 (`pm2-root` regenerated),
  crontab jobs export the v24 tree, deploy procedure currently = the manual block in
  `deployment.md`. Indexer has known pre-existing `tsc --noEmit` debt (third-party
  `.d.ts` in stellar-sdk/urijs + 2 old casts in `qa-reconcile.ts`) documented in
  `docs/evidence/lot-ac/ac0-compat.md`.

## Invariants

- **Zero runtime app-code changes.** Allowed: deploy script(s), `.github/`,
  type-level-only fixes needed for the indexer typecheck gate (the 2 casts in
  `qa-reconcile.ts` + tsconfig handling of third-party `.d.ts` — behavior-neutral,
  and if any fix would change emitted behavior, STOP and flag), docs, evidence.
- Widgets/validators/flags/campaign logic: untouched.
- The deploy script must be **fail-closed**: any step failing aborts with a non-zero
  exit and a clear message — never a partially-applied deploy (the incident class).
- §1 gates apply; the founder executes anything that runs on the VPS or in GitHub
  settings (you prepare exact steps/commands).

## Sub-lots

### AD0 — Recon (read-only)

- Inventory the real deploy surface: every step in `deployment.md` +
  `reference-deployment.md` + the AC2 evidence (SQL files and their required order,
  build, pm2 restart, health assert), and what the 2026-08-17 incident actually
  skipped. Confirm the SQL DDL list is complete and idempotent.
- Current CI: what `ci.yml` covers and does not (indexer has no build/typecheck).
- GitHub: current branch-protection state on both remotes (likely none).
- Output: `docs/evidence/lot-ad/ad0-recon.md` with the deploy-step inventory.

### AD1 — Idempotent VPS deploy script

- `scripts/deploy-api.sh` in the repo, executed ON the VPS. Shape:
  - `set -euo pipefail`; explicit PATH export for the Node 24 tree (derive from
    nvm, do not hardcode the minor);
  - fetch + `git merge --ff-only origin/main` (never a bare `pull` that can leave
    a partial state); abort if the working tree is dirty;
  - apply ALL schema SQL files in the documented order (idempotent DDL — applying
    is always safe; skipping is what bit us);
  - `pnpm install --frozen-lockfile` (cheap when nothing changed) +
    `prisma:generate` + api build;
  - pm2 restart with `GIT_SHA` env + `pm2 save`;
  - health assert loop: `/health` must return the freshly deployed SHA and
    `db.ok: true` within a timeout, else exit non-zero with the diff;
  - a `--dry-run` flag that prints the plan without executing.
- Update `deployment.md` (and the runbooks pointer) so the script IS the procedure;
  keep the manual block as an appendix labeled "what the script does".
- Optional if trivial: a sibling `scripts/deploy-indexer-check.sh` step or fold the
  indexer (it deploys with the same pull; its build is `tsx`-based) — your call,
  flag the choice.

### AD2 — CI hardening

- Add indexer typecheck to CI: fix the 2 legacy casts in `qa-reconcile.ts`
  (type-level only), deal with third-party `.d.ts` debt explicitly (e.g.
  `skipLibCheck` with a comment naming why, or targeted excludes) — the gate must be
  green and meaningful, not silenced wholesale without a note.
- Add a dependency-audit step (`pnpm audit --prod` or equivalent): **non-blocking
  report** by default (surfaces in the CI log/summary), so it informs without
  freezing the pipeline on upstream noise. Flag if you think blocking-on-critical
  is warranted.
- Keep the workflow lean — no new services, no deploy-from-CI in this lot.

### AD3 — Branch protection (founder clicks, you prepare)

- Goal: encode §1 in the platform without breaking the FF-push flow. Minimum:
  block force-pushes and branch deletion on `main` on BOTH remotes (Digbot-ai +
  Mael-wnb). Document the exact GitHub settings path.
- Requiring PRs / status checks on `main` would break the current FF-merge-push
  flow — do NOT enable it; note it as a possible future evolution instead.

### AD4 — Proof + close-out

- The lot proves itself: after the §1 merge of this lot, the founder deploys it to
  the VPS **using the new script** — its first live run is the evidence (capture
  the output, including the health assert).
- Also capture one `--dry-run` and one failure path (e.g. dirty tree or wrong SHA
  assert simulated safely — your call how, without touching real prod state).
- Evidence folder complete; `status-board.md` weakest-area #2 line updated
  honestly (manual deploy → scripted, CD-from-CI still future); close-out doc.

## Explicitly out of scope

Auto-deploy from GitHub Actions to the VPS (SSH from CI), Docker/containerized prod,
blue-green/zero-downtime schemes, the Wallets Kit upgrade, any runtime feature work,
frontend changes.

## Definition of done

- One real production deploy executed end-to-end via `scripts/deploy-api.sh` with
  the health assert passing (evidence captured), plus dry-run + failure-path
  captures.
- CI green with indexer typecheck active and the audit step reporting.
- Force-push/deletion protection active on `main` on both remotes.
- Docs updated (script is the canonical procedure); evidence folder complete; §1
  respected throughout (branch → CI → founder go → FF → both remotes).
