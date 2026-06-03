# Dig Stellar — Grant Roadmap

## Purpose

This document translates the approved Stellar Community Fund grant into an internal execution roadmap.

It is not meant to restate the application in reviewer language.  
Its role is to turn each tranche and deliverable into a concrete internal execution target.

For each deliverable, this file should answer:
- what was promised
- what it means technically in the Dig Stellar codebase
- what already exists
- what is still missing
- what evidence can prove completion
- what the minimum remaining gap is before tranche claim readiness

This document should be kept aligned with:
- `docs/current-state.md`
- `docs/status-board.md`

---

## Product framing

Dig Stellar is a Stellar-native extension of Dig focused on:
- protocol analytics
- portfolio tracking
- wallet-based user flows
- market visibility across Stellar DeFi
- progressively, actionable portfolio management and non-custodial execution

The current product already includes:
- a live beta frontend
- a backend API
- an indexer layer
- real protocol data ingestion in multiple areas
- working wallet connection and grouped multi-wallet portfolio behavior

The key challenge is no longer “build the first prototype”, but:
- stabilize the architecture
- centralize data flows
- tighten the correspondence between product, API, and indexer
- convert existing progress into tranche-aligned deliverables
- reach a clean and defensible beta/mainnet path

---

## Codebase ownership model

### `apps/web`
Responsible for:
- product UI
- composables / client-side state
- wallet UX
- user interactions
- consumption of internal API endpoints

Should not become the place for:
- critical business logic
- long-term provider integration logic
- direct dependency on multiple external analytics providers for core product data

### `apps/api`
Responsible for:
- frontend-facing contracts
- aggregation and normalization for UI
- wallet/user grouping logic
- runtime orchestration between DB and indexer-triggered operations
- exposing dashboard, pools, wallet, and future alert/action endpoints

### `apps/indexer`
Responsible for:
- Horizon and Soroban ingestion
- protocol adapters
- snapshots
- refresh cadence
- cron-compatible operational data collection
- long-running or repeated data refresh jobs

---

# Tranche 1 — MVP

---

## Deliverable 1 — Data Indexing Foundation (Horizon & Soroban)

### Grant promise
Build the backend infrastructure to collect Stellar DeFi data through Horizon and Soroban RPC, store it in a unified database, and expose internal API endpoints with a 5 to 15-minute refresh cadence.

### Internal interpretation
This deliverable is the technical foundation of the whole product.

Internally, it means Dig Stellar must have:
- a real hybrid ingestion model using both Horizon and Soroban
- protocol/venue adapters for the first target Stellar DeFi sources
- normalized database storage
- indexer scripts that can be run manually and later scheduled
- API endpoints exposing protocol and snapshot data in a frontend-usable way

### Apps concerned
- `apps/indexer`
- `apps/api`

### Current reality
**Substantially advanced but not yet fully formalized.**

What already exists or appears already significantly underway:
- real Mainnet data is already being fetched in the beta
- the project already uses a monorepo with a dedicated `apps/indexer`
- Postgres is already part of the stack
- a wallet balance snapshot script exists and writes to DB
- several protocol integrations or adapters already exist in at least partial form
- backend protocol/pool endpoints already exist
- Blend indexing has clearly already been initiated
- real backend/frontend data circulation exists

### Current evidence
Likely evidence already available:
- `apps/indexer` protocol and wallet scripts
- real DB tables used by API responses
- `/v1/pools`, `/v1/protocols`, wallet snapshot-related flows
- live beta consuming real data
- wallet snapshot refresh already demonstrable via command/API

### Main gaps
The likely missing pieces before this deliverable is clearly tranche-ready are:
- explicit documentation of which sources are covered today by Horizon vs Soroban
- clearer mapping of protocol coverage (Blend / Aquarius / Soroswap / SDEX / DeFindex)
- freshness strategy still not formalized enough
- retry/stale handling not yet treated as a first-class operational concern
- possible remaining inconsistencies in how data is normalized between protocols
- runbook for indexer operations likely still incomplete

### Minimum completion criteria internally
We should consider this deliverable ready to claim when:
- the first target protocols/venues are clearly indexed through the right source layers
- data lands in normalized DB structures that the API consumes directly
- protocol data powering the dashboard no longer depends on ad hoc frontend provider fetching for core metrics
- refresh cadence is operationally usable
- stale states can be detected, even if not yet perfectly surfaced everywhere
- a developer can understand, run, and debug the data ingestion path without guesswork

### Confidence
**Medium-high**  
This looks like one of the strongest tranche-1 candidates because a lot already exists. The main work is likely not “invent the system” but “formalize, tighten, and prove it.”

### Next actions
1. map current protocol adapters and data sources explicitly
2. document DB tables / snapshots currently supporting protocol data
3. identify what still relies on frontend external fetches
4. define freshness markers and minimal stale detection
5. update runbooks for ingestion and refresh

---

## Deliverable 2 — Analytics Dashboard MVP

### Grant promise
Deliver the first version of the user interface displaying global market data and protocol-specific dashboards.

### Internal interpretation
This deliverable is not just “a page exists”.

Internally, it means:
- a public frontend exists and is usable
- protocol-specific views are real, not just mocked
- core metrics are displayed coherently
- the dashboard feels like a real product entry point into Stellar DeFi
- wallet connection is integrated in a meaningful way

### Apps concerned
- `apps/web`
- `apps/api`

### Current reality
**Already significantly advanced.**

What already exists:
- a public beta exists
- frontend structure is real and already product-shaped
- protocol tabs / pool tabs / pool details exist
- wallet connection exists
- wallet section is advanced
- multi-wallet flows have been pushed much further than a mock MVP
- the frontend is already reading real backend data in several important areas

### Current evidence
Likely evidence already available:
- public beta URL
- `apps/web` components already built and connected
- wallet connect header + wallet section
- pool/protocol dashboard pages using live backend data
- screenshots / walkthroughs could easily support this

### Main gaps
Most likely missing pieces:
- remaining global/network stats still fetched directly from external providers in frontend
- responsive pass not fully done
- loading / stale / error states may still be inconsistent
- some sections may still mix real and placeholder behavior
- top-level dashboard coherence may need one polishing pass

### Minimum completion criteria internally
We should consider this deliverable ready to claim when:
- the core dashboard is API-driven for product-critical data
- the protocol views are clearly usable and demonstrable
- wallet connection works reliably for beta users
- the main screens do not break on normal desktop and mobile widths
- the product can be shown end-to-end without caveating major broken sections

### Confidence
**Medium-high**  
This is likely also close, but unlike Deliverable 1, this one has a stronger dependency on polish, API consistency, and cleaning up frontend-provider leakage.

### Next actions
1. centralize remaining dashboard/global stats behind internal API
2. align frontend on API-only consumption where possible
3. perform a responsive pass
4. clean stale/loading/error handling
5. clearly label or remove non-functional placeholder areas

---

## Deliverable 3 — Smart Transaction Builder (Testnet)

### Grant promise
Develop the engine that generates non-custodial transaction proposals, bundles prerequisites into a single XDR when needed, simulates on testnet, and executes with in-wallet signing.

### Internal interpretation
This is the first real move from analytics to actions.

Internally, it means:
- a first supported action flow must exist
- that flow must produce a valid transaction proposal/XDR
- prerequisite ops (trustline, etc.) can be composed when necessary
- execution remains non-custodial
- simulation and execution UX are understandable

### Apps concerned
- `apps/web`
- `apps/api`

### Current reality
**Still early.**

What exists today:
- wallet connection UX exists
- some groundwork for wallet-aware flows exists
- product direction clearly anticipates actions

What likely does **not** yet exist in a tranche-ready form:
- a formal transaction builder layer
- a first narrow action flow implemented end-to-end
- clear simulation UX
- stable action scope definition

### Current evidence
Currently likely limited to:
- wallet connection integration
- possibly some prior technical exploration
- architecture ability to support future builder work

### Main gaps
This deliverable still needs:
- exact scope definition for the first testnet action(s)
- clear split between frontend and backend responsibilities
- XDR builder design
- simulation flow
- user-visible execution feedback
- testnet validation path

### Minimum completion criteria internally
We should consider this ready when:
- one concrete testnet action flow works end-to-end
- the flow can generate and simulate a valid transaction proposal
- trustline/precondition logic is correctly handled when needed
- signing remains fully wallet-side
- the UX clearly explains what is happening

### Confidence
**Low**  
This appears to be the least mature of the tranche-1 deliverables and likely the one that still requires true new feature work.

### Next actions
1. choose one narrow reference flow only
2. define the builder contract and UX
3. implement simulation and execution on testnet
4. test with one protocol/action first
5. document the builder boundaries for future extension

---

# Tranche 2 — Expansion / Testnet depth

---

## Deliverable 1 — Multi-Wallet Portfolio & Active Signer Model

### Grant promise
Support one active signer wallet and multiple watch-only addresses, with aggregated balances and DeFi positions.

### Internal interpretation
This deliverable is about turning wallet support into a real portfolio model.

Internally, it means:
- one user identity can group multiple wallets
- the app distinguishes between signing context and tracked wallets
- the portfolio is consolidated across those wallets
- the distinction is visible and meaningful in the UI

### Apps concerned
- `apps/web`
- `apps/api`
- potentially `apps/indexer` as portfolio depth expands

### Current reality
**Already materially advanced.**

What already exists:
- backend wallet grouping by real `userId`
- multi-wallet add/remove/select flows
- wallet refresh
- wallet overview and balances
- ability to add secondary wallets to an existing user grouping

What still seems incomplete:
- explicit “active signer” vs “watch-only” model
- richer DeFi position aggregation beyond current wallet balances
- product clarity around which wallet is currently acting vs merely tracked

### Main gaps
- formal modeling of signer vs watch-only
- possible DB/UI state changes to represent this cleanly
- broader position aggregation if required by tranche interpretation

### Minimum completion criteria internally
We should consider this deliverable ready when:
- a user can manage multiple wallets under one portfolio context
- the UI clearly distinguishes signing wallet vs tracked wallet(s)
- balances and at least the first level of portfolio aggregation are stable and intelligible

### Confidence
**Medium**  
This one may move quickly because the foundations are already in place.

### Next actions
1. define the “active signer” model explicitly
2. decide whether watch-only means backend state change or purely frontend designation
3. ensure aggregation semantics match the tranche wording
4. expose the distinction cleanly in UI

---

## Deliverable 2 — In-App Alerting Engine

### Grant promise
Build backend logic and frontend interface for user-defined alerts based on on-chain activity and metric deltas.

### Internal interpretation
This is the monitoring layer sitting on top of the snapshot architecture.

Internally, it means:
- users can define alert rules/preferences
- rules are evaluated against indexed/snapshotted data
- results are stored as notifications/events
- these are visible in-app

### Apps concerned
- `apps/api`
- `apps/web`
- likely `apps/indexer` or scheduled evaluation jobs

### Current reality
**Very early.**

What exists:
- notification-like UI elements exist in parts of the frontend
- the general product direction already fits this kind of feature

What seems missing:
- rule model
- persistence
- evaluator
- alert lifecycle
- profile/preferences model

### Minimum completion criteria internally
We should consider this ready when:
- a user can define a small set of real thresholds
- backend evaluates them periodically
- notifications are generated and displayed in the UI

### Confidence
**Low**

### Next actions
1. define the minimum alert model
2. choose evaluation layer (API job vs indexer job)
3. implement one small alert family first
4. connect it to a real in-app notification slice

---

## Deliverable 3 — Bridge Flow Monitoring

### Grant promise
Integrate bridge monitoring to track cross-chain capital inflows to Stellar.

### Internal interpretation
This feature extends analytics beyond local protocol state into ecosystem inflow visibility.

### Apps concerned
- `apps/indexer`
- `apps/api`
- `apps/web`

### Current reality
**Not meaningfully started yet**, based on current known state.

### Minimum completion criteria internally
We should consider this ready when:
- at least one source adapter is operational
- the resulting flows are normalized
- the dashboard exposes a coherent bridge/inflow slice

### Confidence
**Low**

### Next actions
1. choose the first bridge source
2. define the normalized storage model
3. implement adapter
4. expose minimal dashboard section

---

# Tranche 3 — Mainnet / Operational maturity

---

## Deliverable 1 — Mainnet Deployment & Freshness Tracking

### Grant promise
Switch infrastructure to production mainnet operation with stale detection and retries.

### Internal interpretation
This is the operationalization deliverable.

Internally, it means:
- production deployment topology is stable
- frontend, API, and indexer are deployed in a coherent way
- protocol freshness is observable
- stale or failing sources trigger retries and visible indicators

### Apps concerned
- `apps/web`
- `apps/api`
- `apps/indexer`

### Current reality
**Partially advanced conceptually, but not yet formalized operationally.**

What exists:
- live beta
- real mainnet data already present in parts of the product
- architecture naturally supports this direction

What likely remains:
- consistent production topology
- freshness system
- stale flags
- retry/backoff strategy
- health endpoints

### Confidence
**Low-medium**

### Next actions
1. define the production topology
2. move critical frontend data dependencies behind the API
3. add freshness metadata and health endpoints
4. add retry/backoff where needed

---

## Deliverable 2 — Non-Custodial Mainnet Actions

### Grant promise
Enable real mainnet swaps and vault/lending interactions from the dashboard.

### Internal interpretation
This is the mainnet extension of the transaction builder.

### Current reality
**Not yet close.**

This depends heavily on tranche-1 transaction-builder foundations.

### Confidence
**Low**

### Next actions
1. complete tranche-1 builder
2. validate action surface by protocol
3. harden UX and security guarantees
4. move to mainnet with narrow scope first

---

## Deliverable 3 — Observability, UI/UX Polish & Reference Implementation Handoff

### Grant promise
Add observability, polish, packaging, and documentation for SDF handoff.

### Internal interpretation
This is the final maturity layer:
- health
- latency/error visibility
- clean docs
- reproducible setup
- clearer packaging of the architecture

### Current reality
**Early, but the groundwork is starting.**

What already exists:
- documentation effort has started
- architecture is already modular enough to support packaging later

What remains:
- real health/metrics endpoints
- deployment/runbook maturity
- formal packaging and handoff structure
- final UI polish under production constraints

### Confidence
**Low**

### Next actions
1. add health and minimal observability early
2. keep docs updated incrementally
3. avoid postponing packaging concerns entirely until the end

---

# Cross-deliverable reality check

## Strongest current candidates
The deliverables that appear closest to being made tranche-claimable soon are:
1. **Tranche 1 — Deliverable 1 (Data Indexing Foundation)**
2. **Tranche 1 — Deliverable 2 (Analytics Dashboard MVP)**
3. **Tranche 2 — Deliverable 1 (Multi-Wallet Portfolio)**

## Most underdeveloped areas
The areas that appear to still require the most new work are:
1. **Tranche 1 — Deliverable 3 (Smart Transaction Builder)**
2. **Tranche 2 — Deliverable 2 (Alerting Engine)**
3. **Tranche 2 — Deliverable 3 (Bridge Monitoring)**
4. **Tranche 3 action/observability layers**

---

# Immediate execution priorities

The most useful priorities now are:

1. turn Tranche 1 Deliverable 1 into a clearly evidenced, well-documented near-complete deliverable
2. turn Tranche 1 Deliverable 2 into a stable, API-centered, beta-credible dashboard
3. define the minimum viable scope of Tranche 1 Deliverable 3 instead of keeping it abstract
4. keep `current-state.md` and `status-board.md` aligned with reality

---

# How to use this file

Before starting a major task, answer:
- which tranche does this help?
- which deliverable does it directly support?
- what evidence will prove progress?
- what is the smallest version that moves the deliverable closer to claim readiness?

This file should remain the main internal roadmap reference for all grant-aligned execution.