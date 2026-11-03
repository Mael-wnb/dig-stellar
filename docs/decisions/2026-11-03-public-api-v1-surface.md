# Decision: Public API v1 surface (2026-11-03)

**Status: implemented, deployed 2026-11-03 (`de1b8bb`) — `/v1/openapi.json` 1.0.0 and `/v1/docs`
live on the production API (`docs/evidence/lot-api/api5-prod-verification.md`).**

Recon basis: `docs/evidence/lot-api/api0-recon.md` (API0, read-only, 2026-11-02). Every
number and example body below comes from that recon or from the repo files it cites.

## Ruling

The `apps/api` HTTP surface gets a published, versioned public contract. "Contract" in this
document always means the HTTP API contract, never a smart contract.

1. **Positioning.** The public API is a **data and signals layer**: read-only, aimed at
   agents, bots, dashboards and researchers. Execution (non-custodial action building and
   signing) stays in the Dig app. Wallet-scoped data and the action builders are **out of
   the public API for the foreseeable future**.
2. **What is public.** Fifteen operations: the fourteen read endpoints listed in §Endpoints
   plus one read-only quote (`POST /v1/actions/sdex/quote`, a price lookup that builds nothing
   and signs nothing). Each operation carries an `x-stability` tier, `stable` or `beta`.
3. **What is not public.** Everything userId-scoped (wallets, alert rules, notifications),
   every XDR builder and the witness ledger, the faucet money path, auth and campaign
   routes, and the legacy prefix-less routes. See §Exclusions.
4. **Source of truth** is a hand-written OpenAPI 3.1 file, `apps/api/openapi/openapi.v1.yaml`
   (the only copy; `docs/api/README.md` points to it), served by a new small `openapi` module
   at `GET /v1/openapi.json`, with a Scalar reference page at `GET /v1/docs`. It lives under
   `apps/api/`, not `docs/`, because one file must be reachable by every runtime: `nest build`
   copies it to `dist/openapi/` (nest-cli assets), which is what pm2 (`dist/main.js`) and the
   Lot Z Docker image (ships `apps/api/dist` only) read. **Zero edits to existing services or
   controllers.** No `@nestjs/swagger`,
   no DTO classes: the recon found no response DTO on the public tier, every payload is an
   inline object literal, and a decorated class the code never instantiates would drift
   silently.
5. **Proof** is an ajv-based contract test that boots the real Nest app against a local
   Postgres and validates every public response (and the error schemas) against the yaml,
   exposed as `pnpm -C apps/api test:contract`. It is **not** added to the unit CI workflow in
   this lot (Lot AD owns CI); it goes into the deploy checklist.
6. **Error shapes are documented as they are.** Five shapes exist today; the four reachable from
   the public tier are written into the spec verbatim (the actions object is not, see §Error
   shapes). No global `ExceptionFilter` and no unification in this lot.
7. **No SDK, no auth, no API keys** in this lot. External callers are governed by the existing
   nginx per-IP zones (§Rate limits).
8. **Spec examples** are captured from production public GETs in API2, not from the local
   database (stale since 2026-10-30).

## Endpoints (public tier)

Zone = nginx `limit_req` zone. Cache = `Cache-Control` header if any, else the in-process
cache found in the recon (none of the public reads sets a cache header except `/v1/ops/status`;
Express adds a weak `ETag` to every JSON body). Freshness = fields present in the payload.

| Method + path | Tier | Zone | Cache | Freshness fields | Description | Caveat |
|---|---|---|---|---|---|---|
| `GET /health` | stable | `api_general` (`location /`) | none | `status`, `staleAfterSeconds`, `lastRefreshAt`, `freshness[].asOf/ageSeconds/isStale` | Liveness + per-venue freshness; always 200 with `status` `ok`/`degraded`, 503 only when the DB is unreachable | 503 body is the health payload itself (shape S5) |
| `GET /v1/protocols` | stable | `api_general` | in-process TTL 90 s (`STELLAR_LIST_CACHE_TTL_MS`) | `updatedAt`, `stale`, `isStale`, `staleAfterSeconds`, `ageSeconds` | One row per tracked venue with aggregates and top assets | `stale` is a legacy alias of `isStale`; both stay |
| `GET /v1/pools` | stable | `api_general` | in-process TTL 90 s, keyed by `protocol\|sort\|order` | same as `/v1/protocols` | Pool list; `protocol` filter, `sort` allow-list (unknown → default order), `order` asc/desc | `ageSeconds` keeps ticking on a cache hit; rows can lag ≤ 90 s |
| `GET /v1/pools/{slug}` | stable | `api_general` | none | same as `/v1/protocols` | Pool detail; **two shapes** by venue type: AMM (`tokens[]`) vs lending/vault (`reserves[]`) | Unknown slug → 404 (S1) |
| `GET /v1/pools/{slug}/flows` | beta | `api_general` | none | `updatedAt` (= request time), `coverageSince` | Deposit/withdraw flows per UTC day; `window` ∈ 24h/7d/30d (unknown → 7d) | `covered:false` short form keeps the same keys; coverage is data-driven |
| `GET /v1/pools/{slug}/series` | beta | `api_general` | none | `updatedAt` (= request time), `first`, `last` | TVL history, lending pools only; `covered:false` below 2 points | Documented as a latest-price approximation; AMM/vault pools return `covered:false` |
| `GET /v1/network/stats` | stable | `api_general` | none | `updatedAt`, `isStale`, `staleAfterSeconds` | Network headline figures read from `network_stats_latest`; no external call at request time | Values are environment-dependent (indexer-written); the spec example is captured from production |
| `GET /v1/network/tvl-series` | stable | `api_general` | none | `meta.from/to/firstSnapshotAt/partial/methodologyChangeAt` | Hourly tracked-TVL series over a fixed 7-day window | Methodology step-down of 2026-08-17 marked in `meta`, history never rewritten |
| `GET /v1/bridge/summary` | stable | `api_general` | none | `updatedAt` (= request time), `lastFlowAt` | Allbridge USDC inflow/outflow totals by source chain; `window` ∈ 24h/7d/30d (unknown → 7d) | **Upstream venue paused** since 2026-07-20 (`docs/runbooks.md`); totals are legitimately zero until relaunch |
| `GET /v1/bridge/flows` | stable | `api_general` | none | none | Latest N flows; `direction` filter, `limit` clamped 1..200 (default 50) | Same upstream pause; feed shows the last flows before it |
| `GET /v1/bridge/series` | stable | `api_general` | none | `updatedAt` (= request time) | Daily net-flow series, gap-filled; `days` clamped 1..30 (default 7) | Same upstream pause |
| `GET /v1/ops/status` | beta | `api_general` | `Cache-Control: no-store` | `generatedAt`, `staleAfterSeconds`, `historySince`, `cadenceMinutes` | Status-page payload for the refresh pipeline over a fixed 24 h; `window` must be `24h` (else 400) | Shape changed 6 times since 2026-09-01; `priceSources` added 2026-10-15 |
| `GET /v1/ops/metrics` | beta | `api_general` | none | `window:"24h"`, per-run `runAt` | Indexer RPC metrics and refresh steps over 24 h | `faucet` sub-object is **deploy-dependent** (`FAUCET_ENABLED`, network, campaign); `rpc[].target` list grows with the pipeline |
| `GET /v1/ops/adoption` | beta | `api_general` | none | none | Adoption counters (builds, wallets); honest boundary stated in `boundary` | `byKind.kind` is an open enum; counters start at deploy |
| `POST /v1/actions/sdex/quote` | beta | `api_actions` (`location /v1/actions/`) | none | none | Classic DEX strict-send quote, direct routes only; body `{fromAsset, toAsset, amount, network?}` | **Live Horizon call per request**; `network` defaults to `testnet`; `mainnet` → 403 unless `ACTIONS_MAINNET_ENABLED=true`, plus a mainnet asset whitelist; 422 when no direct path |

The SDEX quote is POST-only; there is no GET form.

## Exclusions (not in the public spec)

| Route family | Reason | Tracked in |
|---|---|---|
| `/v1/wallets/*` (13 routes) | userId-scoped, mutations, demo-user fallback when `userId` is absent | Later product lot (wallet-scoped API, if ever); demo-user behaviour → SEC Gate 3 |
| `/v1/alert-rules/*`, `/v1/notifications/*` | userId-scoped, user state | Later product lot |
| `/v1/actions/blend/*`, `/v1/actions/sdex/swap`, `/v1/actions/witness` | Signable-XDR builders and the executed-tx ledger: execution stays in the Dig app | Out of public scope (positioning) |
| `/v1/faucet/*` | Money path, server-side key, deploys dark | Out of public scope (`docs/security-invariants.md` §9) |
| `/v1/auth/*`, `/v1/campaign/*` | Signed-challenge session; `GET /v1/campaign/metrics` is a points KPI, not analytics | Out of public scope (Lot EP) |
| `GET /protocols`, `GET /venues`, `GET /venues/{key}/snapshots` (prefix-less) | Legacy Prisma `Protocol/Venue/Snapshot` models, seed data only; nothing in `apps/web`, the indexer, docs, compose or nginx calls them | **Deprecated by this decision.** Code removal is out of this lot (open item) |

## Error shapes (documented, not unified)

Five shapes exist today. The four reachable from the public tier (S1, S3, S4, S5) go into the
spec under `components.responses`, exactly as captured in the recon; S2 is unreachable from the
public tier and stays out. No global `ExceptionFilter` and no unification happens in this lot.

The public quote (`POST /v1/actions/sdex/quote`) emits S1 only: 400 on body validation
(unknown asset, same asset, non-positive amount, unknown `network`, off-whitelist mainnet asset),
403 when `network: "mainnet"` and the kill-switch is off, 422 when Horizon returns no direct
path, and an S1 500 (`Failed to fetch swap quote from Horizon`) when the Horizon call fails.

| Shape | Producer | Produced by (public tier) | Example body (verbatim from the recon) |
|---|---|---|---|
| S1 Nest standard | every explicit `HttpException` + Nest's 404 + Express body/URI errors re-wrapped by Nest | 400 on `/v1/ops/status` (`window`), 400/403/422 on the SDEX quote, 404 on unknown pool slug or unknown route | `{"message":"Pool not found: does-not-exist","error":"Not Found","statusCode":404}` · `{"message":"Unsupported window '7d'. Supported: 24h","error":"Bad Request","statusCode":400}` · `{"message":"Mainnet actions are not enabled.","error":"Forbidden","statusCode":403}` · `{"message":"No direct liquidity for XLM→ZZZQ at this amount on testnet","error":"Unprocessable Entity","statusCode":422}` · `{"message":"Cannot GET /v1/nope","error":"Not Found","statusCode":404}` |
| S2 actions custom object (no `statusCode`, no `error`) | `BadRequestException` given an object in `actions.service.ts` | **Not emitted by any public-tier endpoint**, so it is **not in the spec**: only the spendable preflight of `sdex/swap` and the Blend builders (excluded routes) produces it. Listed here because it exists and the web parses it by `code` | `{"code":"INSUFFICIENT_SPENDABLE_BALANCE","message":"Insufficient spendable XLM balance: 69774.5623753 available. The rest is reserved by the Stellar network","asset":"XLM","spendable":"69774.5623753","requested":"999999999"}` |
| S3 nginx 429 | `@rate_limited` named location in the vhost; never reaches Nest | any public route over its zone limit | `{"statusCode":429,"error":"Too Many Requests","message":"Rate limit exceeded - please slow down."}` with `Retry-After: 1` |
| S4 Nest 500 (two keys) | `BaseExceptionFilter` for any non-`HttpException` throw | not reproducible from the public tier in the recon; the SDEX quote throws an S1 500 (`Failed to fetch swap quote from Horizon`) when Horizon fails | `{"statusCode":500,"message":"Internal server error"}` |
| S5 health 503 | `/health` throws its own payload when the DB is unreachable | `GET /health` only | the full health payload (`status:"degraded"`, `db.ok:false`, …), no `statusCode`/`message` keys |

## Versioning and stability rules

- **Additive only inside `/v1`**: new fields and new endpoints may land at any time. Removing a
  field, renaming it, or changing its type is a breaking change and ships as `/v2` alongside
  `/v1`, never in place.
- **`x-stability`** is set per operation in the yaml. `stable` operations change additively
  only, and their response schemas carry `additionalProperties: false` (or its `allOf`-aware
  JSON Schema 2020-12 form `unevaluatedProperties: false` where the shared `FreshnessMeta` is
  composed in) so the contract test fails on any undocumented key. `beta` operations may change shape inside `/v1`; their schemas
  do not set `additionalProperties: false`. **Every change, stable or beta, takes one line in
  `docs/api/CHANGELOG.md`.**
- A `beta` operation **moves to `stable` only through an update of this decision doc**, never
  by editing the yaml alone.
- The freshness fields (`isStale`, `staleAfterSeconds`, `asOf`/`updatedAt`, `ageSeconds`, and
  `meta.*` where present) are **one shared schema** in the yaml, referenced by every endpoint
  that carries them.

## Rate limits for external callers

No API key in this lot. Limits are the nginx per-IP zones already deployed, keyed by
`$binary_remote_addr`, all `nodelay`, as recorded in `docs/deployment.md`:

| Zone | Applies to | Rate | Burst |
|---|---|---|---|
| `api_general` | every public GET above, plus `/v1/openapi.json` and `/v1/docs` | 10 r/s | 60 |
| `api_actions` | `POST /v1/actions/sdex/quote` (`location /v1/actions/`) | 30 r/min | 10 |

Over the limit the edge returns the S3 body with `Retry-After: 1` and an echoed
`Access-Control-Allow-Origin`. Per-key quotas are an open item for a later lot.

## Docs page

`GET /v1/docs` is a single static HTML page loading Scalar API Reference from the jsDelivr CDN
(no build step), served with an explicit `text/html; charset=utf-8` content type because the
API vhost sets `X-Content-Type-Options: nosniff`. The vhost has no Content-Security-Policy
(confirmed on the deployed conf and the live headers), so nothing blocks the CDN script. Both
`GET /v1/openapi.json` and `GET /v1/docs` answer with `Cache-Control: public, max-age=3600`
and fall under the existing `location /v1/` → `api_general`; no nginx change is needed for
them to work. The CDN dependency is an open item (vendor the bundle later).

## Delivery plan

| Step | Deliverable | Gate |
|---|---|---|
| API1 (this doc) | Surface frozen | **Gate 1**: founder validates the endpoint and exclusion tables |
| API2 | `docs/api/openapi.v1.yaml` + `openapi` module (`GET /v1/openapi.json`) + `test:contract` (ajv, real app, local Postgres); examples captured from production GETs | **Gate 2**: validator output green on every public endpoint and on the five error schemas |
| API3 | `GET /v1/docs` Scalar page + nginx location note in `docs/deployment.md` | **Gate 3**: capture of the rendered page |
| API4 | `docs/evidence/lot-api/`, `docs/status-board.md`, `docs/current-state.md`, deploy sequence (`test:contract` in the deploy checklist) | VPS deploy **before** any web change |
| Web (separate branch) | Sidebar link to `/v1/docs` | after the VPS serves it |

## Open items carried out of this lot

- Legacy prefix-less route removal (`AppController`: `/protocols`, `/venues`,
  `/venues/:key/snapshots`), deprecated here, code untouched.
- Global error filter unifying S1/S2/S4 (additive `statusCode` + `error` on S2 would not
  break `apps/web`, which reads `code`/`message` and `err.status` only).
- Contract test in CI → Lot AD.
- Optional API keys + per-key quotas → later product lot.
- `GET /v1/docs` loads Scalar API Reference from the jsDelivr CDN, **pinned to `1.76.4`**
  (`apps/api/src/modules/openapi/docs-page.ts`, bump procedure in `docs/api/README.md`);
  vendoring the bundle is a later step.
- `GET /v1/openapi.json` and `GET /v1/docs` answer a route-local
  `Access-Control-Allow-Origin: *` (GET only); the global CORS policy in `main.ts` is
  unchanged and the data endpoints keep it. **CORS policy for external data consumers is
  decided in the API-keys lot.**
- `GET /v1/wallets` without `userId` resolves to the demo user and returns 200 locally,
  while `docs/deployment.md` §G1 states "400 (userId required)" → SEC Gate 3.
- `CLAUDE.md` said `GET /v1/network/stats` hits external APIs live; it reads
  `network_stats_latest` written by the indexer → **fixed in API4 (2026-11-03)**.
