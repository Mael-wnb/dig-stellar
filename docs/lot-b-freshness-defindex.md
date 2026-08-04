# Lot B — Freshness System + DeFindex (T3-D1) — Implementation Brief

Execution brief for Claude Code. Serves **T3-D1 — Mainnet Deployment & Freshness Tracking**
(SCF date **Aug 10** — the earliest contract date of the T3 group). Verbatim criteria:

> - Production deployment with real Mainnet data for Blend V2, SDEX, Soroswap, Aquarius, and
>   **DeFindex**.
> - The system monitors source latency: if a protocol becomes "stale", the UI explicitly
>   indicates it and the indexer performs retries with exponential backoff.

Current reality: 4 of the 5 protocols are live in prod (15-min cron). The gap = DeFindex +
the freshness system (stale detection, UI indicator, standardized backoff). Written 2026-08-02
against current `main`; re-verify file states before editing.

**Two sub-lots, independently landable. B2 (DeFindex) is the higher-risk one — start it first.**

---

## Sub-lot B2 — DeFindex in the v1 product pipeline

**CRITICAL CONTEXT — do not "finish" the existing scaffold as-is.** `src/run-defindex.ts` writes
to the Prisma legacy tables (`Protocol/Venue/Snapshot`) which the product does NOT read (see
`docs/current-state.md` § data architecture). For the criterion to be met, DeFindex must land in
the **raw SQL v1 pipeline**: `venues`/`entities` → `pool_metrics_latest` → step-70 protocol
aggregation → `/v1/protocols` (protocolCount = 5) → dashboard. The legacy scaffold can remain as
reference but the deliverable is a v1-pipeline integration, patterned on the existing protocols.

1. **Bootstrap** `scripts/bootstrap/defindex-upsert-core.ts` (mirror `aquarius-upsert-core.ts`):
   venue `defindex`, one entity per vault (`entity_type` consistent with the schema's allowed
   values — check `stellar_v1.sql`; use the closest fit for a yield vault), `contract_address` =
   vault address, `is_active = true`.
2. **Vault selection**: 1–3 real mainnet vaults with non-trivial TVL, discovered from DeFindex's
   own app/API (never from memory). Record address + evidence (name, TVL at seed time) in the
   bootstrap comments.
3. **Refresh step** `scripts/ingest/run-defindex-refresh.ts` + `lib/protocols/defindex/`
   (fetch → compute → persist, mirroring the structure of the other adapters): per-vault TVL
   (USD) and APY into `pool_metrics_latest` (+ pool snapshot row if the schema expects one),
   with a proper `as_of`. Primary data source: `@defindex/sdk` (already a dependency) —
   **requires `DEFINDEX_API_KEY`** (see Open prerequisites below). Wire into
   `71-refresh-all-metrics.ts` as a **non-fatal** step before step 7 (protocol aggregation), so
   `70-protocol-persist-metrics.ts` folds DeFindex into `protocol_metrics_latest`.
4. **Verify step 70 + the API need no hardcoded-protocol changes** (they should be venue-driven;
   if any hardcoded list of 4 exists anywhere — API mappers, web protocol meta/logos — extend
   it: DeFindex logo already exists at `apps/web/src/assets/protocols/defindex-logo.svg`).
5. **Validation**: run the refresh locally against mainnet; then in prod: `/v1/protocols` shows
   `defindex` with non-null TVL and an advancing `as_of` across two cron cycles;
   `protocolCount` = 5; dashboard shows the DeFindex protocol card with real data.

**Prerequisites (resolved 2026-08-02):**
- `DEFINDEX_API_KEY` is **self-serve**: register at `https://api.defindex.io/register`, log in,
  generate `api_key` from the dashboard (Bearer auth on every request). Maël handles the
  registration; the key goes in the indexer env.
- Contract addresses: the public registry `defindex-io/stellar-contracts` →
  `public/mainnet.contracts.json` lists the factory
  (`CDKFHFJIET3A73A2YN4KV7NSV32S6YGQMUFH3DNJXLBWL4SKEGVRNFKI`) and the strategies (USDC/EURC/XLM
  Blend-autocompound, Etherfuse family). **Strategies are NOT vaults** — the entities we index
  are deployed vaults with TVL. Enumerate them via the API (full reference:
  `https://api.defindex.io/docs`) or the factory on-chain; a request for the canonical/flagship
  vault list is also pending with the PaltaLabs team on their Discord — prefer their answer if
  it arrives first.
- Fall back to on-chain vault reads via Soroban RPC only if the API path fails — flag it and
  re-estimate before committing to that path.

---

## Sub-lot B1 — Freshness first-class (stale detection → UI → backoff)

Beta-first principle: **staleness is computed at read time in the API** (no new indexer state),
and **retries live in the indexer orchestrator** (one mechanism, all steps).

1. **API — freshness metadata on the read path** (`apps/api`, `/v1/*` — `StellarController` /
   `stellar.service.ts`): every protocol/pool payload that carries an `as_of` also carries
   `isStale: boolean` and `staleAfterSeconds`. Stale = `now − as_of > STALE_AFTER` with
   `FRESHNESS_STALE_AFTER_MINUTES` env, default **45** (3× the 15-min cron — one missed cycle is
   tolerated, two is stale). Add the same to `/v1/network/stats`. No schema change: computed in
   the mapper.
2. **Web — explicit staleness indicator** (the criterion names the UI):
   - A small freshness chip on the Protocol View header area: "Updated Xm ago", turning to an
     explicit amber "Stale — data older than 45m" state when any displayed protocol `isStale`.
   - Per-protocol: a stale badge on the protocol card/tab and on `PoolDetail` when that
     protocol's data is stale.
   - Reuse the existing muted/amber styles; no redesign (the sidebar/UX pass is T3-D3).
3. **Indexer — standardized exponential-backoff retries** (`71-refresh-all-metrics.ts`):
   replace direct `runTsx(...)` calls with `runTsxWithRetry(script, env, { attempts: 3,
   baseDelayMs: 5000 })` — exponential (5s → 20s → fail) + jitter, logging each retry with the
   step name. Per-protocol-entity steps retry per entity. Steps already wrapped in try/catch
   (Aquarius, Allbridge, network-stats) keep their non-fatal behavior — retries happen INSIDE
   first, catch-and-log stays the last resort. Helper in `scripts/shared/retry.ts`.
4. **Runbook**: document the freshness thresholds, the retry policy, and the forced-stale drill
   (below) in `docs/runbooks.md`.

**Evidence capture (claim material — save outputs to `docs/evidence/`):**
- Forced-stale drill: pause the cron (or set `FRESHNESS_STALE_AFTER_MINUTES=1` briefly on the
  API), screenshot the UI showing the explicit stale indicator, restore, screenshot recovery.
- A refresh log excerpt showing a step failing → backoff retries firing → recovery (can be
  simulated locally by pointing one step at an unreachable RPC URL).

---

## Definition of done

- `pnpm -C apps/web test` · `pnpm -C apps/web build` · `pnpm -C apps/api build` green; indexer
  runs `job:refresh` clean locally.
- `/v1/protocols` (prod): 5 protocols incl. `defindex`, non-null TVL, advancing `as_of`, and
  `isStale=false` in steady state.
- UI: freshness chip + stale badges render (steady state and forced-stale drill).
- Retry helper exercised (log evidence) and wired for every step of the refresh chain.
- Docs updated: `runbooks.md` (freshness + retry + drill), `security-invariants.md` untouched
  (not a security-surface change), status docs flagged for the next sync pass.

## Out of scope

Sub-minute freshness/event streams · RPC latency percentile metrics + error-rate endpoints
(T3-D3) · alerting on staleness (T2-D2 engine exists; wiring a stale-source alert family is
post-beta) · DeFindex user positions (portfolio is Blend-only by design) · any deposit/withdraw
actions on DeFindex (out of the grant's action scope).
