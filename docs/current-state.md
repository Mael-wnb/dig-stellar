# Dig Stellar — Current State

## Purpose

This document captures the real, current state of Dig Stellar. It is an internal execution document,
not a pitch. It answers: what works, what is partial, what is fragile, what is still placeholder, and
what blocks tranche-aligned progress.

Keep it honest and aligned with `docs/grant-roadmap.md` and `docs/status-board.md`. Prefer brutal
clarity over optimism — this file improves decision quality, not morale.

---

## Overall project state

Dig Stellar is past prototype stage. It already has a live beta frontend, a dedicated backend API, an
indexer layer, real protocol data ingestion across Horizon and Soroban, real wallet connection, real
grouped multi-wallet behavior, and DB-backed wallet balance refresh flows.

The project is in a **transition phase**: from "functional beta with real foundations" toward
"operational, grant-aligned product that is clearly evidenced and tranche-claimable." The challenge is
no longer to invent the product but to stabilize data flows, tighten the API boundary, surface
freshness, and align work with the grant contract.

---

## Data architecture reality (read this first)

Three table families coexist in the same Postgres DB. This is the single most important thing to know,
and it corrects the older docs:

- **raw SQL v1 — the product pipeline.** `entities`, `venues`, `assets`, `entity_assets`,
  `pool_snapshots`, `reserve_snapshots`, `normalized_events`, `pool_metrics_latest`,
  `protocol_metrics_latest`, `asset_prices`, `sync_cursors` (defined in `apps/api/src/db/stellar_v1*.sql`).
  Written by `job:refresh` (`72-run-refresh-job.ts` → `71-refresh-all-metrics.ts` → per-protocol steps).
  Read by the `/v1/*` routes (`StellarController`).
- **raw SQL v2 — wallet layer.** `user_wallets`, `wallet_balance_snapshots`, `wallet_protocol_positions`
  (`stellar_v2_multiwallet.sql`). Read by `/v1/wallets/*` (`WalletsController`).
- **Prisma models — legacy / parallel.** `Protocol`, `Venue`, `Snapshot`. Written by
  `run:blend` / `run:horizon` / `run:once`; read only by the prefix-less `/protocols`, `/venues`,
  `/venues/:key/snapshots` routes (`AppController`). Not part of the product pipeline. Elsewhere the
  Prisma client is used only as a raw-SQL connection (`$queryRawUnsafe`), not as an ORM.

Bottom line: **`/v1/*` + raw SQL = the real product; Prisma `Protocol/Venue/Snapshot` = legacy.**
Ingestion *logic* lives in `apps/indexer/src/lib/protocols/<protocol>/`; `src/scripts/ingest/` holds
both live entry points and superseded legacy scripts. (See `docs/repo-structure.md` and
`docs/data-model.md`.)

---

## 1. Frontend — `apps/web`

**Substantially advanced, not fully stabilized.** Vue 3 + Vite + Tailwind.

Working: real dashboard structure, protocol browsing, pool detail views, wallet connection UX,
multi-wallet portfolio UX, backend-driven data in the important flows, a public beta that can be shown.

Partial / weak: some global/network stats still reach external providers directly via
`GET /v1/network/stats` (see §2); loading/error/stale states are not yet consistent; responsive
behavior needs a real pass; some zones still mix real features and "coming soon" placeholders.

Direction: become a pure UI + composables/state + internal-API-consumer layer. Stop hosting data
aggregation or calling external analytics providers for core data.

Priorities: (1) centralize remaining external-facing stats behind the API; (2) responsive pass;
(3) standardize loading/error/stale; (4) clarify real vs deferred sections.

---

## 2. Backend API — `apps/api`

**Meaningful and structurally central, but not yet the single façade for every surface.** NestJS 11.

Working: wallet routes (connect, overview, balances, refresh, primary/active/delete), wallet grouping
by persistent `userId`, protocol/pool routes serving real indexed data via `/v1/*` (raw SQL),
Prisma client used as the DB connection for raw queries.

Partial / weak: health/operational endpoints incomplete; freshness not yet exposed systematically in
responses; **`GET /v1/network/stats` (`NetworkController`) does no DB access at all** — it calls
CoinGecko, DefiLlama, stellar.expert, and Horizon live, with no persistence or freshness. That is the
concrete "core data still fetched externally" item for T1-D2.

Direction: be the single authoritative UI-facing layer for dashboard stats, protocol analytics, wallet
data, freshness metadata, and (later) alerts and action preparation.

Priorities: (1) move `/v1/network/stats`-type fetches behind a persisted, fresh API surface;
(2) stabilize the contracts the frontend depends on; (3) add health + freshness visibility.

---

## 3. Indexer / data layer — `apps/indexer`

**Substantially advanced and already powering the product.** Runner: tsx.

Working: Horizon + Soroban ingestion; protocol adapters in `lib/protocols/`; canonical refresh chain
`job:refresh` → 72 → 71 → per-protocol steps; persistence of asset prices, pool/reserve snapshots,
pool + protocol metrics; wallet balance snapshot generation; cron-compatible jobs; real writes to
Postgres consumed by the API.

Operational protocol coverage (verified in DB, Jun 5, 2026):
- Soroban — Blend, Soroswap, Aquarius
- Horizon — Stellar native DEX liquidity pools

Partial / weak: retry/backoff not standardized; health visibility limited; observability lightweight;
some adapters under-documented; DeFindex scaffolded (`run:defindex`, `@defindex/sdk`) but **not
validated** — and it belongs to **T3-D1**, not T1-D1.

Direction: move from "collection of ingestion scripts" to a documented ingestion platform with
predictable refresh behavior and surfaced freshness.

Priorities: (1) document protocol ownership + source mapping; (2) formalize refresh cadence
expectations; (3) surface freshness; (4) standardize retry/backoff; (5) expand coverage per roadmap.

---

## 4. Wallets / identity / portfolio model

**Strong relative to overall maturity, still beta-level on security/session.**

Working: wallet session UI; address retrieval via wallet connect; backend resolution of a persistent
grouped `userId`; grouped multi-wallet portfolio; adding secondary wallets; per-wallet balances;
refresh flow from API to DB-backed snapshots (raw SQL v2); select/refresh/delete/activate/primary
operations. The user model is no longer hardcoded in the frontend — there is a real "returning user
with multiple wallets" foundation.

Weak / not final: auth/session is not a final cryptographic production model; strong
proof-of-ownership is not the final version; **"active signer" vs "watch-only" is not yet explicit**
(this is the exact T2-D1 gap); DeFi position aggregation beyond balances is still limited.

Stance: acceptable for beta. Formalize active-signer vs watch-only next; do not over-engineer auth
before T1 data/dashboard work is closed.

---

## 5. Protocol coverage / analytics reality

**Real, operational, and demonstrable.** Verified by direct DB inspection on June 5, 2026.

| Protocol | Source | Pools | TVL (verified) | State |
|---|---|---:|---|---|
| Blend | Soroban RPC | 3 | ≈ $156.7M | operational |
| Aquarius | Soroban RPC | 4 | ≈ $21.0M | operational |
| Soroswap | Soroban RPC | 2 | ≈ $0.57M | operational |
| Stellar native DEX | Horizon | — | — | operational (liquidity pools indexed) |
| Wallet balances | Horizon + Stellar RPC | — | — | operational |

All metric rows had non-null, non-zero TVL and a synchronous `as_of` within one `job:refresh` cycle.
(Note: an earlier static-code reading suggested Soroswap/Aquarius TVL might be 0 because
`reserve_snapshots` is Blend-written; the runtime data disproves that — their TVL is populated. The
exact computation path for Soroswap/Aquarius TVL is worth documenting but is not a defect.)

Remaining gaps: DeFindex (T3), protocol source documentation, freshness visibility, operational docs,
stronger retry/backoff. The implementation largely exists; the remaining work is documentation,
operationalization, and freshness exposure.

---

## 6. Data freshness / reliability

**Partially operationalized.**

Exists: refresh jobs; persisted timestamps across snapshots/metrics (`snapshot_at`, `as_of`,
`occurred_at`, `observed_at`); scheduled refresh; a recent synchronous refresh cycle is verifiable.

Incomplete: freshness metadata is not consistently exposed through the API; stale detection is not
first-class; retries/backoff are protocol-specific, not standardized; health visibility is limited.

Why it matters: T1-D1 data credibility, the T3-D1 freshness-tracking promise, user trust, and
debugging. Priorities: (1) expose freshness in API responses; (2) define expected intervals per
dataset; (3) auto-detect stale sources; (4) standardize retry/backoff; (5) minimal ingestion health
visibility.

---

## 7. Notifications / alerting

**Pre-foundation.** Some notification-like UI exists, and product direction anticipates alerts. What
does not yet exist in a claimable way: persistent user alert rules, an evaluation engine, a
notification lifecycle, a rule-to-event pipeline. Do not treat this as "almost there." For T2-D2 the
contract only requires rule storage + evaluation against the snapshot DB + in-app notifications — build
the smallest version of that, not the sub-minute event stream from the architecture doc.

---

## 8. On-chain actions / transaction builder

**Early relative to the grant.** Wallet connection and wallet-aware UX exist; the builder layer does
not. Missing: a transaction builder, one narrow end-to-end Testnet action, simulation UX, scoped
XDR-building with prerequisite bundling. This is the real T1-D3 gap and it gates T3-D2.

---

## 9. Deployment / operations

**Partially real, not yet operationalized.** A public beta exists; local development works
(`docker compose` → Postgres 16 + Redis 7); app layers are deployable in principle.

Incomplete: a standardized target deployment shape; formalized indexer scheduling/cron; mature
observability; runbooks (being structured now). Likely near-term target: `apps/web` on Vercel,
`apps/api` on a small VPS, `apps/indexer` + cron in the same controlled environment. Deployment
discipline now matters — the project is close enough to beta maturity that this can no longer be
postponed indefinitely.

---

## 10. Strongest right now
1. Product direction + architectural separation (web / api / indexer)
2. Live beta
3. Verified indexing foundation (coverage + freshness)
4. Backend/API presence and the `/v1` raw-SQL product pipeline
5. Grouped multi-wallet portfolio foundation (raw SQL v2)
6. Real wallet balance snapshot/refresh flows

## 11. Most fragile right now
1. Transaction builder / action layer
2. Alerting engine
3. Bridge monitoring
4. Freshness/stale/retry operationalization + observability
5. Deployment maturity
6. Remaining external-provider dependency (`/v1/network/stats`)

## 12. Closest tranche-relevant wins
1. Make T1-D1 explicit and evidenced (evidence package; resolve endpoint note)
2. Make T1-D2 API-centered (network stats) and visually coherent
3. Scope T1-D3 to ONE Testnet action
4. Formalize the multi-wallet system as groundwork for T2-D1

---

## 13. Current execution priorities
1. Document current protocol/data coverage explicitly (feeds the T1-D1 evidence package)
2. Move `/v1/network/stats`-type external calls behind a persisted internal API
3. Operationalize refresh/freshness behavior (exposure, stale detection, retry/backoff)
4. Clean responsive/UI consistency enough for serious beta usage
5. Keep `grant-roadmap.md` and `status-board.md` aligned with reality

What should not dominate now: over-engineering auth/session, premature abstraction layers, broad
refactors not tied to a tranche need, or polishing low-value UI before stabilizing data/API boundaries.

---

## 14. How to update this file
Update when a feature moves from partial to stable, a placeholder becomes real, a new backend/indexer
capability becomes operational, deployment reality changes, a fragile area becomes dependable, or a
grant deliverable meaningfully advances. Prefer brutal clarity over optimism.