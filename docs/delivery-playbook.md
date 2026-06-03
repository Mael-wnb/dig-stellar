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
