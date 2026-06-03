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

- docs/grant-roadmap.md
- docs/current-state.md

---

## Status scale

### Delivery status

- Done — deliverable or sub-part is essentially complete and demonstrable
- Substantially done — most of the value exists, only a limited gap remains
- Partial — meaningful progress exists, but important work remains
- Early — foundation or direction exists, but feature is still far from claim-ready
- Blocked — work cannot progress without a decision, dependency, or missing prerequisite

### Confidence

Confidence is an internal estimate of how close the current work is to being genuinely usable and claimable:

- High — low ambiguity, strong evidence, limited remaining gap
- Medium — meaningful progress, but important cleanup or completion still needed
- Low — still exploratory, weakly evidenced, or structurally incomplete

---

## Global status

- Current phase: Beta structuring and tranche-aligned execution
- Current focus: Tranche 1 maturity
- Closest tranche-critical targets: Tranche 1 Deliverable 1 and Deliverable 2
- Biggest current risk: Operationalization, freshness visibility, and API centralization now lag implementation progress
- Main execution goal: Convert existing implementation progress into clearly evidenced, claim-ready deliverables
- Last updated: 2026-06-03

---

# Tranche 1 — MVP

| Deliverable | Status | Completion | Confidence | Current evidence | Main remaining gap | Next action |
|---|---|---:|---|---|---|---|
| Deliverable 1 — Data Indexing Foundation (Horizon & Soroban) | Substantially done | 90% | High | Horizon ingestion operational; Soroban ingestion operational; Blend, Soroswap, Aquarius and Stellar Native adapters operational; protocol metrics persisted; pool metrics persisted; asset pricing refreshes operational; protocol APIs powered by indexed data | Freshness visibility, retry/backoff standardization, DeFindex integration, documentation and operational runbooks | Formalize source ownership, freshness expectations, and tranche evidence package |
| Deliverable 2 — Analytics Dashboard MVP | Substantially done | 80% | Medium-High | Public beta exists; dashboard views are real; wallet connection exists; protocol and pool views exist; real backend data reaches the frontend | Remaining frontend external calls, responsive pass, stale/loading/error consistency | Centralize remaining dashboard/network stats behind the API |
| Deliverable 3 — Smart Transaction Builder (Testnet) | Early | 15% | Low | Wallet foundation exists; architecture can support transaction flows | No builder layer, simulation flow, XDR orchestration, or scoped action flow yet | Define one narrow testnet reference action |

---

# Tranche 2 — Expansion

| Deliverable | Status | Completion | Confidence | Current evidence | Main remaining gap | Next action |
|---|---|---:|---|---|---|---|
| Deliverable 1 — Multi-Wallet Portfolio & Active Signer Model | Partial | 60% | Medium | Grouped multi-wallet behavior is real; add/remove/refresh/select flows exist; backend user grouping works | Active signer model not formalized; watch-only distinction not explicit | Define and document active signer semantics |
| Deliverable 2 — In-App Alerting Engine | Early | 10% | Low | Product direction exists | No alert model, evaluator, storage, or lifecycle | Define minimum viable alert architecture |
| Deliverable 3 — Bridge Flow Monitoring | Early | 5% | Low | Grant-level intent exists | No adapter, normalized model, or dashboard implementation | Choose first bridge source and MVP scope |

---

# Tranche 3 — Mainnet / Operational maturity

| Deliverable | Status | Completion | Confidence | Current evidence | Main remaining gap | Next action |
|---|---|---:|---|---|---|---|
| Deliverable 1 — Mainnet Deployment & Freshness Tracking | Partial | 40% | Medium | Real Mainnet data powers the platform; beta exists publicly; refresh jobs are operational | Freshness visibility, stale detection, retries, health endpoints, deployment formalization | Introduce freshness metadata and operational health visibility |
| Deliverable 2 — Non-Custodial Mainnet Actions | Early | 5% | Low | Wallet foundation exists | Depends on transaction-builder completion | Complete tranche-1 action foundation first |
| Deliverable 3 — Observability, UI/UX Polish & Reference Implementation Handoff | Early | 20% | Low | Documentation effort has started; architecture is modular | Observability, health metrics, deployment maturity, reproducibility, packaging | Add health/runbook/deployment discipline incrementally |

---

## Strongest areas right now

The strongest current areas of the project are:

1. Horizon + Soroban indexing foundation
2. protocol analytics architecture
3. backend/API foundation
4. grouped multi-wallet portfolio flows
5. wallet balance snapshot and refresh flows
6. protocol and pool exploration experience
7. clear separation between web, api, and indexer

---

## Weakest areas right now

The weakest or least mature areas are:

1. transaction builder / action execution
2. alerting engine
3. bridge monitoring
4. freshness and observability
5. deployment maturity
6. remaining frontend external provider dependencies

---

## Best near-term tranche wins

The most likely near-term progress wins are:

1. complete formalization of Tranche 1 Deliverable 1
2. complete API centralization for Tranche 1 Deliverable 2
3. define and scope Tranche 1 Deliverable 3
4. formalize the active signer model for Tranche 2 Deliverable 1

---

## Current execution priorities

### Priority 1

Finish Tranche 1 Deliverable 1:

- protocol ownership map
- Horizon vs Soroban source map
- freshness expectations
- operational runbook
- tranche evidence package

### Priority 2

Finish Tranche 1 Deliverable 2:

- centralize remaining frontend external calls
- improve dashboard consistency
- responsive pass
- stale/loading/error cleanup

### Priority 3

Reduce ambiguity around Tranche 1 Deliverable 3:

- choose one narrow action flow
- define builder boundaries
- implement simulation path
- validate end-to-end testnet execution

---

## Update rule

This file should be updated whenever:

- a deliverable moves meaningfully in maturity
- a major blocker is removed
- a gap becomes clearer
- the next tranche-critical target changes
- a previously partial area becomes substantially done

When in doubt, prefer realism over optimism.