# @getdig/stellar-api

TypeScript client for the Dig Stellar public read API (`https://stellar-api.getdig.ai`):
protocol and pool analytics, network figures, bridge flows and refresh-pipeline status for
Stellar DeFi, read-only. Generated from the API's OpenAPI 3.1 contract
(`apps/api/openapi/openapi.v1.yaml`, rendered at <https://stellar-api.getdig.ai/v1/docs>).
"Contract" means the HTTP API contract, never a smart contract.

Status: **v0 (0.1.0), not yet published to npm.** Zero runtime dependencies; needs a global
`fetch` (Node 18+, browsers, workers) or one passed in.

## Install

From this repository (workspace package):

```jsonc
// your package.json, inside the monorepo
"dependencies": { "@getdig/stellar-api": "workspace:*" }
```

```bash
pnpm install
```

From npm: soon.

```bash
# npm install @getdig/stellar-api   # soon
```

## Example

```ts
import { DigStellarClient } from '@getdig/stellar-api';
const client = new DigStellarClient();
const pools = await client.listPools({ sort: 'tvlUsd', order: 'desc' });
```

A runnable version printing the top 5 pools by TVL from production:
`pnpm -C packages/sdk example` (`examples/list-pools.ts`).

## Operations

One method per operation, named after the spec's `operationId`. Stability tiers are the
spec's `x-stability`: `stable` operations change additively only (new fields, new endpoints);
`beta` operations may still change shape. Every change takes a line in `docs/api/CHANGELOG.md`.

| Method | HTTP | Stability |
|---|---|---|
| `getHealth()` | `GET /health` | stable |
| `listProtocols()` | `GET /v1/protocols` | stable |
| `listPools({ protocol?, sort?, order? })` | `GET /v1/pools` | stable |
| `getPool(slug)` | `GET /v1/pools/{slug}` | stable |
| `getPoolFlows(slug, { window? })` | `GET /v1/pools/{slug}/flows` | beta |
| `getPoolSeries(slug)` | `GET /v1/pools/{slug}/series` | beta |
| `getNetworkStats()` | `GET /v1/network/stats` | stable |
| `getNetworkTvlSeries()` | `GET /v1/network/tvl-series` | stable |
| `getBridgeSummary({ window? })` | `GET /v1/bridge/summary` | stable |
| `listBridgeFlows({ direction?, limit? })` | `GET /v1/bridge/flows` | stable |
| `getBridgeSeries({ days? })` | `GET /v1/bridge/series` | stable |
| `getOpsStatus({ window? })` | `GET /v1/ops/status` | beta |
| `getOpsMetrics()` | `GET /v1/ops/metrics` | beta |
| `getOpsAdoption()` | `GET /v1/ops/adoption` | beta |
| `quoteSdexSwap(body)` | `POST /v1/actions/sdex/quote` | beta |

Query parameters and response types come from the generated file
(`src/generated/openapi.d.ts`); the named aliases (`PoolSummary`, `PoolDetail`,
`NetworkStats`, …) and the raw `paths` / `components` / `operations` interfaces are all
exported. `PoolDetail` is a union: narrow with `'reserves' in pool` (lending) or
`'tokens' in pool` (AMM).

`quoteSdexSwap` is a price lookup only: nothing is built or signed. `network` defaults to
`testnet` on the server; `mainnet` answers `403` while the server-side kill-switch is on.

## Options

```ts
new DigStellarClient({
  baseUrl: 'https://stellar-api.getdig.ai', // default; use http://localhost:3000 for a local API
  fetch: globalThis.fetch,                   // any fetch-compatible function
  timeoutMs: 10_000,                         // 0 disables the timeout
  userAgent: '@getdig/stellar-api/0.1.0',    // browsers drop this header
});
```

## Errors

Every non-2xx response throws `DigApiError`:

```ts
import { DigApiError, DigTimeoutError } from '@getdig/stellar-api';

try {
  await client.getPool('does-not-exist');
} catch (error) {
  if (error instanceof DigApiError) {
    error.status;            // 404
    error.body;              // { statusCode: 404, error: 'Not Found', message: '...' } (documented shapes)
    error.rawBody;           // the response text, unparsed
    error.retryAfterSeconds; // set on 429 only, from the Retry-After header
    error.isRateLimited;     // status === 429
  }
  if (error instanceof DigTimeoutError) {
    error.timeoutMs;
  }
}
```

- `body` is typed as the documented error shapes (`NestError`, `NestInternalError`,
  `RateLimited`) and is `undefined` when the body was empty or not JSON; it is not validated
  at runtime.
- **Rate limits** are enforced at the edge per client IP: 10 requests/s (burst 60) on every
  GET, 30 requests/min (burst 10) on the quote. A `429` carries `Retry-After` and surfaces as
  `DigApiError` with `retryAfterSeconds`. **The client does not retry**; back off yourself.
- A timeout aborts the request (`AbortController`) and throws `DigTimeoutError`.
- A network failure (DNS, refused connection) is the underlying `fetch` error, rethrown as is.
- `getHealth()` throws `DigApiError` with status `503` when the API reports its database
  unreachable; the payload is still in `error.body`.

## Freshness helper

Every data payload carries the shared freshness fields (`updatedAt`, `isStale`,
`staleAfterSeconds`, `ageSeconds`). Two helpers, nothing cleverer:

```ts
import { isStale, asOfDate } from '@getdig/stellar-api';

isStale(pool);   // true | false | null (null: no row yet); falls back to the deprecated `stale`
asOfDate(pool);  // Date | null, from `updatedAt`
```

## Versioning policy

- The generated types **are** the contract. `pnpm generate` rewrites
  `src/generated/openapi.d.ts` from the yaml; the file is committed so consumers need no build
  step, and CI fails on any drift between the yaml and the committed file.
- SDK **minor** follows an additive API change (new operation or field: the API stays `1.x`,
  the SDK goes `0.x+1`). SDK **patch** for client-only fixes. A breaking API change ships as
  `/v2` alongside `/v1` and would be a new SDK major.
- `beta` operations may change shape within a minor; their types follow the yaml.

## Not yet (v0)

- No automatic retries or backoff (a `429` is thrown with `retryAfterSeconds`).
- No API keys: the API has none; access is rate-limited per IP.
- No pagination: list operations return the full set (`listBridgeFlows` caps at `limit`).
- Not published to npm.

## Development

```bash
pnpm -C packages/sdk generate    # yaml -> src/generated/openapi.d.ts (commit the result)
pnpm -C packages/sdk typecheck   # tsc --noEmit, includes the type-level test test/types.assert.ts
pnpm -C packages/sdk test        # node --test via tsx
pnpm -C packages/sdk build       # tsup: dist/index.js (ESM), dist/index.cjs (CJS), .d.ts/.d.cts
pnpm -C packages/sdk example     # one production call
```

MIT, see `LICENSE`.
