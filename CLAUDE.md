# CLAUDE.md — Dig Stellar

Operating instructions for Claude Code in this repository.
This file is the working contract for code tasks. For grant/architecture detail, defer to
`docs/` (see "Source of truth" below) rather than guessing — do not duplicate that content here.

---

## What this project is

Stellar-native DeFi analytics + multi-wallet portfolio monitoring + optional non-custodial
action proposals. Funded by SCF 43 ($75k, 3 tranches). Stage: **functional beta with real
foundations**, transitioning toward operational, tranche-claimable maturity.

Mindset: **beta-first, execution-first, clarity-first.** Ship a credible beta, not a perfect
architecture. Prefer robust pragmatism over theoretical elegance. Short-term debt is acceptable
if it does not endanger the beta. No abstraction layers "just in case." Realism over optimism.

---

## Monorepo layout

```
apps/web        Vue 3 + Vite + Tailwind — product UI, wallet UX, consumes internal API
apps/api        NestJS + Prisma — the single frontend façade
apps/indexer    Soroban RPC / Horizon ingestion, adapters, snapshots, refresh jobs
packages/db     Prisma schema + migrations (Postgres)
packages/core   (optional) shared types/schemas for the unified model
packages/adapters (optional) protocol + bridge adapters
docs/           source-of-truth documentation
```

Key entry points (verify paths against the actual tree before relying on them):
- Prisma schema: `packages/db/prisma/schema.prisma`
- API endpoints: `apps/api/src/app.controller.ts`
- Blend job: `apps/indexer/src/run-blend.ts`
- Horizon job: `apps/indexer/src/run-horizon.ts`

---

## Layer ownership — enforce, do not blur

This is the most important rule in the repo. Architecture drift here is a defect, not a style choice.

- **`apps/web`** — UI, composables/state, wallet UX, calling internal API endpoints.
  NOT a place for business-critical logic. NOT a place for direct external-provider fetches
  for core product data. If you find frontend code fetching analytics directly from an
  external provider, that is debt to move behind the API, not a pattern to extend.

- **`apps/api`** — the single authoritative UI-facing layer. Aggregation/normalization for the
  UI, stable contracts, wallet/user grouping logic, orchestration between DB and indexer output,
  freshness metadata. Avoid letting it become a thin pass-through; it is a façade, not a proxy.

- **`apps/indexer`** — ingestion (Soroban RPC / Horizon / protocol SDKs), protocol adapters,
  snapshots, refresh cadence, cron-compatible jobs. Keep batch/indexer logic out of runtime API
  logic. Any metric that feeds an alert must be derivable from on-chain data as source of truth.

When a task spans layers, state which layer owns the new logic before writing it.

---

## Stack

TypeScript everywhere. Package manager: **pnpm** (indexer pins `pnpm@10.32.x`).

- **api** — NestJS 11 + Prisma 5 (`@prisma/client`) + Postgres. Tests: **Jest** (`*.spec.ts`).
- **indexer** — runner is **tsx**; reads via `@stellar/stellar-sdk`, `@blend-capital/blend-sdk`,
  `@defindex/sdk`; writes via both `@prisma/client` and raw `pg`. No tests yet.
- **web** — Vue 3.5 + Vite + Tailwind v4; wallet via `@creit.tech/stellar-wallets-kit` +
  `@stellar/freighter-api`. Typecheck runs through `vue-tsc` at build. No tests yet.

Stellar RPC is the primary data plane; Horizon is isolated behind an adapter as a legacy complement.

---

## Commands

Confirmed from each app's `package.json`. There is **no repo-wide** lint/typecheck/test —
each app owns its scripts.

```bash
# Local services (confirmed — docker-compose.yml)
docker compose up -d                # postgres:16 (5432) + redis:7 (6379)
                                    # DATABASE_URL = postgresql://dig:dig@localhost:5432/dig_stellar

# DB / Prisma (packages/db)
pnpm -C packages/db prisma:migrate  # prisma migrate dev
pnpm -C packages/db prisma:generate # prisma generate
pnpm -C packages/db prisma:studio   # prisma studio

# Indexer (apps/indexer — runner: tsx)
pnpm -C apps/indexer run:once       # seed / run-once
pnpm -C apps/indexer run:blend
pnpm -C apps/indexer run:horizon
pnpm -C apps/indexer run:defindex   # scaffolded, not validated — see note below
pnpm -C apps/indexer job:refresh    # global refresh orchestration
                                    #   -> src/scripts/ingest/72-run-refresh-job.ts

# API (apps/api — NestJS 11)
pnpm -C apps/api start:dev          # nest start --watch
pnpm -C apps/api build              # nest build
pnpm -C apps/api lint               # eslint --fix
pnpm -C apps/api test               # jest  (also test:e2e, test:cov, test:watch)

# Web (apps/web — Vue 3 + Vite)
pnpm -C apps/web dev                # vite
pnpm -C apps/web build              # vue-tsc -b && vite build  (typecheck happens here)
pnpm -C apps/web preview
```

Where to find per-protocol ingestion: only `blend`, `horizon`, `defindex`, `once`, and the global
`job:refresh` are top-level scripts. **Soroswap, Aquarius, and Stellar-native ingestion are not
top-level scripts** — they run under `apps/indexer/src/scripts/ingest/` (numbered files) and/or via
`run:once` / `job:refresh`. Look there before assuming a job is missing.

---

## Before any non-trivial task

Answer briefly, then proceed:
1. Which tranche / deliverable does this serve? (see `docs/status-board.md`)
2. Which app owns the logic — `web`, `api`, or `indexer`?
3. What is the beta-first version, and what is explicitly out of scope?
4. Files likely involved + most pragmatic execution order?
5. What can be postponed?

Then: implement → review (fragility, hidden coupling, needless complexity, is it *enough* for the
current tranche) → validate with real commands/endpoints/UI → flag which doc needs updating.

Prefer the smallest coherent change that moves the product forward. Commit in small, understandable
increments.

---

## Code conventions

- Return full files when modifying central/shared files; avoid broad refactors unless explicitly justified.
- Preserve compatibility with the current structure. Explicit, readable naming.
- Distinguish beta implementation from ideal long-term design when it matters; say which you are doing.
- Keep API contracts simple and product-oriented.
- Do not introduce providers, queues, or abstraction layers that the current roadmap does not need.
- Code comments and committed docs: **English**. (Chat with Maël may be French; repo artifacts stay English.)

---

## Non-custodial security invariants — never violate

- The backend never stores private keys, seeds, or anything enabling signing on a user's behalf.
- Every XDR sent for signing must be validated **client-side** against the user's declared intent
  before the wallet is invoked. This is a first-class requirement, not an afterthought.
- A watch-only / tracked address must never become usable for signing.
- Logs and metrics exclude PII and Stellar account addresses beyond hashed identifiers.
- Signing handoff uses Stellar standards (SEP-7 / SEP-10 / SEP-11 via Stellar Wallets Kit).
  Do not invent custom signing flows where a SEP already exists.

---

## Current priorities (keep aligned with `docs/status-board.md`)

The board is the live source of truth; treat the percentages there as authoritative.

1. **T1-D1 — Data Indexing Foundation (~90%)** — formalize Horizon vs Soroban source ownership,
   freshness expectations, retry/backoff, runbook, evidence package. (DeFindex is out of scope here.)
2. **T1-D2 — Analytics Dashboard MVP (~80%)** — centralize remaining frontend external calls
   behind the API, responsive pass, stale/loading/error consistency.
3. **T1-D3 — Smart Transaction Builder, testnet (~15%)** — define ONE narrow reference action
   end-to-end (build → simulate → wallet-side sign). This is the real gap.

Operational maturity (freshness visibility, health endpoints, deployment discipline) now lags
implementation — treat it as first-class, not "later."

### Scope notes (so you don't over- or under-claim)

- **DeFindex** is **out of scope for T1-D1.** A `run:defindex` script and `@defindex/sdk` exist, but
  the adapter is not validated. Do not treat it as part of the T1-D1 evidence, and do not "finish"
  it unless explicitly asked — T1-D1 coverage is Blend, Soroswap, Aquarius (Soroban) + Stellar-native
  DEX (Horizon).
- **Tests / CI** are **intentionally deferred (likely T3).** Dependencies are installed (Jest in api)
  but no test suites or CI pipelines are written yet. Do not add a test/CI build-out as a side effect
  of an unrelated task, and do not cite testing as existing evidence.

---

## Keep docs in sync

When a structural change lands, update the relevant doc(s) in the same change:
`docs/grant-roadmap.md`, `docs/current-state.md`, `docs/status-board.md`,
`docs/TECHNICAL_ARCHITECTURE.md`, `docs/runbooks.md`, `docs/deployment.md`, or a note in
`docs/decisions/`. When updating status, prefer brutal clarity over optimism.

---

## Source of truth

`docs/TECHNICAL_ARCHITECTURE.md` (architecture), `docs/grant-roadmap.md` (deliverables),
`docs/current-state.md` + `docs/status-board.md` (where things actually stand),
`docs/data-model.md` + `packages/db/prisma/schema.prisma` (schema),
`docs/runbooks.md` + `docs/deployment.md` (operations), `docs/ai-guidelines.md` (how AI works here).