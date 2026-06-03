# Dig Stellar — Current State

## Purpose

This document captures the real current state of Dig Stellar.

It must remain practical, explicit, and honest.

It is not a pitch document.  
It is an internal execution document used to answer:
- what already works
- what is partially working
- what is still fragile
- what is still placeholder or under-defined
- what is ready for beta use
- what still blocks tranche-aligned progress

This file should be updated regularly and kept aligned with:
- `docs/grant-roadmap.md`
- `docs/status-board.md`

---

## Overall project state

Dig Stellar is no longer at prototype stage.

The project already has:
- a live beta frontend
- a dedicated backend API
- an indexer layer
- real protocol data ingestion in multiple areas
- real wallet connection flows
- real grouped multi-wallet behavior
- real DB-backed wallet balance refresh flows

The project is now in a **transition phase** between:
- “functional beta with real foundations”
and
- “operational grant-aligned product ready for tranche progression and structured deployment”

The main challenge is no longer to invent the product, but to:
- stabilize data flows
- tighten backend/frontend boundaries
- reduce fragility
- align work with grant deliverables
- prepare for clean beta and later tranche execution

---

## Current product state

### What the product already is
Dig Stellar already functions as:
- a Stellar DeFi analytics interface
- a protocol and pool exploration interface
- a wallet-connected portfolio experience
- a grouped multi-wallet dashboard foundation
- a real-data product, not just a static concept demo

### What the product is not yet
It is not yet:
- a fully production-hardened mainnet platform
- a fully centralized API-only frontend across all data surfaces
- a finalized action execution platform
- a fully operational alerting / bridge monitoring / observability product

---

# 1. Frontend — `apps/web`

## Current status
**Substantially advanced, but not fully stabilized.**

## What already exists
The frontend already includes:
- a real dashboard structure
- a real protocol browsing experience
- pool detail views
- wallet connection UX
- wallet display and multi-wallet portfolio UX
- backend-driven wallet data in important flows
- a public beta that can be shown and used

## What is already working well
- general product direction is clear
- the app looks like a real product, not an internal tool
- wallet connection is visible and understandable
- wallet grouping behavior now works across multiple wallets
- pool/protocol pages already exist and are usable
- the frontend is far enough along that iteration is more important than invention

## What is partially working
The following areas are usable but still not fully “clean”:
- some top-level/global dashboard stats may still rely on direct external fetches from the frontend
- some loading/error states may still be inconsistent across views
- some UI zones may still combine real features and placeholder “coming soon” sections
- some product logic may still live too close to the frontend where it should be API-centered

## What is still weak or beta-level
- responsive behavior likely still needs a real pass
- stale/freshness states are not yet consistently surfaced
- certain sections may still require manual understanding to interpret correctly
- some UX areas are still more “founder-use beta” than “external-user polished beta”

## Frontend architecture direction
The frontend should increasingly become:
- a UI layer
- a composables/state layer
- a consumer of internal API contracts

It should increasingly stop being:
- a place where external analytics providers are called directly for core product data
- a place where business/data aggregation logic grows

## Current frontend priorities
1. centralize remaining external-facing stats behind the API
2. clean responsive behavior
3. standardize loading/error/stale behavior
4. clarify which sections are real vs deferred
5. keep product polish proportional to tranche goals

---

# 2. Backend API — `apps/api`

## Current status
**Already meaningful and structurally important, but not yet complete as the single frontend façade.**

## What already exists
The backend already includes:
- a NestJS API
- wallet-related routes
- wallet connect flow
- wallet grouping through backend `userId`
- wallet overview and balances endpoints
- wallet refresh endpoint
- protocol / pools endpoints in meaningful form
- Prisma integration and database-backed logic

## What already works well
- the backend is not a placeholder
- wallet-based grouping logic is real and useful
- the API already acts as the product backbone in several important flows
- wallet refresh + DB persistence + API retrieval is already demonstrable
- protocol/pool routes already provide real value to the frontend

## What is partially working
- the API is already central in many places, but not yet fully the only source for all dashboard data
- some frontend surfaces may still depend on direct external providers instead of API endpoints
- endpoint contracts may still be evolving rather than stabilized

## What is still weak or incomplete
- health/operational endpoints are likely still incomplete
- freshness exposure is probably not yet systematic
- the API may still be acting partly as a thin pass-through in some places instead of a proper façade
- some future grant-oriented capabilities (alerts, action execution, observability endpoints) are not yet structured

## Backend architecture direction
The backend should become the single authoritative UI-facing layer for:
- dashboard stats
- protocol analytics
- wallet grouping and balances
- future alerts
- future action preparation
- freshness and stale metadata

## Current backend priorities
1. move remaining product-critical data fetches behind the API
2. stabilize API contracts used by the frontend
3. add health/freshness visibility
4. keep business/data logic out of the frontend
5. prepare the backend to support the next tranche-oriented features incrementally

---

# 3. Indexer / data layer — `apps/indexer`

## Current status
**Real and already valuable, but still needs operationalization.**

## What already exists
The indexer layer already includes:
- dedicated scripts
- real data ingestion behavior
- wallet balance snapshot generation
- protocol-specific work for at least part of the Stellar DeFi ecosystem
- real writes into the DB used by the API/frontend

## What already works well
- the project already has a genuine data pipeline mindset
- this is not a “frontend-only beta”
- wallet snapshots are real and can be refreshed
- protocol data ingestion has clearly already started in meaningful ways
- the architecture choice to separate indexer from API is sound

## What is partially working
- several scripts likely work correctly when run manually
- some adapters/protocol flows are already real, but not yet uniformly documented
- the refresh model exists, but may not yet be fully standardized across all data domains

## What is still weak or incomplete
- cron/readiness is likely not fully formalized
- script ownership and naming may still need cleanup
- freshness tracking is probably not yet first-class across all sources
- stale detection and retry/backoff may still be partial
- operational runbooks are likely still too light

## Indexer architecture direction
The indexer must become:
- predictable
- schedulable
- explainable
- easy to debug
- clearly tied to the data expectations of the API

It should not remain a loose collection of scripts only the founder can reason about.

## Current indexer priorities
1. map exactly which scripts exist and what they feed
2. define which scripts are manual vs cron-ready
3. standardize operational usage
4. surface freshness/staleness more clearly
5. document source ownership by protocol/metric

---

# 4. Wallets / identity / portfolio model

## Current status
**A strong area relative to overall project maturity, but still beta-level in security/session modeling.**

## What already works
The following is already real:
- wallet session UI in frontend
- wallet address retrieval through wallet connect flow
- backend resolution of a persistent grouped `userId`
- grouped multi-wallet portfolio behavior
- adding secondary wallets to an existing portfolio group
- wallet overview and per-wallet balances
- wallet refresh flow from API to DB-backed balance snapshots
- wallet management operations such as select / refresh / delete / activate / primary in meaningful form

## What is now one of the strongest product areas
Compared to many other grant deliverables, this area is already meaningfully ahead because:
- the user model is no longer fake-hardcoded in the frontend
- multi-wallet grouping is functioning
- portfolio grouping is demonstrable
- the product now has a real “returning user with multiple wallets” foundation

## What is still weak / not final
- auth/session is still not a final cryptographic production model
- strong proof-of-ownership flows are not yet the final version
- “active signer” vs “watch-only” distinction is not yet fully explicit
- richer DeFi position aggregation beyond wallet balances may still be limited

## Current stance
This is acceptable for a beta phase.
The current model is strong enough to support portfolio/product iteration, but not yet the final security/session posture.

## Current wallet priorities
1. formalize the “active signer” vs “tracked wallet” model
2. keep the current multi-wallet foundation stable
3. avoid overcomplicating auth before tranche-critical data and dashboard work are stabilized
4. later, strengthen signature/session guarantees when action flows become more central

---

# 5. Protocol coverage / analytics reality

## Current status
**Real but unevenly formalized.**

## What appears already true
The product already has real integration work or visibility around:
- Blend
- Aquarius
- Soroswap
- Stellar network-level stats in some form
- wallet balance tracking against real chain data

There is also grant-level ambition around:
- DeFindex
- SDEX / native Stellar liquidity visibility
- bridge inflows
- protocol and asset-level flows

## What is likely true today
- some protocols are already far enough to support UI presence
- others are present conceptually or partially
- not all coverage is equally mature
- not all protocol data paths are equally clean or equally API-centralized

## What is still missing for clarity
The project still needs a more explicit source map:
- which protocol data is ingested via Horizon
- which is ingested via Soroban
- which is enriched via SDK/API
- which powers real UI today
- which remains partial or roadmap

## Current priority
Make protocol coverage explicit and auditable internally.
Right now, this is probably one of the biggest “understood by founder but not yet documented enough” areas.

---

# 6. Data freshness / reliability

## Current status
**Important but not yet fully operationalized.**

## What already exists
- real refresh flows exist
- real timestamps and snapshots already exist in some areas
- the architecture already supports freshness handling conceptually

## What is still incomplete
- stale data may not yet be clearly surfaced everywhere
- retries/backoff are likely not yet standardized
- there may still be ambiguity around freshness for different data domains
- UI may not always communicate data recency clearly

## Why this matters
This is critical for:
- tranche 1 data credibility
- tranche 3 freshness tracking promise
- user trust
- operational debugging

## Current freshness priorities
1. define freshness expectations per data type
2. expose timestamps/metadata where useful
3. identify stale/failing sources
4. progressively formalize retries/backoff

---

# 7. Notifications / alerting

## Current status
**Mostly early / pre-foundation.**

## What exists
- some notification-like UI exists
- the product direction clearly anticipates alerts and recommendations

## What likely does not yet exist in a real tranche-ready way
- persistent user alert rules
- evaluation engine
- notification generation lifecycle
- real rule-to-event pipeline

## Current stance
This should not be treated as “already almost there” just because some UI exists.
This is still mostly an upcoming build area.

---

# 8. On-chain actions / transaction builder

## Current status
**Still early relative to the grant.**

## What exists
- wallet connection exists
- wallet-aware UX exists
- product direction and architecture point toward future actions

## What does not yet appear tranche-ready
- a clear transaction builder layer
- one narrow end-to-end testnet action flow
- formal simulation UX
- clearly scoped XDR-building and prerequisite bundling

## Current stance
This remains one of the most important future areas, but not one of the most mature current ones.

---

# 9. Deployment / operations

## Current status
**Partially real, not yet fully operationalized.**

## What already exists
- a public beta exists
- local development works
- multiple application layers already exist in deployable form conceptually

## What is still incomplete
- final clean target deployment shape is not yet fully standardized
- indexer scheduling/cron still needs operational formalization
- observability is not yet mature
- runbooks are only now being structured

## Recommended near-term target
The current likely best deployment model remains:
- `apps/web` on Vercel
- `apps/api` on a small VPS or equivalent
- `apps/indexer` + cron in the same controlled server environment

## Why this matters now
The project is close enough to beta maturity that deployment discipline now matters a lot.
This is no longer something to postpone indefinitely.

---

# 10. What is strongest right now

The strongest current areas of the project are likely:
1. overall product direction and architectural separation
2. live beta existence
3. backend/API presence
4. grouped multi-wallet portfolio foundation
5. real wallet balance snapshot/refresh flows
6. protocol and pool exploration foundation

These are important because they mean the project already has real traction in implementation terms.

---

# 11. What is still most fragile right now

The most fragile or incomplete areas are likely:
1. remaining frontend dependence on external providers for some global stats
2. uneven protocol/data source formalization
3. freshness/stale/retry operationalization
4. transaction builder/action layer
5. alerting engine
6. bridge monitoring
7. deployment/observability maturity

---

# 12. Closest tranche-relevant wins

The nearest tranche-relevant wins likely are:
1. make Tranche 1 Deliverable 1 extremely explicit and evidenced
2. make Tranche 1 Deliverable 2 API-centered and visually coherent
3. define the minimum viable scope for Tranche 1 Deliverable 3
4. formalize the current multi-wallet system as groundwork for Tranche 2 Deliverable 1

---

# 13. Current execution priorities

## Immediate priorities
1. document current protocol/data coverage more explicitly
2. move remaining global/dashboard external calls behind internal API
3. formalize refresh/freshness operational behavior
4. clean responsive/UI consistency enough for serious beta usage
5. keep `grant-roadmap.md` and `status-board.md` aligned with reality

## What should not dominate right now
- over-engineering auth/session
- premature abstraction layers
- broad refactors not tied to a tranche need
- polishing low-value UI before stabilizing data and API boundaries

---

# 14. How to update this file

Update this file when:
- a feature moves from partial to stable
- a placeholder becomes real
- a new backend or indexer capability becomes operational
- deployment reality changes
- a previously fragile area becomes dependable
- a grant deliverable meaningfully advances

When updating, prefer brutal clarity over optimism.
This file is meant to improve decision quality, not morale.