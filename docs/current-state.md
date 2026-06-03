# Dig Stellar — Current State

## Purpose
This document captures the real current state of Dig Stellar.

It should be updated regularly and kept brutally honest.
The goal is not to make the project look finished, but to know exactly what is usable, partial, fragile, or still mocked.

---

## Current overall assessment

Dig Stellar is no longer just a concept or static prototype.
It already has:
- a functioning beta
- a real frontend
- a backend API
- indexing scripts
- real wallet connection flows
- real protocol and wallet data integration in several areas

The project is closer to a functional beta than to a blank-sheet build.

The main challenge now is not “build everything from scratch”, but:
- stabilize
- centralize
- operationalize
- align with grant deliverables
- deploy cleanly

---

## `apps/web` — current state

### What already exists
- dashboard UI exists and is publicly presentable as a beta foundation
- wallet connection exists via Stellar Wallets Kit
- wallet header state exists
- wallet section exists and is advanced
- multi-wallet grouping and display work
- protocol tabs / pool tabs / pool detail views exist
- several frontend views already consume real backend data

### What is already in decent shape
- general UI structure
- portfolio and wallet UX direction
- ability to demo a real product instead of mocks only

### What may still need work
- some network/global stats may still be sourced externally from the frontend instead of the API
- responsive polish likely not complete
- loading/error/stale states may not be fully harmonized across views
- some “coming soon” areas may still coexist with real features in ways that should be clarified

### Frontend goal for next phase
The frontend should become a clean consumer of internal APIs only for core product data.

---

## `apps/api` — current state

### What already exists
- NestJS backend exists
- wallet-related endpoints are already present
- wallet connect flow via backend `userId` resolution exists
- wallet overview / balances / refresh endpoints exist
- protocol / pools endpoints already exist in some form

### What is already strong
- backend is not empty or theoretical
- wallet/user grouping logic has progressed significantly
- backend can already act as a façade between UI and data layer

### What likely still needs work
- network/global stats may still not be fully centralized here
- some endpoint contracts may still need cleanup or harmonization
- health/freshness/observability may still be incomplete
- API should become the single source for core frontend data

### Backend goal for next phase
Expose all critical dashboard and portfolio data through stable endpoints, while keeping business logic out of the frontend.

---

## `apps/indexer` — current state

### What already exists
- indexer app exists
- wallet balance snapshot script exists
- protocol data fetch/index work exists for multiple Stellar protocols or venues
- real data ingestion is already happening in meaningful areas

### What is already strong
- there is already a real data pipeline mentality
- the project is not blocked on “how do we ingest data at all?”
- architecture direction is sound: indexer separate from API and frontend

### What likely still needs work
- standardization of script responsibilities
- cron readiness and scheduling clarity
- runbooks and operational checks
- freshness visibility and stale/retry handling
- possibly normalization consistency across protocol adapters

### Indexer goal for next phase
Become a predictable operational data pipeline, not just a collection of scripts that work manually.

---

## Wallets / identity current state

### What works
- wallet session in frontend works
- wallet address can be connected and persisted in local state/storage
- backend can resolve a real user grouping through wallet connect
- multi-wallet now works as a grouped portfolio model
- adding a secondary wallet to an existing user is working

### What is still intentionally weak or beta-level
- strong cryptographic proof of ownership/session security is not yet the final model
- active signer vs watch-only model may still need explicit product/backend clarity

### Near-term stance
This is acceptable for beta, as long as the product positioning remains honest.
The stronger auth/signature model can come later if needed.

---

## Data quality / freshness current state

### Likely current situation
- several data sources are already live
- not all freshness/stale behaviors are yet fully surfaced
- some provider calls may still exist in the frontend
- retry/backoff/operational reliability may still be partial

### Priority
Before broadening scope too much, ensure the product can answer:
- where does this metric come from?
- how fresh is it?
- what happens when the source fails?

---

## UI / UX current state

### Good
- product already feels like a real app, not just an internal dashboard
- wallet and protocol navigation are understandable
- enough surface exists to iterate rather than invent from zero

### To improve
- responsive pass
- consistency of labels, statuses, and empty states
- making the distinction clearer between live, partial, and coming-soon areas

---

## Deployment current state

### Likely current state
- local development works
- beta is already publicly visible in some form
- final target deployment shape is not fully standardized yet

### Recommended near-term target
- `apps/web` on Vercel
- `apps/api` on a small VPS or equivalent runtime
- `apps/indexer` and cron on the same server-side environment as API or another controlled runtime

---

## Main gaps before a stronger public beta

The biggest remaining gaps are likely:
1. centralizing remaining external frontend calls behind API
2. making indexer refresh operational and cron-friendly
3. documenting and stabilizing freshness behavior
4. finalizing responsive and QA pass
5. clarifying the boundary between real features and placeholder features

---

## How to update this file

Whenever a meaningful feature lands, update this document by answering:
- what now really works?
- what moved from partial to stable?
- what is still fragile?
- what did we intentionally postpone?

This file should stay short, practical, and honest.
