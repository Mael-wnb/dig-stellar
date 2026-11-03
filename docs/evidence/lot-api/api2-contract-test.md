# API2 — contract test run (2026-11-03)

Full output of the HTTP contract test ("contract" = the HTTP API contract) that boots the real
`AppModule` and validates every operation of `apps/api/openapi/openapi.v1.yaml` against the
API with ajv. Run from the `feat/lot-api` worktree on top of commit `a321ec7`
(API2 contract + API3 hardening: Scalar pin, route-local CORS), after `pnpm -C apps/api build`.

| Item | Value |
|---|---|
| Command | `DATABASE_URL=postgresql://…@localhost:5432/dig_stellar pnpm -C apps/api test:contract` |
| Database | local compose Postgres on `localhost:5432`, database `dig_stellar` (credentials omitted); data last refreshed 2026-10-30 (stale rows are fine: the schemas describe shape, not freshness) |
| Network | outbound HTTPS to Horizon testnet for the three quote calls (200, 422) |
| Date | 2026-11-03, 19:34 UTC |
| HEAD | `a321ec7` |
| Node | 24 (`.nvmrc`) |
| Result | **40/40 checks passed, 0 failed** (exit 0) |

Companion runs the same day: `pnpm -C apps/api test` → 387 passed, 43 skipped, 430 total
(unchanged by the lot); `pnpm -C apps/api build` green with `dist/openapi/openapi.v1.yaml`
byte-identical to the source.

The `[StellarService.getPoolDetail] poolSlug= does-not-exist` lines and the
`NotFoundException` dump are the existing service's own `console.error` on a 404, not a
test failure.

## Output (verbatim)

```text

> api@0.0.1 test:contract /Users/maelhenry/Documents/Eon/Dig/dig-stellar-rp/apps/api
> ts-node --transpile-only test/contract/run-contract-test.ts

spec: /Users/maelhenry/Documents/Eon/Dig/dig-stellar-rp/apps/api/openapi/openapi.v1.yaml (Dig Stellar API 1.0.0)
PASS  GET /v1/pools  [stable]
discovered slugs: {"amm":"aquarius-aqua-usdc-clpool","native":"stellar-native-5x-xrp-pool","lending":"blend-etherfuse-pool","lendingOther":"xoxno-amm-hub","vault":"defindex-beans-eurc"}
PASS  GET /health  [stable]
PASS  GET /v1/protocols  [stable]
PASS  GET /v1/pools?protocol=blend&sort=tvlUsd&order=desc  [stable]
PASS  GET /v1/pools/aquarius-aqua-usdc-clpool (amm)  [stable]
PASS  GET /v1/pools/stellar-native-5x-xrp-pool (native)  [stable]
PASS  GET /v1/pools/blend-etherfuse-pool (lending)  [stable]
PASS  GET /v1/pools/xoxno-amm-hub (lendingOther)  [stable]
PASS  GET /v1/pools/defindex-beans-eurc (vault)  [stable]
PASS  GET /v1/pools/aquarius-aqua-usdc-clpool/flows?window=7d  [beta]
PASS  GET /v1/pools/aquarius-aqua-usdc-clpool/series  [beta]
PASS  GET /v1/pools/blend-etherfuse-pool/flows?window=7d  [beta]
PASS  GET /v1/pools/blend-etherfuse-pool/series  [beta]
PASS  GET /v1/network/stats  [stable]
PASS  GET /v1/network/tvl-series  [stable]
PASS  GET /v1/bridge/summary?window=30d  [stable]
PASS  GET /v1/bridge/flows?direction=inflow&limit=5  [stable]
PASS  GET /v1/bridge/series?days=14  [stable]
PASS  GET /v1/ops/status  [beta]
PASS  GET /v1/ops/metrics  [beta]
PASS  GET /v1/ops/adoption  [beta]
PASS  POST /v1/actions/sdex/quote (testnet XLM→USDC)  [beta]
[StellarService.getPoolDetail] poolSlug= does-not-exist
NotFoundException: Pool not found: does-not-exist
    at StellarService.getPoolDetail (/Users/maelhenry/Documents/Eon/Dig/dig-stellar-rp/apps/api/src/modules/stellar/stellar.service.ts:600:15)
    at async /Users/maelhenry/Documents/Eon/Dig/dig-stellar-rp/node_modules/.pnpm/@nestjs+core@11.1.16_@nestjs+common@11.1.16_reflect-metadata@0.2.2_rxjs@7.8.2__@nestjs+_28373ffc0dd4ba6d0b9c40c76d0e75ba/node_modules/@nestjs/core/router/router-execution-context.js:46:28
    at async /Users/maelhenry/Documents/Eon/Dig/dig-stellar-rp/node_modules/.pnpm/@nestjs+core@11.1.16_@nestjs+common@11.1.16_reflect-metadata@0.2.2_rxjs@7.8.2__@nestjs+_28373ffc0dd4ba6d0b9c40c76d0e75ba/node_modules/@nestjs/core/router/router-proxy.js:9:17 {
  response: {
    message: 'Pool not found: does-not-exist',
    error: 'Not Found',
    statusCode: 404
  },
  status: 404,
  options: {}
}
PASS  GET /v1/pools/does-not-exist → 404
PASS  GET /v1/pools/does-not-exist/flows → 404
PASS  GET /v1/pools/does-not-exist/series → 404
PASS  GET /v1/ops/status?window=7d → 400
PASS  POST quote same asset → 400
PASS  POST quote mainnet (kill-switch off) → 403
PASS  POST quote no direct path → 422
PASS  GET /v1/openapi.json serves the document
PASS  GET /v1/docs is text/html and references the document
PASS  strict schema: getHealth (additionalProperties)
PASS  strict schema: listProtocols (unevaluatedProperties)
PASS  strict schema: listPools (unevaluatedProperties)
PASS  strict schema: getPool (unevaluatedProperties)
INFO  getPoolFlows is beta: schema open
INFO  getPoolSeries is beta: schema open
PASS  strict schema: getNetworkStats (unevaluatedProperties)
PASS  strict schema: getNetworkTvlSeries (additionalProperties)
PASS  strict schema: getBridgeSummary (additionalProperties)
PASS  strict schema: listBridgeFlows (additionalProperties)
PASS  strict schema: getBridgeSeries (additionalProperties)
INFO  getOpsStatus is beta: schema open
INFO  getOpsMetrics is beta: schema open
INFO  getOpsAdoption is beta: schema open
INFO  quoteSdexSwap is beta: schema open

40/40 checks passed, 0 failed
```
