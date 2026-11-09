# Lot PRE — PRE0 recon: bridge card and "Building history since now"

Read-only recon on `feat/lot-pre` (from `main` @ e4350b1, clean). No code change. Dated 2026-11-03.
Prod figures below come from `https://stellar-api.getdig.ai` and `https://stellar.getdig.ai`
at ~20:16 UTC; local DB figures come from the local Postgres whose last refresh is
**2026-10-30 19:08 UTC** (local cadence is manual, not 15-min, so local row counts are not prod's).

---

## Defect A — bridge card on the dashboard

### A1. Every place the bridge surfaces in `apps/web`

| # | File | Lines | What |
|---|------|-------|------|
| 1 | `components/views/DashboardView.vue` | 8 (header comment), 16 (`import { useBridge }`), 25 (`import BridgeSection`), 128–147 (destructure of `useBridge()`), 276–294 (`<BridgeSection …/>` block) | The dashboard section. Only wiring site of `useBridge()`. `useBridge` self-loads on `onMounted` (`useBridge.ts:403`) → 3 `/v1/bridge/*` calls per dashboard mount. |
| 2 | `components/bridge/BridgeSection.vue` | whole file; banner copy 91–101 ("No bridge activity for N days. The underlying bridge protocol (Allbridge) may be paused or experiencing low activity." + "Learn more ↗"); header 112–119 ("Bridge inflows to Stellar", "…, Allbridge attribution") | The card. Imports `BridgeChart`, `BridgeRoutesTable`, `BridgeFlowsFeed`, `bridgeAnnotations`, `isBridgeUpstreamPaused`. |
| 3 | `components/bridge/BridgeChart.vue` | whole file; imports `bridgeAnnotations` (7) | Chart. Only used by BridgeSection. |
| 4 | `components/bridge/BridgeRoutesTable.vue` | whole file | Only used by BridgeSection. |
| 5 | `components/bridge/BridgeFlowsFeed.vue` | whole file (uses `BrandLogo`, `stellarExpertTxUrl`) | Only used by BridgeSection. |
| 6 | `composables/useBridge.ts` | whole file (1–~410). Exports `BRIDGE_UPSTREAM_STALE_DAYS` (46), `isBridgeUpstreamPaused` (58), `useBridgeUpstreamPaused` (68), chain map (84–~150), `useBridge` (211) | Data composable + the shared "upstream paused" condition. |
| 7 | `components/views/StatusView.vue` | 12 (`import { useBridgeUpstreamPaused }`), 18–20 (call → fetches `/v1/bridge/flows?limit=1` on every status-page mount), 114–121 (`rowLabel`: appends "(upstream paused)" to the `step:allbridge` row) | Status page Allbridge row suffix. The row itself comes from `/v1/ops/status` (`refresh_step_runs`), not from web. |
| 8 | `api/bridge.ts` | whole file (types + `fetchBridgeSummary/Flows/Series`) | API client. |
| 9 | `config/bridgeAnnotations.ts` | whole file (one annotation: 2026-07-20 "Allbridge Core paused (security incident)" + crypto.news URL) | Used by BridgeSection + BridgeChart only. |
| 10 | `constants/bridgeChains.ts` | whole file | Chain symbol → display map. Used by `useBridge.ts` only. |
| 11 | `components/views/ProtocolsView.vue` | 40 (`bridge: 'Bridge'` in `VENUE_TYPE_LABEL`) | Label map only. Cards are built from `/v1/pools` (lines 79–92), and allbridge has 0 pools → **no Allbridge card renders**. `/v1/protocols` is only the additive chip source. Harmless to keep. |
| 12 | `components/NetworkTvlChart.vue` | 4 (comment "pattern as BridgeChart") | Comment only. |
| 13 | `components/earn/LeaderboardTable.vue` | 2 (comment "from the BridgeRoutesTable pattern") | Comment only. |
| 14 | `api/notifications.ts` | 3 (comment "mirroring api/bridge.ts") | Comment only. |
| 15 | `utils/format.ts` | 118 (comment "mirrors … BridgeFlows.vue") | Comment only. |
| 16 | `lib/explorer.ts` | 6 (comment "(bridge flows)") | Comment only. |
| 17 | `components/modals/ConnectModal.vue`, `composables/useNetworkTvl.ts` | "web-bridge wallets" / "never bridges them" | Unrelated meaning of "bridge". Not touched. |

Not a surface: sidebar (`shell/AppSidebar.vue`, no bridge entry), `FreshnessChip` (fed by
`/v1/network/stats` only), "Protocols tracked" tile (`DashboardView.vue:99` ← `network_stats_latest.protocol_count`
← `count(*) from protocol_metrics_latest` = **6**, allbridge has no row), dashboard protocol
summary (from `/v1/pools`, no bridge pools). No `*.spec.ts` references the bridge (web specs: 12 files, none bridge).

### A2. What removing the dashboard section leaves dead

| Item | After removing DashboardView 16, 25, 128–147, 276–294 | Recommendation |
|------|------------------------------------------------------|----------------|
| `components/bridge/BridgeSection.vue`, `BridgeChart.vue`, `BridgeRoutesTable.vue`, `BridgeFlowsFeed.vue` | Dead (no other importer) | **Delete.** `vue-tsc -b` does not flag unused components, so dead files would silently linger; git history keeps them for an "Allbridge Next" reintegration. |
| `config/bridgeAnnotations.ts` | Dead (only BridgeSection/BridgeChart) | **Delete** with the components. |
| `constants/bridgeChains.ts` | Dead once `useBridge()` goes | **Delete** with `useBridge`'s chain map. |
| `composables/useBridge.ts` → `useBridge()` (211–~405) incl. chain map, bucket/route/flow view models | Dead | **Delete** the `useBridge()` function and the chain map. |
| `composables/useBridge.ts` → `isBridgeUpstreamPaused`, `useBridgeUpstreamPaused`, `BRIDGE_UPSTREAM_STALE_DAYS` | **Still used** by `StatusView.vue` (Allbridge row suffix "(upstream paused)") | Decision needed, see below. Founder lean "keep only if something else uses them" → this is the one thing that does. |
| `api/bridge.ts` | Used only by `useBridge.ts` | If the status suffix stays: keep `fetchBridgeFlows` + its types, drop `fetchBridgeSummary/Series` + their types. If the suffix goes: **delete** the file. |
| Web tests | None exist for the bridge | Nothing to delete/update. |

Status-page suffix: the `step:allbridge` row on `/#status` will keep reporting `ok` because the
indexer step still runs and succeeds (see A3). With the pause now permanent, "(upstream paused)"
is still true but implies a transient state; the honest row label is a fixed one. Recommended:
drop `useBridgeUpstreamPaused` from StatusView (removes one `/v1/bridge/flows` call per status
mount) and rename the label in the API (`ops/status.ts:89` `STEP_LABELS.allbridge` →
e.g. "Allbridge bridge flows (historical)"). That rename is an `apps/api` change (VPS deploy);
if PRE must stay web-only, keep the suffix code as-is and rename later. Either way
`useBridge.ts` shrinks to ≤ 30 lines or disappears.

### A3. The `allbridge` venue row and "flipping is_active"

**There is no `is_active` on `venues`** (`stellar_v1.sql:3–13`: id, slug, name, chain, venue_type,
logo_url, metadata, created_at, updated_at). `is_active` exists only on `entities`, and allbridge
has **0 entities** (local: `entities=0`; prod `/v1/pools`: no allbridge pool). So "flip is_active"
has no target. What each surface does today, and what would change under the only two levers
that exist (leave the row, or delete it):

| Surface | Today (prod, 2026-11-03) | Reads `is_active`? | If the venue row were deleted |
|---------|--------------------------|--------------------|-------------------------------|
| `GET /health` (`app.controller.ts:40–60`) | `{"venue":"allbridge","asOf":null,"ageSeconds":null,"isStale":null}`; overall `status:"ok"` (null `isStale` never degrades: `freshness.ts:39–41`) | No, `select … from venues left join protocol_metrics_latest` | Entry disappears. Nothing else changes. |
| `GET /v1/protocols` (`stellar.service.ts:271–286`) | Row `{"slug":"allbridge","type":"bridge","tvlUsd":null,"updatedAt":null,…}`; **not rendered** as a card (ProtocolsView cards come from `/v1/pools`) | No | Row disappears. OpenAPI line 92 "(AMM, lending, vault, bridge)" would need the "bridge" word removed. |
| `GET /v1/ops/status` + `/#status` | `step:allbridge` `state:"ok"` from `refresh_step_runs` (`status.ts:324–370`) | No; derived from step runs, not venues | Unchanged: the step still runs and logs SUCCESS. |
| "Protocols tracked" tile / `network_stats_latest.protocol_count` (`73-network-stats-refresh.ts:258–261`) | 6 (counts `protocol_metrics_latest` rows; allbridge has none) | No | Unchanged. |
| Indexer step 8 (`71-refresh-all-metrics.ts:407–411` → `run-allbridge-bridge-refresh.ts`) | Runs every cycle, unconditionally; fetches `getEvents` on the Core contract, finds nothing, logs "No bridge flows in window — nothing to persist." and exits 0 → `refresh_step_runs` SUCCESS (prod `/v1/ops/metrics`: `lastStatus:"SUCCESS"`, ~2.2 s) | No; does not touch `venues` | Unchanged (the step never reads the venue row). Still 1 RPC `getEvents` scan per cycle. |
| `/v1/bridge/*` (`bridge.service.ts:129, 211, 275`) | `from bridge_flows where …` only. Prod: `summary?window=30d` → `lastFlowAt:null`, totals 0; `flows?limit=1` → last flow **2026-07-19T18:33:09Z** (inflow, $8,063). Local DB: 419 rows, 2026-06-15 → 2026-07-08 | No; **does not join venues** | Unchanged. |
| `allbridge-upsert-core.ts` bootstrap (docs/runbooks.md:84, 484; deployment.md:44) | Re-creates the venue + USDC asset on `on conflict` | — | Would re-insert the row on the next bootstrap run. |

**Recommendation: do not touch the venue row** (nothing to flip; deleting it buys nothing and
breaks the bootstrap's idempotence story). Two optional hygiene points, both `apps/api`/indexer
(⇒ VPS deploy), neither required for the dashboard fix:
1. Rename `STEP_LABELS.allbridge` (`status.ts:89`) to a historical label (see A2).
2. Optionally gate step 8 behind an env flag (e.g. `ALLBRIDGE_REFRESH_ENABLED`) so the cron stops
   issuing a pointless `getEvents` every 15 min; the `/#status` row then disappears from the 24h
   window naturally. Founder call: it also removes the "step ok" evidence of the adapter being wired.
   Not recommended for PRE; note it for Lot RP (RPC cost).

### A4. Docs that state the pause as temporary — exact lines to rewrite

| File | Lines | Current wording | Rewrite to |
|------|-------|-----------------|------------|
| `docs/runbooks.md` | 593–598 | "**Known expected-dormant venue: `allbridge` …** Allbridge Core has been paused since the 2026-07-20 … no relaunch announced as of 2026-08-20 … The dashboard bridge card frames this honestly as an upstream pause (self-clearing banner). If Allbridge relaunches, this note is the trigger to re-enable freshness expectations for the venue." | Allbridge Core is being wound down (operator announcement: Core/Classic stop in their current form, successor "Allbridge Next"); the adapter listens to the Core contracts and will not see further flows; `asOf:null` is permanent and by design; no dashboard card since Lot PRE; `/v1/bridge/*` serves the historical record (last flow 2026-07-19); reintegration = a new Allbridge Next adapter if it has Stellar contracts that emit events. |
| `docs/runbooks.md` | 596–597 | "The dashboard bridge card frames this honestly as an upstream pause (self-clearing banner)." | Delete (card removed). |
| `docs/status-board.md` | 412 (T2-D3 row) — the "Venue expected-dormant: … no relaunch announced as of 2026-08-20 — `/health` shows `allbridge` `asOf: null` by design, the bridge card banners it as an upstream pause. Note in `docs/runbooks.md` is the re-enable trigger." cell, and "(3) Dashboard bridge section: one full-width Paul-DA card … Wired into `DigDashboard.vue`." in the evidence cell | Keep the delivered evidence as history (the SCF criteria were met and paid); add a dated note: dashboard card removed in Lot PRE (date) because Allbridge Core is wound down; API + data kept as historical record. Also fix the stale reference `DigDashboard.vue` → `DashboardView.vue` was the as-built before removal. |
| `docs/status-board.md` | 432 | "Grouped multi-wallet portfolio + live alerting + bridge monitoring (T2 group, in prod)" | "… + bridge-flow API (historical record; dashboard card retired, Lot PRE)". |
| `apps/api/openapi/openapi.v1.yaml` | 300–302 (`/v1/bridge/summary`) | "**Upstream pause:** … paused by its operator since 2026-07-20; until it relaunches, recent windows legitimately contain zero flows and `lastFlowAt` reflects the last flow before the pause." | "**Historical record:** Allbridge Core on Stellar stopped emitting flows on 2026-07-19 and is being wound down by its operator; windows after that date contain zero flows and `lastFlowAt` is the last recorded flow. The endpoint stays stable." |
| `apps/api/openapi/openapi.v1.yaml` | 326–327 (`/v1/bridge/flows`) | "Same upstream pause as `/v1/bridge/summary`: the feed shows the last flows recorded before 2026-07-20 until the bridge relaunches." | "Same historical record as `/v1/bridge/summary`: the feed is the flows recorded up to 2026-07-19." |
| `apps/api/openapi/openapi.v1.yaml` | 360–361 (`/v1/bridge/series`) | "Same upstream pause as `/v1/bridge/summary`." | "Same historical record as `/v1/bridge/summary`." |
| `apps/api/openapi/openapi.v1.yaml` | 92 | "One row per tracked venue (AMM, lending, vault, bridge)" | Accurate as long as the venue row stays (recommended); leave. |
| `apps/api/openapi/openapi.v1.yaml` | 19, 52 | tag/intro "bridge flows" | Leave (endpoints stay). |
| `docs/current-state.md` | 19 ("bridge-flow monitoring"), 126(c) ("honest empty states on the dashboard protocols summary + bridge"), 139–142 (G1 bridge chain logos / bridge feed) | Narrative history | Leave as dated history; add one dated paragraph in the current section: dashboard bridge card retired (Lot PRE), why, what remains. |
| `docs/current-state.md` | 269 | public tier lists `/v1/bridge/*` | Leave (still public, still served). |
| `CLAUDE.md` | 219 | "3. **T2-D3 — Bridge Flow Monitoring** — code-complete, VPS deploy pending." | Already stale (paid Aug 2026). Rewrite: "T2-D3 — Bridge Flow Monitoring — delivered and paid; Allbridge Core is wound down, dashboard card retired (Lot PRE, date); `/v1/bridge/*` + `bridge_flows` + adapter kept as historical record." |
| `docs/internal/history/grant-roadmap.md` | 45, 312–350, 491–495 | delivery narrative ("live in prod", "dashboard bridge section is now the full Paul-DA card") | Keep as the delivered-state record; add a dated "post-delivery" note under §T2-D3 (one paragraph). |
| `docs/TECHNICAL_ARCHITECTURE.md` | 73, 228, 274, 434–436, 677 | Allbridge as the bridge integration | Add one sentence at 434–436: Core wound down; adapter retained; successor integration = Allbridge Next, if event-emitting Stellar contracts exist. |
| `apps/web/src/config/bridgeAnnotations.ts` | 14 | "Allbridge Core paused (security incident)" | Deleted with the card (A2). |
| `docs/runbooks.md` | 665 | fixture step list includes `('allbridge')` | Leave (the step still runs). |

Public-repo wording: "wound down / stopped operating in its current form / historical record";
no "incident", "exploit" or "hack" in new text. The existing runbooks line 594 mentions the
exploit; the rewrite drops it.

---

## Defect B — "Building history since <now>" on venues that will never get one

### B1. `/v1/pools/{slug}/series` — query, sources, shapes

Route: `stellar.controller.ts:42` → `StellarService.getPoolSeries` (`stellar.service.ts:967–1048`).

| Step | SQL / logic |
|------|-------------|
| 1. Resolve pool | `select e.id, e.entity_type, v.venue_type, v.slug from entities e join venues v … where e.slug=$1 and e.is_active=true limit 1` (404 otherwise) |
| 2. Gate | `isLending = venue_type='lending' or entity_type='lending_pool'`. **Non-lending → early return** `{covered:false, kind:'tvl', points:[], first:null, last:null, updatedAt: new Date()}` (lines 984–995). No query runs. |
| 3. Lending only | `select rs.snapshot_at, day, sum(amount × fresh price) as tvl_usd from reserve_snapshots rs left join lateral (latest fresh asset_prices) … where rs.entity_id=$1 group by rs.snapshot_at order by snapshot_at` with `amount = b_supply_scaled` (Blend) or `metadata->>'cash'` (XOXNO). Reduced in JS to one point per UTC day (last wins). `covered = points.length >= 2`. |
| 4. `updatedAt` | Always `new Date().toISOString()` (request time), both branches (lines 993, 1046). |

Source tables: `entities`, `venues`, `reserve_snapshots`, `asset_prices`. Never `pool_snapshots`.

Prod shapes (2026-11-03 20:16 UTC):

| Pool | Venue / type | Response |
|------|--------------|----------|
| `defindex-meru-usdc` | vault (`yield_vault`) | `{"covered":false,"kind":"tvl","points":[],"first":null,"last":null,"updatedAt":"2026-11-03T20:16:34.111Z"}` |
| `aquarius-aqua-usdc-pool` | AMM (`amm_pool`) | `{"covered":false,…,"points":[],"first":null,"last":null,"updatedAt":"2026-11-03T20:16:34.288Z"}` |
| `stellar-native-aqua-usdc-pool` | AMM (`amm_pool`) | `{"covered":false,…,"points":[],"first":null,"last":null,"updatedAt":"2026-11-03T20:16:34.430Z"}` |
| `blend-fixed-pool` | lending | `{"covered":true,"kind":"tvl","points":[187],"first":"2026-03-19","last":"2026-11-03","updatedAt":…}` |
| `xoxno-core-hub` | lending | `{"covered":true,"points":[5],"first":"2026-10-30","last":"2026-11-03",…}` |

The web does not fall back to the series' `updatedAt`.
The "since" date is the **pool detail's** `updatedAt` (`/v1/pools/{slug}` → `pool_metrics_latest.as_of`,
the last refresh tick). Prod `defindex-meru-usdc` detail: `updatedAt: 2026-11-03T20:04:51Z`
(`ageSeconds: 704`). So the date moves every 15 min, not on every page load, which the founder
capture at 20:49 local (= 19:49 UTC, a refresh tick) is consistent with. Same visible defect.

### B2. Does any table hold one TVL point per pool per refresh for ALL venue types?

**No table holds a USD TVL point per pool per refresh.** `tvl_usd` exists only on
`pool_metrics_latest` (single-row upsert, no history), `protocol_metrics_latest`, `network_tvl_snapshots`.
What exists per refresh, on the live `job:refresh` path, is raw state from which TVL is reconstructable:

| Venue | Type | Per-refresh history table (live writer) | What the row carries | Local first row | Local last row | Local rows / pools |
|-------|------|------------------------------------------|----------------------|-----------------|----------------|--------------------|
| blend | lending | `reserve_snapshots` (`blend/persist-pool-state.ts`) + `pool_snapshots` | `b_supply_scaled`, `d_supply_scaled` per reserve | 2026-03-19 15:41 | 2026-10-30 18:58 | 1,035 / 4 |
| xoxno | lending | `reserve_snapshots` (`xoxno/persist-hub-state.ts`) + `pool_snapshots` | `metadata.cash` per reserve | 2026-10-26 18:57 | 2026-10-30 19:08 | 260 / 3 |
| aquarius | AMM | `reserve_snapshots` (`aquarius/persist-pool-reserves.ts`) | **`d_supply_scaled`** = reserve amount per leg (`b_supply` null; the same column the `/v1/protocols` top-assets query already uses, `stellar.service.ts:315`) | 2026-03-20 17:48 | 2026-10-30 19:03 | 550 / 21 |
| soroswap | AMM | `reserve_snapshots` (`soroswap/persist-pair-reserves.ts`) | `d_supply_scaled` per leg | 2026-03-19 23:52 | 2026-10-30 18:59 | 132 / 4 |
| stellar-native | AMM (classic) | `pool_snapshots` (`stellar-native/persist-pool-snapshots.ts`) | `metadata.reserves[{asset:"native"\|"CODE:ISSUER", amount}]` (human units, Horizon format; needs the SAC resolve `getStellarNativeTokens` does) | 2026-06-03 20:54 | 2026-10-30 19:03 | 1,105 / 60 (prod perimeter: 9 pools) |
| defindex | vault | `pool_snapshots` (`defindex/persist-vault-metrics.ts`) | **`metadata.tvlUsd`** already in USD (e.g. meru-usdc 2026-10-30 19:07 → 18,359,392.65) | 2026-08-02 20:40 | 2026-10-30 19:07 | 84 / 3 |
| allbridge | bridge | none (no entities) | — | — | — | — |

(`pool_snapshots` has no `tvl_usd` column: id, venue_id, entity_id, snapshot_at, pool_id,
pool_name, reserve_count, total_events, total_deposits, total_swaps, total_exit_pool,
unique_callers, metadata, created_at. Aquarius/Soroswap `pool_snapshots` rows are 2–5 legacy rows
from March; their live history is `reserve_snapshots`.)

Cadence check (last 48 h of local data, distinct minute ticks): aquarius 9, soroswap 3, xoxno 11,
blend 2, defindex 2, stellar-native 2 → every venue writes one row per refresh it ran in; local
ran refreshes irregularly. **Prod must be checked at deploy** with:

```sql
select v.slug, count(*), min(rs.snapshot_at), max(rs.snapshot_at)
from reserve_snapshots rs join entities e on e.id=rs.entity_id join venues v on v.id=e.venue_id
group by 1 order by 1;
select v.slug, count(*), min(ps.snapshot_at), max(ps.snapshot_at)
from pool_snapshots ps join entities e on e.id=ps.entity_id join venues v on v.id=e.venue_id
group by 1 order by 1;
```

Known caveat for any reconstruction: `asset_prices` is shallow (fresh-only, A2 max-age), so
historical points are `amount × latest fresh price`, the documented approximation already used
for Blend. DeFindex is the exception (USD stored at snapshot time).

### B3. How the web decides "Building history" and where "since" comes from

| Piece | File:lines | Behaviour |
|-------|-----------|-----------|
| Series load | `composables/usePoolDetail.ts:80–89` | `fetchPoolSeries(slug)`; on error → `series = null` (same visual as `covered:false`). |
| Chart or note | `components/views/PoolDetailView.vue:371–374` (`tvlChart`), 534–562 (template) | `tvlChart = null` when `!series \|\| !covered \|\| points.length < 2` → `v-else` renders the dashed "Building history" box. Card title flips 398: "TVL (on-chain history)" vs "TVL & volume (30d)". |
| "since" date | `PoolDetailView.vue:354–359` (`historySince`) → `formatDate(pool.updatedAt)` (166–172, `toLocaleString` date+time) | **Pool's `updatedAt` = last refresh tick**, not any series/snapshot date. Short series (1 point) and empty series are indistinguishable; both show this date. |
| Copy | `PoolDetailView.vue:556–561` | "Building history" + "We snapshot on-chain state each refresh; a 30-day TVL/volume series will render here as history accumulates (since {{ historySince }})." |
| Dashboard pattern (G4) | `network.service.ts:183–216` → `meta.firstSnapshotAt = min(as_of) from network_tvl_snapshots`, `partial = first is null \|\| first > window start`; `NetworkTvlChart.vue:153–155, 245–248` → "Building history since {{ fmtDate(meta.firstSnapshotAt) }}" only when `partial`, nothing when `firstSnapshotAt` is null | **Correct pattern**: the API owns the first-snapshot date, the web never substitutes a timestamp of its own. Reusable as-is: `/series` already has a `first` field; the web should use `series.first` and show no date when it is null. |

### B4. Candidate fixes

**(i) API: extend `/series` to vaults and AMMs from the real snapshots; `first` = real first snapshot; web minimal.**

| Layer | File | Change |
|-------|------|--------|
| api | `apps/api/src/modules/stellar/stellar.service.ts:967–1048` | Replace the lending gate with per-venue branches: lending (as today); `amm` Soroban venues (aquarius, soroswap) → same `reserve_snapshots` query with `amountSql = d_supply_scaled`; `vault` (defindex) → `pool_snapshots.metadata->>'tvlUsd'` per snapshot; `stellar-native` → `pool_snapshots.metadata.reserves` × price via the SAC resolve (the hardest branch: assets in Horizon format, resolve per leg; or defer and return `covered:false, first:<min snapshot_at>`). `first` = earliest snapshot with a computable point; add `firstSnapshotAt` (raw min(snapshot_at)) so the web can say "since" honestly even when < 2 points. |
| api | `apps/api/src/modules/stellar/stellar.service.ts:993, 1046` | Keep `updatedAt` = request time (documented) but the web must stop using any `updatedAt` as "since". |
| api | `apps/api/openapi/openapi.v1.yaml` (`/v1/pools/{slug}/series` description + `PoolSeries` schema) | Document venue coverage + new field. |
| api | `apps/api/src/modules/stellar/*.spec.ts` (if a series spec exists; none found by name) | Optional unit spec on the reducer. |
| web | `apps/web/src/components/views/PoolDetailView.vue:354–359, 556–561` | `historySince` ← `series.firstSnapshotAt ?? series.first`, never `pool.updatedAt`; show no "(since …)" when null. |
| web | `apps/web/src/types/protocol.ts:~147` (`PoolSeries` type) | Add the field. |
| web | `apps/web/src/api/pools.ts:32–36` | Comment only ("Blend-only" is no longer true). |
| deploy | VPS api deploy + prod snapshot-depth check (B2 SQL) | Required. |

Trade-off: real curves on 37 more pools (prod: 34 AMM + 3 vault), honest "since" everywhere, one
new query shape per venue family; stellar-native needs the SAC-resolve work (defer-able: ship
AMM-Soroban + vault first, stellar-native returns `covered:false` with a real `firstSnapshotAt`).
The AMM/vault curves rest on latest-price × historical amounts (DeFindex excepted), the same
approximation the Blend curve already carries. Cost: ~1 day api + 0.5 day web + VPS deploy + prod
query for cadence; the reserve_snapshots scan per pool is bounded (`entity_id` filter; the
perf/pools-latency planner trap was on the latest-group-by, not on a single-entity range).

**(ii) Web-only: honest copy, no date, when the series is empty for a reason that will not change.**

| Layer | File | Change |
|-------|------|--------|
| web | `apps/web/src/components/views/PoolDetailView.vue:354–359` | Delete `historySince` (or derive it from `series.first` only). |
| web | `apps/web/src/components/views/PoolDetailView.vue:548–562` | Branch on `pool.type` / `pool.protocol.type`: for `yield_vault` and `amm_pool` → "History not available for this venue type yet" (no pulse dot, no date); for `lending_pool` with `covered:false` → keep "Building history" with "(since {{ series.first }})" only when `first` is non-null. |
| web | `apps/web/src/components/views/PoolDetailView.vue:397–399` | Card title: "TVL & volume (30d)" → "TVL history" (no 30d promise for venues that have none). |
| web | `apps/web/src/types/protocol.ts:~147`, `api/pools.ts:32–36` | Comment/type touch-ups only. |
| deploy | Vercel web deploy only | No VPS. |

Trade-off: zero risk, ships in hours, no api deploy; but it tells the SCF reviewer "not
available" on 37/44 pools, and the data to do better already sits in the DB.

**Recommendation: (ii) now, (i) as the follow-up lot.** PRE's purpose is to clear visible
defects before the SCF 46 window (8 Nov) with minimal surface; (ii) removes the wrong date and the
false promise on every page load with a web-only deploy. (i) is the right product answer but is an
api change with a prod data-depth check and a stellar-native branch that needs design; it should
not be rushed into the same lot as the bridge removal. In both, `since` must never come from
`pool.updatedAt` or `series.updatedAt`; (ii) must still fix the lending `covered:false` case
(e.g. a new XOXNO hub with 1 daily point) to use `series.first`.

### B5. Blast radius — pools that currently show "Building history" in prod

From B1's gate (non-lending → always `covered:false`) and the prod `/v1/pools` perimeter (44 pools):

| Venue | Type | Pools | State today |
|-------|------|-------|-------------|
| aquarius | amm | 21 | Building history (always) |
| soroswap | amm | 4 | Building history (always) |
| stellar-native | amm | 9 | Building history (always) |
| defindex | vault | 3 | Building history (always) |
| blend | lending | 4 | Real curve (`blend-fixed-pool`: 187 daily points since 2026-03-19) |
| xoxno | lending | 3 | Real curve (`xoxno-core-hub`: 5 points since 2026-10-30); any hub with < 2 daily points would show the note |

**37 of 44 pools** show the defect, every one with a "since" equal to the last refresh tick.
After fix (ii): 37 show the honest "not available" copy. After fix (i): 37 gain a curve once prod
has ≥ 2 daily snapshots with a fresh price (aquarius/soroswap since March, defindex since August,
stellar-native pending the SAC branch), per the prod B2 query.

---

## Local-vs-prod caveats

| Item | Local | Prod |
|------|-------|------|
| Last refresh | 2026-10-30 19:08 UTC | 2026-11-03 20:05 UTC (`/health.lastRefreshAt`) |
| Pool perimeter | 95 entities (60 stellar-native) | 44 pools (9 stellar-native) |
| `bridge_flows` | 419 rows, 2026-06-15 → 2026-07-08 | last flow 2026-07-19T18:33:09Z |
| Snapshot depth per venue | B2 table | **check at deploy** with the B2 SQL |

---

# Addendum (2026-11-03, ~21:00 UTC) — Defects C and D

Same rules: read-only, local DB (last refresh 2026-10-30 19:08 UTC, manual cadence) + prod via
`GET /v1/ops/metrics` / `/v1/ops/status` / `/v1/campaign/metrics` on `stellar-api.getdig.ai`.
Points that only the VPS cron log can settle are marked **verify on VPS**.

## Defect C — `#status` shows Horizon degraded on almost every 15-min segment

### C1. Which Horizon target errors, how many per run, since when

`rpc_metrics_runs` is per `(run_at, target)`: `calls`, `errors`, p50/p95/p99, `job`, `methods`
(call **counts** per method; errors are not broken down per method — `ops-metrics.ts:346–361`).
There is one Horizon target (`horizon`, host-classified in `classifyOpsTarget`, `ops-metrics.ts:88–95`).

| Source | Window | Runs | Runs with Horizon errors | Errors per run | Calls per run | Error rate |
|--------|--------|------|--------------------------|----------------|---------------|------------|
| prod `/v1/ops/status` (24h, 2026-11-02 21:00 → 11-03 20:30 UTC) | 95 segments | 95 | **80 (84 %)** | 0–8 (`errs` set {0..8}) | 273–334 | — |
| prod `/v1/ops/metrics` (24h aggregate) | 24h | 20 listed | 19 | 2–4 in the 4 shown | 291–318 | 239 / 28,685 = **0.83 %** |
| prod, other targets (same window) | 24h | 20 | soroban-rpc 0 runs (1 error / 55,787), defindex-api 0, price-sources 0, price-oracle 0 | — | — | — |
| local DB `rpc_metrics_runs` (`job='refresh'`) | 2026-08-13 → 10-30 | 19 | 2 (both 2026-10-27 09:36 and 09:40, RP1 dev runs that also had Aquarius/DeFindex FAILED) | 6 | 119 / 287 | — |

Per-run Horizon methods (local last run, 2026-10-30 18:58): `GET /accounts` **264**,
`GET /liquidity_pools` 9, `GET /fee_stats` 1. Prod runs count 273–334 Horizon calls, the same
mix plus XOXNO (3 hubs, Lot XO) and the larger prod perimeter.

**Since when (prod):** not derivable from the public API, which only serves a 24h window; the
local DB never ran the prod cadence. On the evidence available: every prod run in the last 24h
is affected and the rate is flat (0.83 %), i.e. a steady-state condition, not an onset. The
deploys that touched this path (git log, `main`):

| Date | Commit | Relevance |
|------|--------|-----------|
| 2026-10-27 | 537eb7b RP1 (wallet sweep batched), b701e5d RP1.1 | `job:wallet-alert` path only (`job='wallet-alert'` rows); **not** the `refresh` rows the status page reads (`ops.service.ts:99, 215` filter `job='refresh'`). |
| 2026-10-27 | 0dd68b6 / 1a5a51d SEC Gate 1 | API wallet refresh admission; no indexer Horizon change. |
| 2026-10-30 | 787e5cc XOXNO adapter (Lot XO) | Adds Soroban reads; XOXNO's reader does not call Horizon. Adds pools → more sequence lookups only if it used `simulateContractRead` (it does not). |
| 2026-10-30 | 1e1ebd1 perf | API only. |

Nothing in that list changed the Horizon call pattern of `job:refresh`. The pattern that produces
~290 `GET /accounts` per run predates all of them (local runs show 264 since 2026-08-16).
**Verify on VPS** (one query, read-only) to date the onset precisely:

```sql
select date_trunc('day', run_at) d, count(*) runs, count(*) filter (where errors>0) err_runs,
       sum(errors) errs, sum(calls) calls
from rpc_metrics_runs where target='horizon' and job='refresh'
group by 1 order by 1;
```

### C2. The failing call

| Question | Finding | Evidence |
|----------|---------|----------|
| Which Horizon calls exist on the `job:refresh` path | (a) `GET /accounts/{STELLAR_SOURCE_ACCOUNT}` once **per contract simulation**, (b) `GET /liquidity_pools` once per stellar-native pair (9), (c) `GET /fee_stats` once (network-stats, hard-coded `horizon.stellar.org`). | `00-common.ts:253–259` (`getAccountSequence`) called from `simulateContractRead` (`00-common.ts:280`); `stellar-native/fetch-pools.ts:54`; `73-network-stats-refresh.ts:181`. |
| Who calls `simulateContractRead` | Aquarius (`fetch-pool-state.ts:85`: 3 pool methods + 3 token methods × 2 legs, in `Promise.all` bursts, lines 115–149–174), Soroswap (`fetch-pair-state.ts:82`: 5 pool methods + token reads), Blend (`fetch-pool-state.ts:72, 102`). Each read re-fetches the **same** source account's sequence. ≈ 264–290 lookups of one address per run. | `grep simulateContractRead` → 3 live files; `methods` JSON in `rpc_metrics_runs`. |
| Which HTTP status | Not recorded (the capture stores `ok` only; the sample file `tmp/ops-metrics-<ts>.jsonl` lives on the VPS and is per run). By construction it is **429 or a transport error**: `fetchJson` retries only on `429` and on thrown fetch errors (up to 4 retries, backoff) and throws immediately on any other non-2xx (`00-common.ts:120–165`), which would fail the pool read → the step would retry or FAIL. Prod steps are all `SUCCESS`, `failures24h: 0`, so every Horizon error was absorbed by `fetchJson`'s own retry: each failed attempt is one `ok:false` sample (the fetch patch records per attempt, `ops-metrics.ts:160–180`). | `/v1/ops/metrics` steps; `fetchJson`. |
| Most likely cause | **Horizon rate limiting (HTTP 429) on `GET /accounts/<same address>` from the public `horizon.stellar.org`**, hit by the `Promise.all` bursts (3–9 simultaneous sequence lookups per pool) rather than by the hourly volume (~1,200/h from refresh alone, under the 3,600/h public cap; `job:wallet-alert`'s step 80 adds one `GET /accounts` per tracked wallet from the same IP). p95 4.4 s / p99 10.4 s on the Horizon target in prod (vs ~0.5 s locally) is consistent with retry backoff and throttled responses. | `.env.example:15` default `HORIZON_URL=https://horizon.stellar.org`; `docker-compose.yml:137,163`; `80-stellar-wallet-balance-snapshots.ts:164`. |
| Dead venue / retired lookup? | **No.** The Allbridge step uses Soroban `getEvents` only (no Horizon); `/fee_stats` and `/liquidity_pools` are 10 calls per run. The 264–290 `GET /accounts` calls are to a live, fixed account. Nothing points at a 404. | `run-allbridge-bridge-refresh.ts`; methods JSON. |
| **Verify on VPS** | `grep -c "fetchJson HTTP 429 on horizon.stellar.org" /var/log/<refresh cron log>` for the last day, and `grep "network error on horizon"` for the transport case. One of the two will carry the 2–8 per run. | `00-common.ts:137, 158` log lines. |

### C3. Smallest honest fix

The error signal is real (Horizon is throttling us) and the amber rule is right to show it. The
honest fix removes the cause, not the signal:

| Option | Layer | Deploy | Verdict |
|--------|-------|--------|---------|
| **A. Fetch the source-account sequence once per step process and reuse it** (memoise `getAccountSequence` per `(horizonUrl, address)` in `00-common.ts`, or let `simulateContractRead` take an optional `sequence`). `simulateTransaction` does not need a fresh sequence; the same address is read 264–290 times per run for an identical answer. Horizon calls per run drop from ~290 to ~15 (fee_stats + liquidity_pools + 3 steps × 1). | indexer (`scripts/discovery/00-common.ts`, ~10 lines) | VPS pull + next cron (no API change, no migration) | **Recommended.** Also the RP-lot win: −275 Horizon calls per run, −26k/day. |
| B. Add a bounded concurrency / per-call delay on the Horizon sequence fetch | indexer | VPS | Treats the symptom; keeps the pointless calls. Not recommended. |
| C. Mark `horizon` as a "known-permanent failing target" in `status.ts` | api | VPS | Dishonest for this case: the target is not permanently failing, we are over-calling it. Rejected. |
| D. Switch `HORIZON_URL` to a keyed provider (Validation Cloud Horizon) | ops/env | VPS env | Hides the cause behind a bigger quota; `joinUrl` already supports it. Defer; A removes the need. |
| E. Loosen the amber threshold | api | — | Explicitly out of scope (brief). |

After A, if any amber segment remains, the residual is a transport error and shows up in the
cron log as `fetchJson network error on horizon…`; that is a separate, smaller question.
Evidence to capture at deploy: `rpc_metrics_runs` `calls` for `horizon` ≈ 15 per run and
`errors = 0` over 24h; `#status` Horizon bar green.

## Defect D — campaign metrics are public on `#status` and on the API

### D1. Endpoint, auth, zone, readers

| Item | Finding |
|------|---------|
| Endpoint | `GET /v1/campaign/metrics` (`campaign.controller.ts:115–119` → `CampaignService.metrics()` 542–570 → `CampaignRepository.metricsFacts()` 871+). `Cache-Control: public, max-age=60` + 60 s in-process cache (`campaign-config.ts:35`). Shipped 2026-10-21 (c5b4d5d "public GET /v1/campaign/metrics"), block on `#status` same day (2021525). |
| Auth today | **None.** No guard exists anywhere in `apps/api` (no `CanActivate`, no `@UseGuards`, no admin key; `grep` over `src/`). Prod: `curl …/v1/campaign/metrics` → 200 with the full payload (2026-11-03 20:54 UTC): `walletsRegisteredInWindow 3, walletsProvenInWindow 3, walletsEnrolled 3, walletsWithVerifiedActionInWindow 2, verifiedActionsByKind {sdex-swap 3}, referralsCredited 0, socialClaimsActive 3, pointsIssued 175, perksGranted {early-access 1}` + `window`, `asOf`, `boundary`. |
| nginx zone | Falls under the generic `location /v1/` → zone `api_general` (10 r/s, burst 60); reads are exempt from `api_mutations`. No dedicated location (`docs/deployment.md:78–91`). |
| Web readers | `components/status/CampaignMetricsSection.vue` (mounted at `StatusView.vue:10, 315–317`; renders nine rows under "Campaign metrics · Earn & Points · …", hidden only while `dark`), via `api/campaign.ts:200–216, 262–264` (`fetchCampaignMetrics`, `CampaignMetrics` type). No other view, composable or spec. |
| Other readers | None in code: `campaign.repository.integration.spec.ts:461, 545, 566` exercise `metricsFacts` directly (keep). Not in the public OpenAPI contract (`openapi.v1.yaml` has no `/v1/campaign/*`; `docs/decisions/2026-11-03-public-api-v1-surface.md:80` lists `/v1/campaign/*` as out of public scope and calls `/metrics` "a points KPI, not analytics"). |
| Docs / evidence that cite it | `docs/runbooks.md:354, 363` (EP activation checks: a `curl …/metrics` step and "the `#status` 'Campaign metrics' section appear"); `docs/status-board.md:50` ("public `GET /v1/campaign/metrics` with a boundary string on `#status`"); `docs/current-state.md:37`; `docs/decisions/2026-10-21-points-have-no-monetary-value.md:30`; `docs/internal/evidence/lot-ep/ep3-implementation.md:18, 20`; `docs/internal/evidence/lot-ep/ep3-deploy.md:51, 60, 65, 98, 100`; `docs/internal/evidence/lot-ep/00-recon.md:547, 631, 731` ("public like `/v1/ops/*`"). SCF 46 material: none cites the endpoint or the block (grep over `docs/`). |
| Related, same family | `GET /v1/ops/adoption` is also public and also KPI-shaped (`wallets.total 2140, signers 97, …`), by a recorded founder decision (`docs/security-invariants.md` §7: "Ops endpoints are deliberately public … adoption counters are citable KPI evidence"). The Lot EP recon modelled `/metrics` on that precedent. The founder's new position therefore needs a dated amendment to §7 (campaign KPIs are internal; adoption stays public or not — founder to say). |

### D2. Auth primitives that exist, and the smallest safe gate

| Primitive the brief names | Does it exist? | Where | Fit for a read-only internal metrics GET |
|---------------------------|----------------|-------|------------------------------------------|
| Signed-challenge **session** | **No session exists.** `/v1/auth/challenge` + `/v1/auth/verify` (`auth.controller.ts:36, 42`) issue a nonce and verify a signed plain-text message **once**, writing a proof bound to `(address, userId)` (`wallet_ownership_proofs`, INV-11.1). Reads (`/me`, `/me/activity`) then trust `address + userId` with no proof (`campaign.controller.ts:12–13`). The §7 model is "`userId` is the bearer token; no accounts, no sessions, no signatures". | `campaign.service.ts:285–300`, `campaign.repository.ts:188–294` | Not applicable: a proof says "this wallet is mine", not "I am an operator". Reusing it would require an allow-list on top (next row). |
| Admin wallet list | **Does not exist** (no env var, no table, no check). | — | Could be built: `OPS_ADMIN_ADDRESSES` + require a fresh signed challenge per read. Over-engineered for one internal GET; adds a signing round-trip to a status page. |
| Env-based admin key | **Does not exist** (only `FAUCET_SECRET_KEY`, a Stellar key, §9 — not reusable, by invariant). | `.env.example:33` | **Smallest safe gate:** `OPS_METRICS_TOKEN` (random ≥ 32 bytes, VPS env only, never in the repo), checked in a `CanActivate` guard with a constant-time compare on `Authorization: Bearer …` (or `X-Ops-Token`); 404 (not 403) when absent or wrong so the route stays invisible, matching the §7 "never 403" discipline; respond `Cache-Control: no-store`; token never logged (SEC Gate 1 redaction already strips key-like tokens from step messages, `50083f5`). Fully consistent with `security-invariants.md`: no key material that can sign, nothing custodial, no PII, no address. |

### D3. Recommendation and files

**Preferred: remove the block from `#status` and gate the endpoint behind `OPS_METRICS_TOKEN`.**
Keeping "a single aggregate" public still publishes the campaign's size (enrolled wallets, points
issued) and keeps a public route to maintain; the founder's call is that the numbers are internal,
so the public surface should carry none of them. The operator reads them with one `curl -H`.

| Layer | File | Change |
|-------|------|--------|
| web | `apps/web/src/components/views/StatusView.vue:10, 315–317` | Remove the import and the `<CampaignMetricsSection />` mount. |
| web | `apps/web/src/components/status/CampaignMetricsSection.vue` | Delete (no other importer). |
| web | `apps/web/src/api/campaign.ts:200–216, 262–264` | Delete `CampaignMetrics` + `fetchCampaignMetrics` (unused after the above). |
| api | `apps/api/src/modules/campaign/campaign.controller.ts:115–119` | `@UseGuards(OpsTokenGuard)`, `Cache-Control: no-store`. |
| api | `apps/api/src/common/ops-token.guard.ts` (new, ~25 lines) + `.spec.ts` | Constant-time bearer check; 404 when `OPS_METRICS_TOKEN` is unset (route dark by default, same posture as `FAUCET_ENABLED`). |
| api | `apps/api/src/modules/campaign/campaign.service.ts:187–200, 542–570` | Comment: internal, no longer public; keep the in-process cache. |
| api | `apps/api/.env.example` | `# OPS_METRICS_TOKEN=   # VPS only — gates GET /v1/campaign/metrics`. |
| api | `apps/api/src/modules/campaign/campaign.controller.spec.ts` | Add the 404-without-token / 200-with-token cases. |
| ops | VPS `.env` + API restart | Set the token; **VPS deploy required** (api). Web deploy via Vercel. |
| docs | `docs/runbooks.md:354, 363` | Activation check becomes `curl -H "Authorization: Bearer $OPS_METRICS_TOKEN" …`; drop the "`#status` Campaign metrics section" sentence. Add a one-line "read the campaign KPIs" runbook entry. |
| docs | `docs/security-invariants.md` §7 (bullet "Ops endpoints are deliberately public") and §11 | Dated amendment: campaign KPIs are internal from Lot PRE; `OPS_METRICS_TOKEN` is a read-only operator token, not a signing key; state whether `/v1/ops/adoption` stays public (founder). |
| docs | `docs/status-board.md:50`, `docs/current-state.md:37`, `docs/internal/evidence/lot-ep/ep3-implementation.md:18, 20` | Replace "public" with "operator-gated"; evidence files get a dated note rather than a rewrite. |
| docs | `docs/decisions/` | Short note: `2026-11-0x-campaign-metrics-internal.md` (why, what stays public). |
| nginx | — | No change: the route stays under `api_general`; a token-gated 404 is cheap. |

Alternative "single public aggregate" (not recommended): keep the route public but return only
`{campaign, active, window, asOf}` (no counts) and show nothing on `#status`. Touches the same
api/web files, same VPS deploy, and still leaves a public campaign route to explain to reviewers.

Both options: no change to `/v1/campaign` (public config), `/me`, `/leaderboard` (which already
shows shortened addresses + points publicly — a separate founder question, not in this brief).
