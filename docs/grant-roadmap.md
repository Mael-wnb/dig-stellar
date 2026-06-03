# Dig Stellar — Grant Roadmap

## Purpose
This document translates the approved Stellar Community Fund grant into an internal execution roadmap.

Its goal is not to repeat the grant wording for reviewers, but to make each tranche and deliverable actionable for the team and for AI-assisted execution.

For each deliverable, this document captures:
- product intent
- technical meaning
- apps concerned (`apps/web`, `apps/api`, `apps/indexer`)
- current state
- likely gaps
- what “done” really means internally
- risks and dependencies

---

## Project framing

Dig Stellar is a Stellar-focused DeFi analytics and portfolio management product built as an extension of Dig’s existing analytics platform.

The grant scope covers three major phases:
- Tranche 1: indexing foundation, MVP analytics dashboard, testnet transaction builder
- Tranche 2: multi-wallet portfolio, alerting engine, bridge flow monitoring
- Tranche 3: mainnet deployment, non-custodial actions, observability and packaging

This roadmap should always be interpreted with a **beta-first and shipping-first** mindset.

The objective is not to build the final ideal architecture immediately, but to deliver the promised capabilities in a robust, understandable, and demonstrable way.

---

## Codebase structure reminder

### `apps/web`
Responsibilities:
- product UI
- composables and client-side state
- wallet UX
- API consumption
- presentation and interaction flows

### `apps/api`
Responsibilities:
- backend façade for the frontend
- aggregation and normalization layer
- runtime business logic
- exposing protocol / wallet / dashboard data
- orchestration between DB and indexer jobs

### `apps/indexer`
Responsibilities:
- data ingestion
- snapshots
- adapters to Horizon / Soroban / protocol SDKs / external sources
- refresh jobs
- cron-compatible scripts

---

## Tranche 1 — MVP

## Deliverable 1 — Data Indexing Foundation (Horizon & Soroban)

### Grant promise
Build the backend infrastructure to collect Stellar DeFi data through both Horizon and Soroban RPC, store it in a unified database, and expose internal API endpoints with regular refresh cadence.

### Product meaning
This deliverable is the base data layer of the whole product.
If this layer is weak, all higher-level UI, analytics, alerts, and execution features become unreliable.

### Technical meaning
At minimum this includes:
- a hybrid indexing approach using:
  - Horizon for classic Stellar activity and balances
  - Soroban RPC for contract state and events
- adapters for the first target protocols or venues
- normalized storage model in Postgres
- internal API endpoints exposing protocol and snapshot data
- refresh cadence and predictable freshness

### Apps concerned
- `apps/indexer`
- `apps/api`
- optionally small coordination changes in `apps/web` if contract changes affect consumption

### Expected technical building blocks

#### In `apps/indexer`
- protocol/venue adapters
- Horizon readers
- Soroban readers
- normalization logic
- persistence logic
- refresh scripts usable manually and via cron

#### In `apps/api`
- protocol endpoints
- venue or snapshot endpoints
- contracts stable enough for UI consumption
- freshness or timestamp exposure where useful

#### In DB
- normalized protocol / venue / pool / snapshot data
- timestamps for freshness tracking
- enough historical structure to compute deltas over time

### Current state (to validate and update as work progresses)
- initial beta already exists and fetches real Mainnet data in several places
- backend stack exists with NestJS + Postgres + indexer
- adapters for Blend and some Stellar protocols are already partially present
- some dashboard endpoints already exist and are being used by the frontend
- there may still be data logic spread between indexer, API, and frontend in ways that need cleanup

### Likely gaps
- inconsistent abstraction level between protocols
- incomplete freshness handling
- remaining direct external calls from frontend
- missing standardized snapshot tables for some metrics
- incomplete runbook for diagnosing stale or failing sources

### Internal definition of done
This deliverable is considered complete internally when:
- Dig can ingest and normalize data from the target first protocols/venues promised for MVP
- data is persisted in a way that supports both current dashboard needs and near-term tranche needs
- API endpoints expose this data without requiring frontend-side external provider fetches for core metrics
- refresh cadence is operationally usable and understandable
- stale data is detectable
- the team can run, re-run, and debug the indexers without guesswork

### Risks
- Soroban and Horizon data models differ significantly and may tempt ad hoc handling
- some protocols may require protocol-specific logic that must not leak into frontend
- freshness / retry strategy may be under-designed initially
- manual scripts without runbooks may slow debugging badly

### Recommended execution order
1. document existing indexing adapters and DB outputs
2. standardize target MVP protocol coverage
3. normalize API contracts for dashboard consumption
4. add freshness markers and runbooks
5. remove remaining critical frontend-side external dependencies

---

## Deliverable 2 — Analytics Dashboard MVP

### Grant promise
Deliver the first version of the UI displaying global market data and protocol-specific dashboards.

### Product meaning
This is the public face of the product.
The dashboard must make the Stellar DeFi ecosystem legible, not just technically connected.

### Technical meaning
At minimum this includes:
- publicly accessible frontend
- protocol dashboards and pool views
- key metrics like TVL / volume / APY
- wallet connection via Stellar Wallets Kit
- enough clarity and polish to feel like a real product, not an internal tool

### Apps concerned
- `apps/web`
- `apps/api`

### Current state (to validate and update)
- a functional beta exists
- wallet connection exists
- protocol tabs, pool tabs, pool details, and wallet section are already advanced
- multi-wallet logic has significantly progressed
- some dashboard stats may still depend on frontend-side external APIs
- responsive and product polish are likely not yet fully done

### Likely gaps
- consistency of API data contracts
- frontend reliance on external providers for some top-level stats
- responsive issues on smaller screens
- mixed “real” and “coming soon” sections in the UI
- missing stale/loading/error UX in some places

### Internal definition of done
- the dashboard is fully powered by internal API calls for core product data
- the UI clearly covers the selected MVP protocols
- wallet connection is reliable enough for beta users
- the main views do not visually break on common screen sizes
- the app can be demoed end-to-end without manual explanation of broken sections

### Risks
- too much polish work before data centralization
- too many placeholders creating ambiguity about what is really functional
- dashboard stats looking live while being partially stale or provider-dependent

### Recommended execution order
1. centralize dashboard/network stats behind API
2. clean API contracts used by the frontend
3. stabilize wallet and pool views
4. responsive pass
5. final polish and copy review

---

## Deliverable 3 — Smart Transaction Builder (Testnet)

### Grant promise
Generate non-custodial multi-operation XDR transactions, simulated and executed on testnet, signed only in-wallet.

### Product meaning
This is the first meaningful step from analytics toward action.
Even if narrow in scope initially, it proves Dig can go beyond read-only dashboards.

### Technical meaning
At minimum this implies:
- transaction builder logic for selected operations
- bundling of prerequisite operations where relevant
- client-visible simulation/execution feedback
- strict non-custodial signing model

### Apps concerned
- `apps/web`
- `apps/api`
- possibly `apps/indexer` only indirectly if simulation depends on indexed state, but not core

### Current state (to validate and update)
- transaction execution is not yet the core stable part of the product
- wallet connection exists, but signing/auth flows may still be evolving
- some protocol interactions may still be roadmap rather than implemented

### Likely gaps
- deciding which exact operations are in scope for tranche 1
- preparing transactions in the right layer
- separating testnet-specific logic from future mainnet flows
- clear UX for simulation success/failure

### Internal definition of done
- at least one meaningful action flow can be built, simulated, signed, and executed on testnet
- the builder handles prerequisites when required
- the backend never handles private keys
- the frontend clearly communicates what is being signed and what happened

### Risks
- trying to support too many protocols or actions too early
- mixing analytics delivery with action execution complexity
- unclear trustline or prerequisite logic

### Recommended execution order
1. narrow exact action scope
2. design builder contract and signing UX
3. implement one strong reference flow
4. test on testnet thoroughly
5. document constraints and future extension points

---

## Tranche 2 — Testnet / expansion layer

## Deliverable 1 — Multi-Wallet Portfolio & Active Signer Model

### Grant promise
Support one active signer wallet plus multiple watch-only addresses, with aggregation of balances and DeFi positions.

### Product meaning
This makes the portfolio experience actually useful for power users.
It is also a core differentiator if executed cleanly.

### Current state (to validate and update)
- multi-wallet support is already significantly advanced
- wallet grouping by backend `userId` is working
- adding secondary wallets to an existing user profile is now working
- refresh wallet and wallet management flows exist
- watch-only vs active-signer distinction may still need clearer product modeling

### Gaps likely remaining
- explicit distinction in product and backend model between active signer and watch-only
- richer position aggregation beyond basic balances
- UX clarity around what wallet is signing vs just being tracked

### Internal done
- a connected user can see multiple wallets in one portfolio context
- the app distinguishes active signer from tracked/watch-only wallets where relevant
- aggregation is visible and understandable
- this is stable enough to demo and test with real user wallets

---

## Deliverable 2 — In-App Alerting Engine

### Grant promise
Backend logic plus frontend interface for user-defined alerts based on metric deltas and on-chain signals.

### Product meaning
This is the bridge from passive dashboard to active monitoring.

### Technical meaning
Requires:
- storing alert rules/preferences
- evaluating rules against snapshots
- generating notification records
- exposing these cleanly in-app

### Current state
- some notification UI already exists but may still be placeholder/coming-soon oriented
- analytics foundation may already expose some useful primitives

### Likely gaps
- no real alert rules engine yet
- no storage model for user alert configs yet
- no notification lifecycle yet

### Internal done
- users can define a small but real set of alerts
- backend evaluates them against fresh data
- app displays resulting notifications

---

## Deliverable 3 — Bridge Flow Monitoring

### Grant promise
Track capital inflows from bridge integrations, initially e.g. Allbridge.

### Product meaning
Adds ecosystem-level context and cross-chain visibility.

### Technical meaning
- external integration or attribution adapter
- normalized bridge event or flow representation
- dashboard section consuming it

### Likely gaps
- adapter work
- normalization model
- deciding level of attribution detail needed for MVP of this feature

### Internal done
- one bridge source reliably ingested
- dashboard section displays intelligible incoming bridged assets / flows

---

## Tranche 3 — Mainnet / operationalization

## Deliverable 1 — Mainnet Deployment & Freshness Tracking

### Grant promise
Run the infrastructure on mainnet with protocol coverage and freshness monitoring.

### Technical meaning
- deployable production architecture
- stale detection and retries
- reliability layer beyond basic scripts

### Internal done
- production API, frontend, and indexing pipeline are running
- stale sources are surfaced in UI and/or backend monitoring
- retry/backoff exists where needed

---

## Deliverable 2 — Non-Custodial Mainnet Actions

### Grant promise
Enable real transaction execution on mainnet through the dashboard.

### Internal done
- at least one meaningful mainnet action flow works end-to-end
- the app clearly distinguishes preparation / signing / execution / result
- strict non-custodial guarantees remain true

---

## Deliverable 3 — Observability, UI/UX Polish & Reference Implementation Handoff

### Grant promise
Observability, polish, packaging, and reference implementation handoff.

### Internal done
- health endpoints and operational observability exist
- system can be explained and reproduced
- documentation is usable by third parties
- final polish is sufficient for external review

---

## Immediate execution priorities

For the next execution phase, the most important priorities are:
1. stabilize and document current state
2. centralize remaining frontend external dependencies behind the API
3. turn indexer scripts into an operational refresh pipeline
4. prepare a deployable beta architecture
5. keep aligning work with tranche definitions instead of ad hoc feature drift

---

## How to use this file

Before starting a new major task, locate it in this roadmap and answer:
- which tranche does this serve?
- which deliverable does it support?
- is it a blocker, accelerator, or nice-to-have?
- what counts as done for beta vs ideal long-term?

This should be the main planning entry point for all future sessions.
