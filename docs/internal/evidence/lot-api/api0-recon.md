# Lot API — API0 recon: public HTTP surface + evidence corpus sizing

Read-only recon, 2026-11-02. Worktree `../dig-stellar-rp`, branch `feat/lot-api` at `b0db4e8`
(clean, from `origin/main`). No code, dependency or git change was made. Samples come from a
throwaway `nest start` of THIS worktree on `127.0.0.1:3101` against the local compose Postgres
(`dig_stellar`, last refresh 2026-10-30 → every row reads `isStale: true`), stopped afterwards.
One production call was made (`HEAD /health`) to capture the real nginx headers. The long-running
`:3000` process on this machine is the main checkout's older `dist` (`feat/lot-ep5`) and was not used.

"Contract" below always means the HTTP API contract.

---

## Part A — HTTP surface inventory

### A.0 Globals (`main.ts`, `app.module.ts`)

| Item | As built |
|---|---|
| Global prefix | **None.** Each controller carries its own `v1/...` prefix; `AppController` is prefix-less (`/health`, `/protocols`, `/venues`, `/venues/:key/snapshots`). |
| Global pipes / filters / interceptors / guards | **None.** No `ValidationPipe`, no `APP_FILTER`, no `ExceptionFilter`, no `CanActivate` anywhere in `apps/api/src`. |
| Validation library | **None.** `class-validator` / `class-transformer` / `zod` / `ajv` are not installed. Validation = manual guards (`common/request-validation.ts`, Lot SEC G1) + per-controller `if` checks + service-level allow-lists. |
| Error filter | Nest `BaseExceptionFilter` default. |
| CORS | `enableCors` with origin callback against `CORS_ORIGINS` (default `localhost:5173`), `credentials: true`, `maxAge: 3600`; a disallowed origin gets no ACAO header (no 500). |
| Body limit | API: Express 5 default (100 kB JSON). nginx: `client_max_body_size 100k`. |
| Fingerprint | `x-powered-by` disabled (Lot S2). |
| Bind | `HOST` default `127.0.0.1`, `PORT` default 3000. |
| ETag | Express default weak ETag on every JSON body (`ETag: W/"…"`, seen on prod and local) — the only cache header on the public tier besides the explicit `no-store` below. |
| Versions | Node `>=24` (`.nvmrc` 24; prod on 24), NestJS **11.1.16**, Express **5.2.1**, Prisma 5.22, Jest 30.3, TS 5.9.3. `@nestjs/swagger` / any OpenAPI package: **absent**. |

### A.1 Candidate public READ tier (15 routes)

Legend — Validation: `allow-list(silent)` = unknown value silently falls back to default; `400` = explicit BadRequest.
Zone: nginx `limit_req` zones from `docs/deployment.md` + `docs/internal/evidence/lot-sec/nginx-site-config-g1.conf`.
Shape source: every public response is an **inline object literal** in the service; two services also export a TS type.
Freshness: fields present in the payload. "network param": does the shape vary by a `network` input.

| # | Method + path | Params / validation | Auth | nginx zone | Cache | Shape source | Freshness fields | network param |
|---|---|---|---|---|---|---|---|---|
| 1 | `GET /health` | none | none | `api_general` (`location /`) | none (ETag only) | inline literal, `app.controller.ts` | `status`, `staleAfterSeconds`, `lastRefreshAt`, `freshness[].asOf/ageSeconds/isStale` | no |
| 2 | `GET /v1/protocols` | none | none | `api_general` (`location /v1/`) | **in-process `TtlCache` 90 s** (`STELLAR_LIST_CACHE_TTL_MS`, `common/ttl-cache.ts`, used in `stellar.service.ts`); no header | inline literal | `updatedAt`, `stale`, `isStale`, `staleAfterSeconds`, `ageSeconds` (per row, recomputed on cache hit) | no |
| 3 | `GET /v1/pools` | `protocol` (free text → bound `$1`), `sort` ∈ {tvlUsd, volume24hUsd, fees24hUsd, supplyApy, borrowApy, name, protocol} allow-list(silent), `order` asc else desc | none | `api_general` | same `TtlCache` 90 s, key = `protocol|sort|order` | inline literal | same as #2 | no |
| 4 | `GET /v1/pools/:poolSlug` | slug bound; unknown → **404** | none | `api_general` | none | inline literal, **two variants**: AMM (`tokens[]`, `metrics.swaps24h/trades24h`) vs lending/vault (`reserves[]`, `metrics.totalSupplied…/netLiquidityUsd/totalBackstopCreditUsd`) | same as #2 | no |
| 5 | `GET /v1/pools/:poolSlug/flows` | `window` ∈ {24h,7d,30d} allow-list(silent → 7d); 404 on slug | none | `api_general` | none | inline literal; `covered:false` short-form | `updatedAt` (= now), `coverageSince`; no isStale | no |
| 6 | `GET /v1/pools/:poolSlug/series` | 404 on slug | none | `api_general` | none | inline literal; `covered:false` when <2 points | `updatedAt` (= now), `first`, `last` | no |
| 7 | `GET /v1/network/stats` | none | none | `api_general` | none | exported TS type `NetworkStatsResponse` + literal | `updatedAt`, `isStale`, `staleAfterSeconds` | no |
| 8 | `GET /v1/network/tvl-series` | none (fixed 7 d / hour buckets) | none | `api_general` | none | exported TS type `NetworkTvlSeriesResponse` | `meta.from/to/firstSnapshotAt/partial/methodologyChangeAt` | no |
| 9 | `GET /v1/bridge/summary` | `window` allow-list(silent → 7d) | none | `api_general` | none | inline literal | `updatedAt` (= now), `lastFlowAt` | no |
| 10 | `GET /v1/bridge/flows` | `direction` ∈ {inflow,outflow} else no filter; `limit` Number, clamp 1..200, default 50 (`abc` → 50) | none | `api_general` | none | inline literal | none | no |
| 11 | `GET /v1/bridge/series` | `days` clamp 1..30, default 7 | none | `api_general` | none | inline literal | `updatedAt` (= now) | no |
| 12 | `GET /v1/ops/metrics` | none | none | `api_general` | none | inline literal | `window:"24h"`, per-run `runAt`; `faucet` sub-object | no |
| 13 | `GET /v1/ops/status` | `window` must be `24h` else **400** | none | `api_general` | `Cache-Control: no-store` (`@Header`) | TS type `OpsStatusPayload` (`ops/status.ts`, pure) + `priceSources` | `generatedAt`, `staleAfterSeconds`, `historySince`, `cadenceMinutes` | no |
| 14 | `GET /v1/ops/adoption` | none | none | `api_general` | none | inline literal | none (`boundary` text) | no |
| 15 | **`POST`** `/v1/actions/sdex/quote` | body `{fromAsset, toAsset, amount, network?}`; manual: asset string or `{code, issuer}` (regex), `amount` > 0, same-asset → 400, `network` absent/`testnet`/`mainnet` else 400 | none | `api_actions` 30 r/min burst 10 (`location /v1/actions/`) | none | TS type `SdexQuoteResult` `{sourceAmount, destAmount, rate}` | none | **yes**: `mainnet` → 403 unless `ACTIONS_MAINNET_ENABLED=true`; mainnet asset whitelist; live Horizon `strictSendPaths` call per request |

The SDEX quote is **POST-only** (`@Post('sdex/quote')`, `@HttpCode(200)`); there is no GET form.

### A.2 Non-public routes (for V4)

| Group | Routes | Auth transport | Zone | Note |
|---|---|---|---|---|
| Wallets (v2) | `POST /v1/wallets/connect`, `POST /v1/wallets`, `GET /v1/wallets`, `GET /v1/wallets/overview`, `GET /v1/wallets/:id/balances`, `GET …/positions`, `POST …/refresh`, `PATCH …/primary`, `…/signer`, `…/active`, `PATCH /v1/wallets/:id`, `DELETE /v1/wallets/:id` | `userId` as **query param** (or body on create/connect), validated UUID by SEC G1; no header, no bearer. `GET /v1/wallets` with no `userId` falls back to `DEMO_USER_ID` (`wallets.service.ts:33`) and returned 200 locally (deployment.md §G1 says "400 (userId required)" — doc drift, out of scope here) | `api_general` + `api_mutations` + `api_wallet_create` / `api_wallet_refresh` | refresh has an in-process admission limiter → custom 429 body (see A.3) |
| Alerts (v3) | `POST/GET /v1/alert-rules`, `GET …/priced-assets`, `…/tvl-pools`, `…/apy-pools`, `GET/PATCH/DELETE /v1/alert-rules/:id`; `GET /v1/notifications`, `…/unread-count`, `POST …/read-all`, `POST …/:id/read` | `userId` query | `api_general` + `api_mutations` | ownership → 404 |
| Actions builds | `POST /v1/actions/blend/deposit`, `…/blend/withdraw`, `…/blend/position`, `…/sdex/swap`, `POST /v1/actions/witness` | `address` in body (G1 regex) | `api_actions` | produce signable XDR / witness ledger |
| Faucet (money path) | `GET /v1/faucet/eligibility` (no-store), `POST /v1/faucet/claim` | address + userId | `api_actions` (claim) | dark unless `FAUCET_ENABLED` |
| Campaign / auth (Lot EP) | `POST /v1/auth/challenge`, `…/verify`; `GET /v1/campaign` (max-age=60), `POST …/enroll`, `…/checkin`, `…/social`, `DELETE …/social/:id`, `GET …/me`, `…/me/activity` (no-store), `…/leaderboard`, `…/metrics` (max-age=60) | address + userId + signed challenge | `api_general` + `api_mutations` | only `GET /v1/campaign/metrics` is consumed by the web as a public read |
| Legacy prefix-less | `GET /protocols`, `GET /venues?protocol=`, `GET /venues/:key/snapshots?limit=` | none | `api_general` (`location /`) | Prisma `Protocol/Venue/Snapshot` models (seed data: `blend:demo-market`). **Not referenced by `apps/web`**: the only `/protocols` call in the web (`src/api/protocols.ts`) goes through `apiFetch`, whose base URL always ends in `/v1`, so it hits `/v1/protocols`. Nothing else in the repo (indexer, docs, compose, nginx) calls them. They can be removed or left unmapped without breaking anything served to the product. |

### A.3 Error shapes (captured from the local worktree API unless stated)

| Status | Trigger | Body (verbatim) | Shape |
|---|---|---|---|
| 400 | `GET /v1/ops/status?window=7d` | `{"message":"Unsupported window '7d'. Supported: 24h","error":"Bad Request","statusCode":400}` | **S1** Nest standard |
| 400 | SEC G1 guard, `POST /v1/actions/blend/position` `{"address":"nope"}` | `{"message":"address must be a Stellar public key (G…)","error":"Bad Request","statusCode":400}` | S1 |
| 400 | controller check, quote with same asset | `{"message":"fromAsset and toAsset must differ","error":"Bad Request","statusCode":400}` | S1 |
| 400 | malformed JSON body (`{bad`) — Express body-parser error re-wrapped by Nest | `{"message":"Expected property name or '}' in JSON at position 1 (line 1 column 2)","error":"Bad Request","statusCode":400}` | S1 |
| 400 | malformed URI `GET /v1/pools/%E0%A4%A` | `{"message":"Failed to decode param '%E0%A4%A'","error":"Bad Request","statusCode":400}` | S1 |
| 400 | `POST /v1/actions/witness` `{}` | `{"message":"txHash must be a 64-char hex transaction hash","error":"Bad Request","statusCode":400}` | S1 |
| 400 | `POST /v1/alert-rules` `{}` | `{"message":"Unsupported metric. Supported today: 'health_factor', 'price', 'tvl_drop_pct', 'supply_apy', 'borrow_apy'.","error":"Bad Request","statusCode":400}` | S1 |
| **400** | **actions spendable preflight**, `POST /v1/actions/sdex/swap` with an over-sized amount (one Horizon read of a testnet issuer account) | `{"code":"INSUFFICIENT_SPENDABLE_BALANCE","message":"Insufficient spendable XLM balance: 69774.5623753 available. The rest is reserved by the Stellar network","asset":"XLM","spendable":"69774.5623753","requested":"999999999"}` | **S2** custom object, **no `statusCode` / `error` keys** (Nest passes an object given to `BadRequestException` through untouched) |
| 403 | `network:"mainnet"` with the kill-switch off | `{"message":"Mainnet actions are not enabled.","error":"Forbidden","statusCode":403}` | S1 |
| 404 | unknown pool slug | `{"message":"Pool not found: does-not-exist","error":"Not Found","statusCode":404}` | S1 |
| 404 | unknown route `GET /v1/nope` | `{"message":"Cannot GET /v1/nope","error":"Not Found","statusCode":404}` | S1 |
| 404 | alert rule not owned | `{"message":"Alert rule not found.","error":"Not Found","statusCode":404}` | S1 |
| 422 | quote with no direct liquidity (one Horizon read) | `{"message":"No direct liquidity for XLM→ZZZQ at this amount on testnet","error":"Unprocessable Entity","statusCode":422}` | S1 |
| 429 | **nginx** `limit_req` (not reproducible locally; body is the literal in `nginx-site-config-g1.conf:38`, with `Retry-After: 1` + ACAO echo) | `{"statusCode":429,"error":"Too Many Requests","message":"Rate limit exceeded - please slow down."}` | **S3** same three keys as S1, different producer (never reaches Nest) |
| 429 | wallet refresh admission limiter (`wallets.service.ts:1265`, `HttpException` with object) — not exercised | `{"statusCode":429,"error":"Too Many Requests","message":"…","reason":"capacity"\|"cooldown"}` | S1 + extra `reason` |
| 500 | Nest default for any non-`HttpException` throw — not reproducible from the public tier today (every malformed input tried was absorbed: `sort[]=tvl`, `limit=abc`, `window=bogus`) | `{"statusCode":500,"message":"Internal server error"}` (from `@nestjs/core` `base-exception-filter.js:41`) | **S4** two keys, no `error` |
| 503 | `/health` when the DB is unreachable (not reproducible without stopping Postgres) | the **full health payload** (`status:"degraded"`, `db.ok:false`, …) thrown as the body — no `statusCode`/`message` | **S5** |

Count: **one dominant shape (S1, `{message, error, statusCode}`) plus four deviants**: S2 actions custom code object, S3 nginx 429 (same keys, upstream of Nest), S4 Nest 500 (no `error`), S5 health 503 (domain payload).

### A.4 Dependencies and tests

| Item | Value |
|---|---|
| OpenAPI / swagger package | none in `apps/api/package.json` or `node_modules` |
| Schema validators available | none (`ajv`, `class-validator`, `zod` all absent) |
| Jest run (`npx jest`, Node 24.22) | **34 suites passed, 3 skipped (DB-gated integration); 387 tests passed, 43 skipped, 430 total, 1.7 s** |
| `test/` e2e | `app.e2e-spec.ts` + `jest-e2e.json` scaffold only |

Tests per module (passed / skipped):

| Module | Spec files | Passed | Skipped |
|---|---|---|---|
| campaign | 9 | 139 | 37 |
| alerts | 6 | 71 | 0 |
| common | 3 | 42 | 0 |
| wallets | 6 | 42 | 0 |
| faucet | 3 | 29 | 0 |
| actions | 2 | 19 | 0 |
| ops (`status.spec.ts`) | 1 | 19 | 0 |
| stellar (list-cache, pool-series-amount, price-max-age, supplied-side) | 4 | 16 | 0 |
| scripts (84 campaign award) | 2 | 6 | 6 |
| app.controller (`/health`) | 1 | 4 | 0 |
| **bridge, network** | **0** | 0 | 0 |

No public-tier spec asserts a full response shape; the stellar/ops specs test SQL fragments, cache behaviour and the pure status reducer.

### A.5 Sample responses (local worktree API `:3101`, trimmed to 1–2 array items)

Source: local for all 15; `priceSources`/`runs` on `/v1/ops/status` are empty locally because no refresh ran in the last 24 h on this machine (prod carries runs). Full captures in the session scratchpad only (not committed).

`GET /health`
```json
{"status":"degraded","version":"unknown","uptimeSeconds":14,"db":{"ok":true,"latencyMs":1},
 "staleAfterSeconds":2700,
 "freshness":[{"venue":"allbridge","asOf":null,"ageSeconds":null,"isStale":null},
              {"venue":"aquarius","asOf":"2026-10-30T19:08:17.202Z","ageSeconds":259052,"isStale":true}],
 "lastRefreshAt":"2026-10-30T19:08:00.000Z"}
```

`GET /v1/protocols` (7 rows: allbridge, aquarius, blend, defindex, soroswap, stellar-native, xoxno)
```json
[{"id":"xoxno","name":"XOXNO","type":"lending","chain":"stellar-mainnet","logoUrl":null,
  "tvlUsd":144775.32,"volume24hUsd":0,"fees24hUsd":0,"avgSupplyApy":0.00537,"avgBorrowApy":0.02327,
  "topAssets":[{"symbol":"EURC","logoUrl":"https://…/logo.png","tvlUsd":null}],"assetCount":25,
  "updatedAt":"2026-10-30T19:08:17.209Z","stale":true,"isStale":true,"staleAfterSeconds":2700,"ageSeconds":259052}]
```

`GET /v1/pools` (95 rows: aquarius 21 amm_pool, blend 4 lending_pool, defindex 3 yield_vault, soroswap 4 amm_pool, stellar-native 60 amm_pool, xoxno 3 lending_pool)
```json
[{"id":"xoxno-amm-hub","name":"AMM hub","type":"lending_pool",
  "protocol":{"id":"xoxno","name":"XOXNO","type":"lending","logoUrl":null},
  "chain":"stellar-mainnet","contractAddress":"CBXRND…BKXO",
  "tokens":[{"assetId":"63452a7b-…","symbol":"AQUA","logoUrl":null,"role":"reserve"}],
  "metrics":{"tvlUsd":1999.37,"volume24hUsd":0,"fees24hUsd":0,"totalSuppliedUsd":1999.37,"totalBorrowedUsd":0,
             "supplyApy":0,"borrowApy":null,"swaps24h":null},
  "updatedAt":"2026-10-30T19:07:53.060Z","stale":true,"isStale":true,"staleAfterSeconds":2700,"ageSeconds":259076}]
```

`GET /v1/pools/:slug` — lending variant (`blend-etherfuse-pool`)
```json
{"id":"blend-etherfuse-pool","name":"Etherfuse","protocol":{"id":"blend","name":"Blend","type":"lending","logoUrl":null},
 "chain":"stellar-mainnet","type":"lending_pool","contractAddress":"CDMAVJ…PVAI",
 "metrics":{"tvlUsd":15009.66,"totalSuppliedUsd":15009.66,"totalBorrowedUsd":1362.94,"totalBackstopCreditUsd":243.65,
            "netLiquidityUsd":13646.72,"supplyApy":0.000289,"borrowApy":0.00396,"volume24hUsd":0,"fees24hUsd":0,"events24h":0},
 "reserves":[{"assetId":"5e0f35b5-…","symbol":"CETES","name":"CETES:GCRY…MYWC","logoUrl":null,"decimals":7,"priceUsd":null,
              "supplied":108481.76,"borrowed":23.39,"backstopCredit":6.06,"supplyCap":160000000,
              "supplyApr":1E-7,"supplyApy":1.0000001E-7,"borrowApr":0.0010009,"borrowApy":0.0010014}],
 "updatedAt":"2026-10-30T18:58:22.864Z","stale":true,"isStale":true,"staleAfterSeconds":2700,"ageSeconds":259689}
```
Note `"supplyApr":1E-7` — Prisma `Decimal` → `toNumber()` serialises as a JS number; JSON Schema `number` accepts it.

`GET /v1/pools/:slug` — AMM variant (`aquarius-aqua-usdc-clpool`)
```json
{"id":"aquarius-aqua-usdc-clpool","name":"AQUA/USDC Concentrated","protocol":{"id":"aquarius","name":"Aquarius","type":"amm","logoUrl":null},
 "chain":"stellar-mainnet","type":"amm_pool","contractAddress":"CBRUQ7…YYZ7",
 "metrics":{"tvlUsd":68523.97,"volume24hUsd":48411.31,"fees24hUsd":144.43,"events24h":0,"swaps24h":0,"trades24h":null},
 "tokens":[{"assetId":"63452a7b-…","symbol":"AQUA","name":"AQUA:GBNZ…AQUA","logoUrl":null,"decimals":7,"priceUsd":null,"reserve":175167736.99,"reserveUsd":null}],
 "updatedAt":"2026-10-30T18:59:43.147Z","stale":true,"isStale":true,"staleAfterSeconds":2700,"ageSeconds":259609}
```

`GET /v1/pools/:slug/flows?window=7d` (covered) / blend (not covered → `series:[]`, `coverageSince:null`, zero totals, same keys)
```json
{"slug":"aquarius-aqua-usdc-clpool","covered":true,"window":"7d","days":7,"coverageSince":"2026-08-15",
 "series":[{"day":"2026-10-27","inflowUsd":0,"outflowUsd":0,"netUsd":0,"cumulativeNetUsd":0}],
 "totals":{"inflowUsd":0,"outflowUsd":0,"netUsd":0,"depositCount":34,"withdrawCount":35},
 "updatedAt":"2026-11-02T19:06:32.045Z"}
```

`GET /v1/pools/:slug/series` (all three kinds returned `covered:false` locally — the local DB has no fresh price rows; shape is identical when covered, with `points:[{day,tvlUsd}]`)
```json
{"slug":"blend-etherfuse-pool","covered":false,"kind":"tvl","points":[],"first":null,"last":null,"updatedAt":"2026-11-02T19:06:32.067Z"}
```

`GET /v1/network/stats`
```json
{"xlmPriceUsd":0.16718,"xlmPriceChange24hPct":null,"stellarTvlUsd":212910354.34,"activeWallets":null,
 "stableMcapUsd":328448762.67,"dexVolume24hUsd":null,"protocolCount":6,"usdcSupplyUsd":317023820.95,"avgTxFeeXlm":0.00001,
 "updatedAt":"2026-10-30T19:08:19.791Z","isStale":true,"staleAfterSeconds":2700}
```

`GET /v1/network/tvl-series`
```json
{"series":[{"t":"2026-10-26T19:00:00.000Z","tvlUsd":216051405.28,"tvlNetUsd":184289965.88,"protocolCount":5}],
 "meta":{"source":"snapshots","from":"2026-10-26T19:06:32.202Z","to":"2026-11-02T19:06:32.202Z",
         "firstSnapshotAt":"2026-08-13T08:49:00.000Z","partial":false,"bucket":"hour","methodologyChangeAt":"2026-08-17T18:02:00.000Z"}}
```

`GET /v1/bridge/summary?window=7d` (Allbridge dormant → zeros; `byChain[]` items are `{chainId, chain, amountUsd, count}`)
```json
{"window":"7d","token":"USDC","inflow":{"totalUsd":0,"count":0,"byChain":[]},"outflow":{"totalUsd":0,"count":0,"byChain":[]},
 "netUsd":0,"lastFlowAt":null,"updatedAt":"2026-11-02T19:06:32.215Z"}
```

`GET /v1/bridge/flows?limit=2`
```json
{"count":2,"limit":2,"flows":[{"direction":"inflow","chainId":13,"chain":"SUI","token":"USDC","amountScaled":49.79,"amountUsd":49.79,
 "txHash":"acbe479c…a75b91","recipient":null,"occurredAt":"2026-07-08T14:16:08.000Z"}]}
```

`GET /v1/bridge/series?days=3`
```json
{"days":3,"series":[{"day":"2026-10-31","inflowUsd":0,"outflowUsd":0,"netUsd":0}],"updatedAt":"2026-11-02T19:06:32.232Z"}
```

`GET /v1/ops/status` (`Cache-Control: no-store`; `runs`/`components` empty locally)
```json
{"window":"24h","generatedAt":"2026-11-02T19:06:32.351Z","cadenceMinutes":15,"staleAfterSeconds":2700,
 "historySince":"2026-08-13T08:43:59.238Z","noDataBefore":null,"runs":[],"gaps":[],
 "overall":{"state":"unknown","lastRunAt":null,"missedCycles24h":0,"failedSteps24h":0},"components":[],
 "priceSources":{"pricedAssets":0,"totalAssets":32,"unpricedAssets":["AQUA","…"],"referenceAssets":[],"singleSourceAssets":[],"disagreements":[]}}
```

`GET /v1/ops/metrics` (`rpc[]` items: `{target, calls, errors, errorRate, latest:{runAt,p50Ms,p95Ms,p99Ms}, runs:[…]}`; `steps[]`: `{step,lastRunAt,lastStatus,lastDurationMs,lastMessage,failures24h}`)
```json
{"window":"24h","scope":"indexer refresh pipeline","rpc":[],"steps":[],
 "faucet":{"enabled":false,"network":"testnet","campaign":2,"rewardXlm":5,
           "claims":{"pending":0,"paid":0,"failed":0,"paid24h":0,"remainingClaims":40},
           "allTime":{"pending":0,"paid":0,"failed":0},"treasurySpendableXlm":null}}
```

`GET /v1/ops/adoption`
```json
{"boundary":"Counts successful server-side BUILDS (quotes + signable XDRs). …",
 "wallets":{"total":9,"signers":3,"watchOnly":6,"distinctUsers":4},
 "actions":{"total":16,"byKind":[{"kind":"blend-deposit-build","network":"testnet","count24h":0,"count7d":0,"total":3}],
            "distinctAddresses":{"count24h":0,"count7d":0,"total":5}}}
```

`POST /v1/actions/sdex/quote` `{"fromAsset":"XLM","toAsset":"USDC","amount":"10"}` (testnet, one live Horizon call)
```json
{"sourceAmount":"10","destAmount":"8.1115521","rate":0.8111552100000001}
```

Legacy `GET /protocols` → Prisma seed rows (`{"id":"cmmnf0…","key":"blend","name":"Blend","category":"lending",…,"venues":[…]}`); `GET /venues/blend-fixed-pool/snapshots` → `{"venue":null,"snapshots":[]}` (200, not 404).

### A.6 XOXNO lending

| Question | Answer |
|---|---|
| Own routes? | **No.** `xoxno` is a `venues` row (`venue_type: lending`) with 3 `entities` of `entity_type: lending_pool` (`xoxno-amm-hub`, …). It surfaces only through `/v1/protocols` (one row) and `/v1/pools` (3 rows) + `/v1/pools/:slug`. |
| Payload shape vs Blend | **Identical keys** on all three reads (verified: detail keys and `reserves[]` keys match the Blend lending variant; `/v1/pools` row has the same `metrics` keys). Only semantics differ (`borrowApy: null` on the hub, 11 reserves). |
| Venue-specific code | Two sites only: `stellar.service.ts:999` (`series` TVL amount = `metadata.cash` for `venue_slug === 'xoxno'`, else `b_supply_scaled`) and `ops/status.ts:87` (step label). Neither changes the contract. |

### A.7 Non-determinism / environment dependence in the public tier

| Route | Source of variance |
|---|---|
| `POST /v1/actions/sdex/quote` | **Live Horizon** `strictSendPaths` per request (testnet or mainnet); `network` body param; `ACTIONS_MAINNET_ENABLED` kill-switch (403); mainnet asset whitelist; 500 if Horizon fails; 422 if no direct path. The only public-candidate route with an external fetch at request time. |
| `GET /v1/network/stats` | **No live fetch** any more (contrary to the CLAUDE.md note): reads `network_stats_latest` written by the indexer. Cold start → all-null payload with `protocolCount: 3`. |
| `GET /health` | `version` = `GIT_SHA` env (`"unknown"` when unset; the prod value was not read, only headers); `uptimeSeconds` monotonic; 503 only on DB failure. |
| `/v1/protocols`, `/v1/pools` | 90 s in-process cache (`STELLAR_LIST_CACHE_TTL_MS`, `0` disables) → `ageSeconds` keeps ticking but rows can lag ≤ 90 s. |
| Every freshness field | `FRESHNESS_STALE_AFTER_MINUTES` (default 45, legacy `STALE_THRESHOLD_MINUTES`) and `PRICE_MAX_AGE_MINUTES` change `isStale` and which prices count as present (`tvlUsd` can flip to `null`). |
| Time-window params | `window` (24h/7d/30d) on flows + bridge summary, `days` on bridge series; `/v1/ops/*` fixed 24 h; `/v1/network/tvl-series` fixed 7 d; `updatedAt` = `now()` on flows/series/bridge/ops (never byte-stable). |
| `/v1/ops/metrics.faucet` | `FAUCET_ENABLED`, `FAUCET_NETWORK`, campaign config → `enabled`/`network`/`remainingClaims` vary per deploy. |
| Data-shape forks | `/v1/pools/:slug` AMM vs lending variant is decided by `venue_type`/`entity_type`; `flows`/`series` `covered:false` short-forms keep the same keys (good for a schema). |

---

## Part B — evidence corpus sizing

### B.8 Size

`du -sh docs/internal/evidence` → **72 M** (`du -sk` = 73 288 KB, 559 files).

| Dir / file | KB |
|---|---|
| lot-aa | 34 404 |
| lot-h | 10 320 |
| lot-c | 7 728 |
| lot-f | 7 068 |
| lot-q | 5 624 |
| lot-r | 2 896 |
| lot-xo | 1 700 |
| lot-g | 904 |
| lot-b | 708 |
| lot-ep | 636 |
| status-page | 564 |
| price-sources-v2 | 120 |
| lot-e | 92 |
| lot-p | 76 |
| lot-an0 | 68 |
| lot-ad | 56 |
| lot-w, lot-s, lot-n, hotfix-xlm-price-fallback | 28 each |
| pair-vetting-2026-08-01.md, lot-sec, lot-ac | 24 each |
| perf-pools, lot-rp | 20 each |
| lot-a5-blend-multipool.md, hotfix-lending-supplied-side | 16 each |
| t3-d2-mainnet-actions.md, lot-a3-blend-withdraw.md, dead-reserves-2026-08-14.md | 12 each |
| lot-z, lot-r2, analytics | 8 each |
| mainnet-ungating-2026-08-02.md, lot-ab | 4 each |

### B.9 Files by extension + 15 largest

| Ext | Count |
|---|---|
| png | 414 |
| md | 92 |
| json | 24 |
| txt | 17 |
| html | 6 |
| jpg | 2 |
| conf | 2 |
| sql | 1 |
| diff | 1 |

Binaries (png + jpg): **71 130 KB of 73 288 KB = 97 %**.

| KB | File |
|---|---|
| 1 495 | lot-f/f5-pairlogo-after-vault-2026-08-12.png |
| 1 485 | lot-f/f5-pairlogo-before-pool-2026-08-12.png |
| 1 477 | lot-f/f5-pairlogo-after-pool-2026-08-12.png |
| 1 284 | lot-f/f5-pairlogo-before-protocols-2026-08-12.png |
| 1 043 | lot-c/c1-shell.png |
| 1 031 | lot-c/c3-protocols.png |
| 967 | lot-c/c2-pool-aquarius.png |
| 922 | lot-f/f5-pairlogo-after-protocols-2026-08-12.png |
| 829 | lot-c/c4-portfolio.png |
| 776 | lot-r/r3b-promo-after.png |
| 759 | lot-r/r3b-promo-before.png |
| 701 | lot-c/c2-pool-blend.png |
| 692 | lot-b/defindex-pool-detail.png |
| 679 | lot-r/fix-blend-modal-after.png |
| 650 | lot-r/fix-blend-modal-before.png |

### B.10 Cross-reference

Method: a file is "unreferenced" when its **basename** appears in no `docs/**/*.md` other than itself (README.md files skipped). Caveat: lot-aa's `aa0-breakage-catalog.md` / `aa4-close-out.md` reference capture **directories** (`captures/aa0/`, `captures/aa1`, …), not individual PNGs, so most of the lot-aa count is "referenced by folder".

**Unreferenced: 334 of 559 files.** By directory:

| Dir | Unreferenced |
|---|---|
| lot-aa (captures) | 237 |
| lot-q | 25 |
| lot-h | 20 |
| lot-g | 10 (incl. 4 `.html` previews, 6 `.md`) |
| lot-e | 7 (`.txt` run summaries) |
| lot-p | 5 |
| lot-n | 5 (`n0`–`n4` `.md`) |
| lot-f | 4 |
| lot-c | 4 |
| price-sources-v2 | 3 (`.md`) |
| lot-s | 3 (`.txt`) |
| lot-ep | 3 (`ep1/2/3-implementation.md`) |
| lot-w | 2 (`.md`) |
| lot-r | 2 (`.md`) |
| status-page, lot-xo, lot-b, lot-ab | 1 each |

Of the 92 Markdown files, **26 are not linked from any other doc** (lot-n ×5, lot-g ×6, price-sources-v2 ×3, lot-ep ×3, lot-w ×2, lot-r ×2, lot-q ×3, lot-f ×2, lot-aa ×2, lot-ab, lot-xo, status-page, lot-p — see list above).

**Broken links: 0.** Every Markdown link into `docs/internal/evidence` from `docs/status-board.md`, `docs/current-state.md` (and, second pass, from every `docs/**/*.md` outside `evidence/`) resolves. The only non-resolving textual hit is `docs/internal/evidence/lot-{c,f,g,h}/` in status-board.md line 408, a brace expansion in prose, not a link.

### B.11 Exact duplicates (md5)

**49 groups, 113 files** (so 64 redundant copies). By directory: lot-aa 101 files, lot-h 8, lot-q 4. Pattern: the same smoke capture re-saved under `captures/aa2/smoke`, `aa3/smoke`, `aa4/smoke`; `main-1440-*` vs `branch-1440-*` desktop diffs where nothing changed; before/after pairs that are byte-identical (`lot-h/h6-*-after.png` = `h7-*-before.png`, `lot-q/q1-swap-select-before.png` = `…-after.png`). Largest redundant set is lot-aa (≈ 34 MB folder).

### B.12 Index / structure

| Item | State |
|---|---|
| `docs/internal/evidence/README.md` or `index.md` | **does not exist** |
| Sub-folders | 30 (`analytics`, `hotfix-lending-supplied-side`, `hotfix-xlm-price-fallback`, `lot-aa`, `lot-ab`, `lot-ac`, `lot-ad`, `lot-an0`, `lot-b`, `lot-c`, `lot-e`, `lot-ep`, `lot-f`, `lot-g`, `lot-h`, `lot-n`, `lot-p`, `lot-q`, `lot-r`, `lot-r2`, `lot-rp`, `lot-s`, `lot-sec`, `lot-w`, `lot-xo`, `lot-z`, `perf-pools`, `price-sources-v2`, `status-page`) |
| Single top-level `.md` lots | 6 (`dead-reserves-2026-08-14.md`, `lot-a3-blend-withdraw.md`, `lot-a5-blend-multipool.md`, `mainnet-ungating-2026-08-02.md`, `pair-vetting-2026-08-01.md`, `t3-d2-mainnet-actions.md`) |
| Sub-folders with their own `README.md` | 5 (`hotfix-lending-supplied-side`, `lot-b`, `lot-c`, `lot-e`, `perf-pools`) |

---

## Verdicts

**V1 — DTO classes and the cheaper path.** No response DTO class exists anywhere on the public tier: every payload is an inline object literal, two services export a plain TS `type` (`NetworkStatsResponse`, `NetworkTvlSeriesResponse`, `OpsStatusPayload`), `/v1/pools/:slug` returns two literal variants from one method, and `@nestjs/swagger` plus `class-validator` are absent. Path (a) would mean adding `@nestjs/swagger` + `swagger-ui-express`, writing ~14 DTO classes with `@ApiProperty` on ~120 fields, decorating 6 controllers, and changing every public service to return typed instances (or accepting decorators that document a class the code never instantiates, which drifts silently) — roughly 20 new files + 11 edited files including all five service files, for a spec Nest still cannot verify against real bodies. Path (b) is one hand-written `apps/api/openapi/openapi.v1.yaml` (15 operations, ~12 shared schemas), one tiny controller serving `GET /v1/openapi.json` + `GET /v1/docs` (2 files), one dev dependency (`ajv` + `ajv-formats`, or `@apidevtools/swagger-parser` for spec validity), and one `apps/api/src/openapi/contract.spec.ts` that boots the real Nest app with supertest and validates each public response against the spec — ~5 new files, **zero service file changes**, and the test is the thing that proves the spec. **Recommendation: (b).** Fold the five error shapes into `components.responses` honestly rather than pretending S1 is the only one.

**V2 — Error shape.** Five shapes exist: S1 Nest `{message, error, statusCode}` (every explicit throw on the public tier), S2 the actions `{code, message, asset, spendable, requested}` object (400 only), S3 nginx's 429 literal (same keys as S1, different order, never reaches Nest), S4 Nest's 500 `{statusCode, message}`, S5 the `/health` 503 domain payload. A single global `ExceptionFilter` can unify S1/S2/S4 at zero risk to `apps/web`: the web's `ApiError` stores the raw body text and only `SdexSwapWidget.friendlyBuildError` parses it, reading `body.code` and `body.message` — so the filter must keep `code`/`spendable`/`message` on S2 while adding `statusCode`/`error` (additive, nothing reads key order). The 429 handlers (`useWallets`, `FaucetClaimPanel`, `ConnectModal`) look at `err.status` only, so S3 is untouched, and S3 cannot be changed by Nest anyway. S5 is deliberate (monitor-readable) and should stay; document it as its own response. Net: the lot can ship a filter that guarantees `statusCode` + `message` on every Nest-produced error with no web change, **or** simply document the four Nest shapes as they are — the spec does not require the filter.

**V3 — stable vs beta.** `stable`: `GET /health` (shape since 2026-08-13, 4 tests, 0 commits since 09-01), `/v1/network/stats` and `/v1/network/tvl-series` (0 commits since 09-01, last 2026-08-18, methodology fixed by the 2026-08-17 ruling), `/v1/bridge/*` (controller untouched since 2026-06-29, service 2 commits ever; no tests but the data is dormant), `/v1/protocols` and `/v1/pools` (controller untouched since 2026-08-09; service had 5 commits since 09-01 but all touched SQL/caching, not keys — the `stale` alias is the only legacy wart), `/v1/pools/:slug` (same; the AMM/lending fork is old and the web depends on it). `beta`: `/v1/ops/status` (6 commits on `status.ts` since 09-01, `priceSources` added 2026-10-15, `window` is the one 400-validated param and only `24h` is accepted), `/v1/ops/metrics` (`faucet` sub-object varies per deploy, `rpc[]` target list grew on 2026-10-15/27), `/v1/ops/adoption` (KPI counters, `byKind` enum open), `/v1/pools/:slug/flows` and `/series` (`covered` semantics changed in H4 and XO, `updatedAt` is `now()`, series is "degraded approximation" by its own comment), and `POST /v1/actions/sdex/quote` (live Horizon, kill-switch, asset whitelist — publishable but must be marked `beta` and testnet-default).

**V4 — out of the public spec.** Everything under `/v1/wallets/*` (userId-scoped, mutations, demo-user fallback), `/v1/alert-rules/*` and `/v1/notifications/*` (userId-scoped), `/v1/actions/blend/*`, `/v1/actions/sdex/swap`, `/v1/actions/witness` (signable XDR builders and the executed-tx ledger), `/v1/faucet/*` (money path, server-side key), `/v1/auth/*` and `/v1/campaign/*` (signed-challenge session; only `GET /v1/campaign/metrics` is a public read and it is a points KPI, not analytics), and the legacy prefix-less `/protocols`, `/venues`, `/venues/:key/snapshots`. Nothing depends on the legacy routes: the web's only `/protocols` call is prefixed to `/v1` by `apiFetch`, the indexer never calls the API, and no doc, compose file or nginx location names them (`location /` only exists to reach `/health`). They can be hidden from the spec now and removed from `AppController` whenever a founder commit touches it.

**V5 — serving `/v1/docs` under the API vhost.** There is **no CSP** on `stellar-api.getdig.ai` (confirmed in the deployed conf and on the live `HEAD /health`: only HSTS, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`), so a Scalar page loading its bundle from a CDN is not blocked. Two real constraints: `nosniff` means the page must be served with `Content-Type: text/html` explicitly (Nest's `@Header` or `res.type('html')`), and `X-Frame-Options: DENY` only prevents embedding the docs page elsewhere, which is fine. `/v1/docs` and `/v1/openapi.json` fall under `location /v1/` → `api_general` 10 r/s + the `api_mutations` map (GET exempt), so a page load that pulls `openapi.json` once stays far below the limit. `Referrer-Policy: no-referrer` and `client_max_body_size 100k` are irrelevant to GETs. If the CDN dependency is unwanted, inlining the Scalar bundle would exceed the point of "single static HTML" only in size, not in headers.

**V6 — evidence corpus.** 73 288 KB over 559 files; 97 % is PNG/JPG (414 PNG + 2 JPG = 71 130 KB), lot-aa alone is 47 % of the corpus; 334 files (237 of them lot-aa captures referenced only by folder) have no per-file link from any Markdown, 26 of the 92 `.md` files are orphaned from every other doc; **0 broken links**; 49 duplicate groups covering 113 files (64 redundant copies, 101 in lot-aa); no top-level README or index, 5 of 30 sub-folders have their own README, 6 lots are single top-level files. Nothing is broken today — every link the status board, roadmap and current-state cite resolves — so before 2026-11-08 an index README that lists each lot with its one entry document is sufficient; the 64 duplicate PNGs and the oversized lot-f/lot-c screenshots are a size nuisance for the application reviewer's clone, not a correctness problem, and can wait.
