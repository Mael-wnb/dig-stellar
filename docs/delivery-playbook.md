# Dig Stellar — Delivery Playbook

## Purpose
This document defines the default way to execute a Dig Stellar task from idea to shipped change.

---

## Standard workflow

### Step 1 — Frame the task
Clarify:
- what are we trying to achieve?
- why now?
- which tranche/deliverable does it support?
- what is the beta-first version?
- what is explicitly out of scope?

### Step 2 — Identify ownership
Decide whether the task belongs mainly to:
- `apps/web`
- `apps/api`
- `apps/indexer`
- or a combination

### Step 3 — Decompose the work
List:
- files likely to change
- dependencies
- validation approach
- likely risks

### Step 4 — Implement
Prefer the smallest coherent change that moves the product forward.

### Step 5 — Review
Check:
- correctness
- simplicity
- alignment with project architecture
- sufficiency for the current beta/tranche stage

### Step 6 — Validate
Use real commands, endpoints, and manual UI checks.

### Step 7 — Document
Update the relevant doc(s) if the change affects roadmap, architecture, runbooks, or deployment.

### Step 8 — Commit
Commit in small, understandable increments.

---

## Definition of done by task type

### Frontend task
Done when:
- behavior works
- loading/error states are acceptable
- build passes
- responsive behavior does not break major layouts

### API task
Done when:
- endpoint contract is clear
- happy path and common failure path are handled
- frontend can consume it cleanly
- it can be verified via curl or equivalent

### Indexer task
Done when:
- the job runs predictably
- logs are understandable
- output lands where expected
- it can be scheduled or rerun without mystery

### Operational task
Done when:
- the team knows how to run it
- the environment variables are clear
- basic troubleshooting is documented

---

## Branch & release discipline (STANDING — since Lot AA, 2026-08-20)

The app is released, has been in SCF review, and periodically runs live incentive
campaigns. Direct-to-main is over. These rules apply to every lot:

1. **Never commit or push to `main` directly.** All work happens on a `feat/*`
   branch (sub-branches per sub-lot allowed, merged into the lot branch).
2. **Merge to `main` only after ALL of:**
   - app builds green + full test suites green locally (web vitest + api jest);
   - CI (`.github/workflows/ci.yml`) green on the pushed branch (CI runs on
     `feat/**` and `fix/**` pushes for this reason);
   - for UI work: local smoke at 390×844, 768×1024, 1440×900;
   - founder validation on the Vercel branch Preview — explicit "go" in chat.
     Push the branch to `public-origin` (Mael-wnb/dig-stellar) to trigger the
     Preview; for mobile-facing work the founder tests on a real iPhone
     (Safari, cellular) — emulation does not catch dvh/keyboard/momentum-scroll.
3. **Merges are fast-forward into `main`**, then push BOTH remotes (`origin` +
   `public-origin`). Pushing `main` to `public-origin` IS the prod frontend
   deploy. If `main` moved since branching, rebase the branch first and let CI
   re-run on the rebased head.
4. **Campaign freeze rule:** while a faucet campaign is live, no merge that
   touches ActionModal, the campaign card, the claim panel, or any component in
   their render path — unless every campaign state has been reproduced and
   verified locally first (env-flip on the local api: `FAUCET_ENABLED` /
   `FAUCET_NETWORK` / `FAUCET_STARTS_AT` / `FAUCET_ENDS_AT`).
5. A genuinely needed mid-lot hotfix on `main` gets its own `fix/*` branch and
   the same preview validation — rebase the lot branch on top afterward.
6. **Deploy-order rule:** when a frontend change depends on an API change, the
   API must be deployed to the VPS BEFORE the frontend merge to `main` — the
   frontend deploy is instant on push; the API deploy is manual.
