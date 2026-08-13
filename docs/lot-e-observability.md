# Lot E — Observability & Reference Packaging (T3-D3) — Implementation Brief

Execution brief for Claude Code. Serves the two REMAINING build criteria of **T3-D3**
(the UI/UX-polish component landed via Lots C/F/G/H): **observability** — health,
RPC latency percentiles and error rates — and the **packaged reference implementation**.
Plus the adoption counters the final tranche report needs. This is the last build brick
of T3; everything after it is evidence assembly. Written 2026-08-13 against current
`main`; re-verify file states before editing. Evidence: `docs/evidence/lot-e/`.

## Ground rules

- Beta-first: NO Prometheus/Grafana, no new runtime dependencies, no metrics
  infrastructure. Plain tables + on-read endpoints, same pattern as everything else.
- Ops endpoints are PUBLIC read-only: they must never leak secrets, env values,
  connection strings, or internal URLs. A short GIT_SHA is fine; `DATABASE_URL` never.
- `/health` always answers HTTP 200 with a `status` field (`ok` | `degraded`) — a
  monitor must be able to READ the degraded state; a 500 tells it nothing. 503 only
  when the DB itself is unreachable.
- Honest metrics: report what was measured, per run — never averaged percentiles or
  synthetic aggregates that hide variance.
- Each step lands green (builds + existing tests) with evidence captured.

## E1 — Enriched `GET /health`

Replace the bare liveness with the real picture (one DB round-trip, cheap):

```json
{
  "status": "ok" | "degraded",
  "version": "<short GIT_SHA>",        // from env; "unknown" if unset
  "uptimeSeconds": 12345,
  "db": { "ok": true, "latencyMs": 3 },
  "freshness": [                        // per venue, from protocol_metrics_latest
    { "venue": "blend", "asOf": "...", "ageSeconds": 312, "isStale": false },
    ...
  ],
  "lastRefreshAt": "..."               // max(as_of) from network_tvl_snapshots
}
```

- `degraded` when the DB errors OR any venue `isStale` (same 45-min read-time rule as
  Lot B — reuse the existing freshness computation, do not duplicate the threshold).
- `GIT_SHA` comes from an env var set at deploy time; add the export line to the VPS
  deploy procedure in `docs/runbooks.md` (`GIT_SHA=$(git rev-parse --short HEAD)`).

## E2 — RPC latency percentiles + error rates (the verbatim grant criterion)

**Capture (apps/indexer).** All external calls flow through a small set of choke
points (the Soroban RPC helpers, the Horizon fetches, the DeFindex/price HTTP calls
— and `retry.ts` wraps the step level). Instrument at the lowest shared call layer:
wrap each outbound call with a timer recording `{ target, ok, durationMs }`, where
`target` ∈ {`soroban-rpc`, `horizon`, `defindex-api`, `price-sources`} (keep the set
small and stable). Collect in-memory per process run.

**Persist.** At the end of each refresh run, write per-target summary rows into a new
table (additive raw-SQL migration `stellar_v1_ops_metrics.sql`):

```
rpc_metrics_runs(run_at timestamptz, target text, calls int, errors int,
                 p50_ms int, p95_ms int, p99_ms int, primary key (run_at, target))
```

Percentiles computed from the run's actual samples (sorted array — no libraries).
Also persist the per-step outcomes we already print (the incident-fix summary):

```
refresh_step_runs(run_at timestamptz, step text, status text, duration_ms int,
                  message text null, primary key (run_at, step))
```

This makes incident history queryable — the 2026-08-09 staleness incident would have
been one SQL query instead of grepping logs. The orchestrator already has all this
data in `stepResults`; it's a persist call, not new instrumentation.

**Expose (apps/api).** `GET /v1/ops/metrics`:

```json
{
  "window": "24h",
  "rpc": [ { "target": "soroban-rpc", "calls": 4210, "errors": 3,
             "errorRate": 0.0007, "latest": { "p50Ms": 210, "p95Ms": 480, "p99Ms": 1200 },
             "runs": [ ...last N per-run percentile rows... ] } ],
  "steps": [ { "step": "blend", "lastStatus": "SUCCESS", "lastDurationMs": 13800,
               "failures24h": 0 } ]
}
```

Error rate = sum(errors)/sum(calls) over the window (that IS honest to aggregate);
percentiles stay per-run. The API process's own Horizon calls (actions preflight)
MAY be included later — the indexer is where the volume is; note it as a known
boundary in the evidence, don't build API-side capture in this lot.

## E3 — Adoption counters (feeds the final report + T3-D2 KPIs)

- New table `action_events(id, kind text, network text, address text, created_at)`
  — one row per successful server-side build: `sdex-quote`, `sdex-swap-build`,
  `blend-deposit-build`, `trustline-build`. Addresses are public on-chain data;
  store them to count distinct actors. Insert is fire-and-forget (a logging failure
  must NEVER fail the action itself — try/catch around the insert).
- `GET /v1/ops/adoption`: wallets tracked (total + watch-only vs signer, from
  `user_wallets`), distinct users, actions built by kind/network (24h/7d/total),
  distinct acting addresses. HONEST boundary, stated in the payload or docs: these
  count server-side BUILDS; on-chain submission happens client-side (non-custodial),
  so executed-tx evidence remains the hash list we keep manually.
- Backfill impossible (no historical log) — counters start at deploy, like G0. One
  more reason this lot ships now.

## E4 — Reference packaging (SDF reference-implementation criterion)

- Make `docker-compose.yml` a complete reference stack: postgres + redis (existing)
  **+ api + web** services (Dockerfiles or documented `pnpm` dev-mode services —
  choose the simplest that actually works; the indexer runs as documented one-shot
  commands, cron-style, not a daemon).
- `docs/reference-deployment.md` — the quickstart: clone → `.env.example` files per
  app (create them — every REQUIRED var with a comment, secrets blank) → compose up
  → apply the schema files in order (the list already exists in `docs/runbooks.md`)
  → bootstrap seeds → `job:refresh` → open the web app. **PROVE IT**: run the
  quickstart from a fresh clone in a temp directory, start to a rendering dashboard,
  and note deviations found+fixed in the evidence.
- CI/CD stays out of scope (manual VPS deploy is documented in runbooks; the final
  report will state it plainly). If a trivial GitHub Actions workflow running
  builds+tests on push fits in 15 minutes, it's a welcome bonus — not a requirement.

## Sequencing

E1 → E2 → E3 → E4, each green + captured + reported. E2 is the largest — if it needs
splitting, capture+persist first (indexer), expose (API) second. STOP for review
after E2 before E3.

## Definition of done

- `curl /health` shows db + version + per-venue freshness; `degraded` demonstrably
  appears when a venue is stale (simulate locally by aging a row).
- `/v1/ops/metrics` returns real per-run percentiles from ≥2 real refresh runs and a
  computed error rate (force one failure locally to prove errors are counted).
- `/v1/ops/adoption` returns real counts; a testnet quote+build round-trip visibly
  increments them.
- Fresh-clone quickstart proven end-to-end; `.env.example` files exist per app.
- No secret/env leakage in any ops endpoint (grep the payloads in evidence).
- Docs: `runbooks.md` (GIT_SHA export + ops endpoints section), `deployment.md`
  (migration list + compose reference), `current-state.md` + `status-board.md`
  flagged for sync.

## Out of scope

Prometheus/Grafana/OTel · alerting on ops metrics · API-side RPC capture (noted
boundary) · CI/CD pipeline beyond the optional bonus · auth/rate-limiting on ops
endpoints · KPI work (Paul) · H5 recent-swaps feed (next brief, after this lot).
