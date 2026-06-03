# Dig Stellar — Status Board

## Purpose

This file is the operational progress board for Dig Stellar.

It is meant to provide a quick and honest answer to:
- where the project stands right now
- which grant deliverables are closest to completion
- what is still partial or fragile
- what the next execution step should be

This file must stay short, practical, and frequently updated.

It should be kept aligned with:
- `docs/grant-roadmap.md`
- `docs/current-state.md`

---

## Status scale

### Delivery status
- **Done** — deliverable or sub-part is essentially complete and demonstrable
- **Substantially done** — most of the value exists, only a limited gap remains
- **Partial** — meaningful progress exists, but important work remains
- **Early** — foundation or direction exists, but feature is still far from claim-ready
- **Blocked** — work cannot progress without a decision, dependency, or missing prerequisite

### Confidence
Confidence is an internal estimate of how close the current work is to being genuinely usable and claimable:
- **High** — low ambiguity, strong evidence, limited remaining gap
- **Medium** — meaningful progress, but important cleanup or completion still needed
- **Low** — still exploratory, weakly evidenced, or structurally incomplete

---

## Global status

- **Current phase:** Beta structuring and tranche-aligned execution
- **Current focus:** Tranche 1 maturity
- **Closest tranche-critical targets:** Tranche 1 Deliverable 1 and Deliverable 2
- **Biggest current risk:** Existing progress is real, but still not fully formalized, centralized, and operationalized
- **Main execution goal:** Convert existing beta and backend/indexer progress into clearly evidenced, claim-ready deliverables
- **Last updated:** YYYY-MM-DD

---

# Tranche 1 — MVP

| Deliverable | Status | Confidence | Current evidence | Main remaining gap | Next action |
|---|---|---|---|---|---|
| **Deliverable 1 — Data Indexing Foundation (Horizon & Soroban)** | **Substantially done** | **Medium-High** | Real Mainnet data already powers parts of the product; `apps/indexer` exists; protocol/pool API endpoints exist; wallet balance snapshots and refresh flows are real | Formalize exact source coverage, normalize remaining protocol/data inconsistencies, document freshness and indexer operations more clearly | Map current adapters/data sources and identify what still needs to be formalized for tranche-ready evidence |
| **Deliverable 2 — Analytics Dashboard MVP** | **Substantially done** | **Medium** | Public beta exists; dashboard views are real; wallet connection exists; protocol and pool views exist; real backend data already reaches the frontend | Move remaining product-critical external frontend calls behind the API, do responsive pass, clean stale/loading/error states | Centralize network/global stats behind the API and tighten frontend/API boundaries |
| **Deliverable 3 — Smart Transaction Builder (Testnet)** | **Early** | **Low** | Wallet connection foundation exists; product direction and architecture can support future execution flows | No clearly defined narrow builder flow yet; simulation/XDR generation/action UX not yet claim-ready | Define one single testnet reference action flow and scope the builder around it |

---

# Tranche 2 — Expansion

| Deliverable | Status | Confidence | Current evidence | Main remaining gap | Next action |
|---|---|---|---|---|---|
| **Deliverable 1 — Multi-Wallet Portfolio & Active Signer Model** | **Partial** | **Medium** | Grouped multi-wallet behavior is real; add/remove/refresh/select flows exist; backend `userId` grouping works | Need a cleaner explicit model for active signer vs tracked/watch-only wallets, plus richer portfolio semantics if required | Define and document the active-signer model and align backend/frontend behavior around it |
| **Deliverable 2 — In-App Alerting Engine** | **Early** | **Low** | Notification-like UI direction exists conceptually | No real alert rule model, storage, evaluator, or notification lifecycle yet | Define a minimum alert model and choose evaluation architecture |
| **Deliverable 3 — Bridge Flow Monitoring** | **Early** | **Low** | Grant-level intent exists | No real adapter, normalized flow model, or dashboard slice yet | Choose the first bridge source and define the MVP integration scope |

---

# Tranche 3 — Mainnet / Operational maturity

| Deliverable | Status | Confidence | Current evidence | Main remaining gap | Next action |
|---|---|---|---|---|---|
| **Deliverable 1 — Mainnet Deployment & Freshness Tracking** | **Partial** | **Low-Medium** | Product already uses real Mainnet data in several areas; beta exists publicly | Production topology, stale detection, retry/backoff, and health/freshness observability are not yet formalized enough | Define deployment topology and introduce minimal freshness/health instrumentation |
| **Deliverable 2 — Non-Custodial Mainnet Actions** | **Early** | **Low** | Wallet foundation exists | Depends heavily on building the tranche-1 action foundation first | Finish tranche-1 builder scope before mainnet action planning |
| **Deliverable 3 — Observability, UI/UX Polish & Reference Implementation Handoff** | **Early** | **Low** | Documentation effort has started; modular structure already exists | Health endpoints, metrics, packaging, reproducibility, and final polish are still incomplete | Add health/runbook/deploy discipline progressively instead of leaving it all to the end |

---

## Strongest areas right now

The strongest current areas of the project are:
1. real beta existence
2. backend/API foundation
3. grouped wallet and portfolio flows
4. wallet balance snapshot/refresh behavior
5. protocol and pool exploration foundation
6. overall architecture separation between `web`, `api`, and `indexer`

---

## Weakest areas right now

The weakest or least mature areas are:
1. transaction builder / action execution
2. alerting engine
3. bridge monitoring
4. freshness/retry/stale operationalization
5. deployment/observability maturity
6. final API centralization for some top-level stats

---

## Best near-term tranche wins

The most likely near-term progress wins are:
1. turn **Tranche 1 Deliverable 1** into a clearly evidenced, documented near-complete deliverable
2. turn **Tranche 1 Deliverable 2** into a cleaner API-centered and beta-credible dashboard deliverable
3. narrow the scope of **Tranche 1 Deliverable 3** so it becomes actionable instead of abstract
4. formalize the current multi-wallet system as the base for **Tranche 2 Deliverable 1**

---

## Current execution priorities

### Priority 1
Make Tranche 1 Deliverable 1 explicit and provable:
- exact source mapping
- exact protocol coverage
- exact DB/API evidence
- operational runbook

### Priority 2
Make Tranche 1 Deliverable 2 cleaner and more defensible:
- centralize remaining frontend external calls
- improve consistency of real data usage
- responsive pass
- beta polish where it impacts credibility

### Priority 3
Reduce ambiguity around Tranche 1 Deliverable 3:
- choose one small testnet action flow
- define action-builder boundaries
- avoid keeping this deliverable too abstract for too long

---

## Update rule

This file should be updated whenever:
- a deliverable moves meaningfully in maturity
- a major blocker is removed
- a gap becomes clearer
- the next tranche-critical target changes
- a previously “partial” area becomes substantially done

When in doubt, prefer realism over optimism.