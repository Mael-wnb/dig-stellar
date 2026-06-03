# Dig Stellar — AI Guidelines

## Purpose
This file explains how AI should be used on Dig Stellar.

It is meant to improve consistency, speed, and quality across coding, planning, review, and documentation.

---

## Core philosophy
AI is not only used to generate code.
It is used to:
- frame problems
- decompose deliverables
- propose implementation order
- generate or refactor code
- review risks
- produce technical documentation
- create runbooks and checklists

The default mindset is **beta-first, execution-first, and clarity-first**.

---

## High-level project principles
- ship a credible beta, not a perfect architecture
- prefer robust pragmatism to theoretical elegance
- keep responsibilities clear between `web`, `api`, and `indexer`
- avoid critical business logic duplication across layers
- front should consume internal APIs, not rely directly on many external providers
- accept some short-term debt if it does not endanger the beta
- document structural decisions

---

## Layer responsibility rules

### `apps/web`
AI should avoid pushing business-critical logic into the frontend.
The frontend should mainly handle:
- UI
- composables/state
- interaction flows
- wallet UX
- calling internal APIs

### `apps/api`
AI should treat the API as the main façade for the frontend.
It should host:
- aggregation logic
- stable contracts for UI
- wallet/user logic
- orchestration between DB and indexing outputs

### `apps/indexer`
AI should place in the indexer:
- ingestion
- refresh scripts
- snapshots
- adapters to Horizon / Soroban / protocol SDKs / provider APIs
- cron-compatible jobs

---

## What AI should do before writing code on non-trivial tasks
Before implementing a significant feature or refactor, AI should first help answer:
- what is the actual goal?
- which tranche/deliverable does it serve?
- which app should own this logic?
- what files are likely involved?
- what is the most pragmatic execution order?
- what can be postponed?

---

## Code generation rules
- prefer returning full files when modifying central files
- avoid broad refactors unless explicitly justified
- preserve compatibility with the current structure when possible
- do not introduce abstraction layers “just in case” without a concrete need
- distinguish between beta implementation and ideal long-term design
- keep naming explicit and readable
- keep API contracts simple and product-oriented

---

## Review rules
When asked to review code, AI should explicitly assess:
- fragility
- hidden coupling
- needless complexity
- impact on beta delivery speed
- whether the change is enough for the current tranche or still incomplete

---

## Documentation rules
AI should help keep docs lightweight but useful.
When a structural change happens, AI should suggest whether one of these needs updating:
- `grant-roadmap.md`
- `current-state.md`
- `runbooks.md`
- `deployment.md`
- a decision note in `docs/decisions/`

---

## Prompting guidance
For large tasks, AI should prefer a flow like:
1. framing
2. decomposition
3. implementation
4. review
5. validation checklist
6. doc update

---

## What AI should avoid
- over-engineering
- silent architecture drift
- pushing external data dependencies back into the frontend
- proposing major refactors that do not directly help the current roadmap
- blurring boundaries between runtime API logic and batch/indexer logic
