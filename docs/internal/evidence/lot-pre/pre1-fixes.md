# Lot PRE — PRE1: the four pre-dossier fixes (built 2026-11-03, not committed, not deployed)

Branch `feat/lot-pre` from `main` @ e4350b1 in `../dig-stellar-rp`. Recon: `pre0-recon.md`.
Founder decisions applied as given (A delete + retire step, B web-only copy, C sequence once per
step process, D token gate + block removed). Three commits proposed: 1 indexer + api + spec,
2 web, 3 docs + evidence (including `pre0-recon.md`).

## What changed, per defect

| Defect | Layer | Change | Files |
|--------|-------|--------|-------|
| **A** bridge surface | web | Dashboard bridge section removed (the grid closes on `YourPositionsPanel`); status page "(upstream paused)" suffix and its helper call removed; `bridge: 'Bridge'` label-map entry removed. Deleted: `components/bridge/*` (4), `composables/useBridge.ts`, `api/bridge.ts`, `config/bridgeAnnotations.ts`, `constants/bridgeChains.ts`. Comments that pointed at deleted files were reworded (`NetworkTvlChart.vue`, `api/notifications.ts`). No web test exercised the bridge. | `DashboardView.vue`, `StatusView.vue`, `ProtocolsView.vue`, `NetworkTvlChart.vue`, `api/notifications.ts`, 8 deletions |
| **A** pipeline | indexer + api | `allbridge` step removed from `71-refresh-all-metrics.ts` (steps renumbered 8 → network stats, 9 → ops persist; comments updated); `STEP_LABELS.allbridge` removed from `ops/status.ts`. Adapter, bootstrap, `/v1/bridge/*`, `bridge_flows`, venue row untouched. `/health` still lists `allbridge` with `asOf: null`. | `71-refresh-all-metrics.ts`, `ops/status.ts` |
| **A** spec | api | The three `/v1/bridge/*` descriptions rewritten: Allbridge Core wound down after 2026-07-20, historical record, last flow 2026-07-19, no new flows expected. One changelog line (description only, 1.0.0). | `openapi.v1.yaml`, `docs/api/CHANGELOG.md` |
| **B** "Building history since now" | web | `covered === false` → plain state, no date, no pulse: title **"TVL history not available"**, body **"Daily TVL history is currently available for lending pools only."** `covered === true` → chart unchanged; the footer cites **"history since &lt;series.first&gt;"** only when `series.first` is non-null. `pool.updatedAt` is no longer read for any "since". Card title for the uncovered state: "TVL history" (was "TVL & volume (30d)"); the dead "Volume" legend of that state removed. Works against the current prod API payload (reads `covered` / `first`, both already served). | `PoolDetailView.vue`, `types/protocol.ts`, `api/pools.ts` (comments) |
| **C** Horizon over-calling | indexer | `getAccountSequence` memoised per `(horizonUrl, address)` for the life of the step process; the in-flight promise is shared so a `Promise.all` burst coalesces into one request; a failed fetch is evicted (retry through `fetchJson` as before). Comment states that simulations are never submitted, so a stale sequence is fine. Capture library, retry policy, `OPS_STATUS_RULES` untouched. No spec file exists for `00-common.ts`, so no unit test was added. | `scripts/discovery/00-common.ts` |
| **D** campaign metrics public | api | `OpsTokenGuard` (`common/ops-token.guard.ts`): `Authorization: Bearer <OPS_METRICS_TOKEN>`, constant-time compare, 404 with the standard Nest body when the env var is unset or the bearer is missing / malformed / wrong, nothing logged. Applied to `GET /v1/campaign/metrics`; `Cache-Control` → `no-store`. `OPS_METRICS_TOKEN=` in `.env.example`. | `ops-token.guard.ts` (+ spec), `campaign.controller.ts` (+ spec), `.env.example` |
| **D** status block | web | `CampaignMetricsSection.vue` deleted, its mount removed from `StatusView.vue`, `fetchCampaignMetrics` + `CampaignMetrics` removed from `api/campaign.ts`. `GET /v1/campaign` (public config) untouched; the Earn page is unchanged. | `StatusView.vue`, `api/campaign.ts`, 1 deletion |

## Checks

| Check | Before | After |
|-------|--------|-------|
| `pnpm -C apps/api build` | — | exit 0 |
| `pnpm -C apps/api test` | 387 passed (43 skipped, 34 suites) | **393 passed** (43 skipped, 35 suites): +4 guard specs (`ops-token.guard.spec.ts`), +1 controller spec (guard + `no-store` metadata on `metrics`), +1 pure-matcher spec |
| `pnpm -C apps/api test:contract` (`DATABASE_URL` local, Node 24) | 40/40 | **40/40** |
| `pnpm -C apps/web build` (vue-tsc + vite) | — | exit 0 |
| `pnpm -C apps/web test` | 161 passed (12 files) | **161 passed** (12 files) — no web test exercised the bridge or the status block |
| `pnpm -C apps/indexer test` (Node 24; the glob needs ≥ 22) | 49/49 | **49/49** |
| indexer typecheck (`tsc --noEmit -p tsconfig.json`; the repo has no script) | 36 errors, all in `@stellar/stellar-sdk` typings under `node_modules` (`URI` / `urijs`), 0 in `src/` | same: **0 errors in `src/`** |
| eslint, scoped (never `pnpm -C apps/api lint`: `--fix` rewrites unrelated files) | — | `ops-token.guard.ts` + `.spec.ts` clean (formatted with `eslint --fix` on those two paths only); `campaign.controller.ts` / `.spec.ts` carry the file's pre-existing prettier complaints, unchanged in kind |

## Horizon account calls, local `job:refresh` (same perimeter as the local DB: 4 Blend, 4 Soroswap, 21 Aquarius, 60 stellar-native, 3 DeFindex, 3 XOXNO)

| Run | `calls` (horizon) | `errors` | `methods` |
|-----|-------------------|----------|-----------|
| 2026-10-30 18:58 UTC (before, last prior run) | 274 | 0 | `GET /accounts` 264 · `GET /fee_stats` 1 · `GET /liquidity_pools` 9 |
| **2026-11-03 21:31 UTC (after, this branch)** | **39** | 0 | **`GET /accounts` 29** · `GET /fee_stats` 1 · `GET /liquidity_pools` 9 |

Why 29 and not ~3: the Blend / Soroswap / Aquarius steps spawn **one tsx process per pool**
(`runStep` per entity, retry per entity), and the brief's cache is per process, so each pool
process fetches the sequence exactly once (4 + 4 + 21 = 29), sequentially, never in a
`Promise.all` burst. The bursts were the throttling trigger; the per-run total is −86 %. Prod
(same 29 pools) should land at ≈ 40 calls per run with 0 errors. Going lower (one fetch per run,
passed to the children through the environment) is a small follow-up, not part of this lot.
Run: 316 s, 10/10 steps SUCCESS, no `allbridge` step (`[ops] persisted 5 rpc target summary(ies) +
10 step outcome(s)`), no `HTTP 429` / `network error` line in the log.

## Local verification of the gate (built dist on `127.0.0.1:3102`, `OPS_METRICS_TOKEN` set to a throwaway value)

```
GET /v1/campaign/metrics                                   → 404 {"message":"Not Found","statusCode":404}
GET /v1/campaign/metrics  Authorization: Bearer nope       → 404
GET /v1/campaign/metrics  Authorization: Bearer <token>    → 200, Cache-Control: no-store
GET /health                                                → allbridge {"asOf":null,"ageSeconds":null,"isStale":null} (still listed)
GET /v1/ops/status (after the local run)                   → 10 step components, no step:allbridge; rpc:horizon ok, 0 errors
```

## Captures (`captures/`, local Chrome headless, built web on `127.0.0.1:4173` → API `127.0.0.1:3102`, local DB)

| File | What it shows |
|------|---------------|
| `dashboard-1440.png` | Dashboard, 1440 px: hero, tiles, Protocols + Your positions; **no bridge section**, the grid closes on the last row. |
| `dashboard-390.png` | Dashboard, 390 px: same, stacked. (The right-edge clipping of the tile row is a headless-window artefact: `prod-before-dashboard-390.png`, taken the same way from production, clips identically.) |
| `prod-before-dashboard-390.png` | Production, 390 px, same method, before this lot: the bridge card with "No bridge activity for 107 days…" at the bottom. |
| `pool-amm-1440.png` | Aquarius xSolvBTC/SolvBTC: "TVL history" card → **"TVL history not available"** / "Daily TVL history is currently available for lending pools only." No date, no dot. |
| `pool-vault-1440.png` | DeFindex Meru (USDC): same plain state. |
| `pool-blend-1440.png` | Blend Fixed: chart kept, footer "Supplied × latest price, reconstructed from reserve snapshots, **history since 19 Mar**" (= `series.first`). |
| `status-1440.png`, `status-390.png` | Status page after the local run: 10 pipeline rows (no Allbridge), Horizon green, **no "Campaign metrics" block** under the footer. |

## Founder-side checks at deploy (copied into `docs/deployment.md` "Lot PRE deploy sequence")

1. **Before the indexer change is picked up**, record the Horizon error onset once (read-only, VPS):
   ```sql
   select date_trunc('day', run_at) d, count(*) runs, count(*) filter (where errors>0) err_runs,
          sum(errors) errs, sum(calls) calls
   from rpc_metrics_runs where target='horizon' and job='refresh'
   group by 1 order by 1;
   ```
   Paste the output here (section "Prod onset").
2. **After the API restart with `OPS_METRICS_TOKEN`:**
   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' https://stellar-api.getdig.ai/v1/campaign/metrics                                  # 404
   curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $OPS_METRICS_TOKEN" https://stellar-api.getdig.ai/v1/campaign/metrics   # 200
   ```

## Prod onset (to fill at deploy)

_pending — output of check 1 above._

## Docs touched (commit 3)

`docs/runbooks.md` (Allbridge note rewritten; fixture step list; retries paragraph + the
sequence-once line; "Internal campaign metrics (`OPS_METRICS_TOKEN`)" entry; activation curl),
`docs/deployment.md` ("Lot PRE deploy sequence"), `docs/status-board.md` (T2-D3 row, Lot PRE
note, Lot EP line, "Last updated"), `docs/current-state.md` (overall + §3 / §6 / §9),
`docs/security-invariants.md` (§7 amendment), `docs/internal/evidence/lot-ep/{00-recon,ep3-implementation,ep3-deploy}.md`
(one dated line at the top of each), `CLAUDE.md` (T2-D3 line), `docs/api/CHANGELOG.md`,
`docs/internal/evidence/lot-pre/pre0-recon.md` + this file + `captures/`.
