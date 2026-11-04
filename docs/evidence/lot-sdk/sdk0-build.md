# Lot SDK0 — Vercel-preview CORS fix + TypeScript SDK v0 (build evidence)

Date: 2026-11-04. Branch `feat/lot-sdk0` off `main` (`438971f`). Two commits planned:
(1) API CORS + docs, (2) SDK package + CI + docs. Nothing deployed, nothing published.
"Contract" = the HTTP API contract.

## Part 1 — CORS for Vercel previews (`apps/api`)

**Problem.** `main.ts` allowed only the exact origins in `CORS_ORIGINS`. Vercel preview
deployments (`https://dig-stellar-web-git-<branch>-dig-7a565626.vercel.app`) failed the
preflight, so UI work on a preview could not be validated with production data; the Lot AA
workaround was adding one preview origin to the VPS env by hand.

**Change.** New `apps/api/src/cors-origin.ts` (pure, no Nest): `parseAllowedOrigins(env)` (the
former inline parsing, unchanged behaviour and default) and `isAllowedOrigin(origin, list)` =
exact match OR `^https://dig-stellar-web-[a-z0-9-]+-dig-7a565626\.vercel\.app$`. `main.ts` calls
them; the rest of `enableCors` (`credentials: true`, `maxAge: 3600`, callback-based clean denial)
is unchanged. The team suffix is in the pattern on purpose so a same-named project under another
Vercel team does not match.

**Tests** (`apps/api/src/cors-origin.spec.ts`, 9 cases):

- accepts a Vercel branch preview (`…-git-feat-lot-sdk0-dig-7a565626.vercel.app`)
- accepts a Vercel per-deployment preview URL (`…-k3j9x2abc-dig-7a565626.vercel.app`)
- accepts the production origins listed in `CORS_ORIGINS`
- rejects a lookalike host that embeds the pattern as a subdomain
  (`https://evil-dig-stellar-web-x-dig-7a565626.vercel.app.attacker.com`, and the same without
  the `evil-` prefix)
- rejects an `http://` preview URL
- rejects a same-named project under a different Vercel team suffix
- rejects an origin that is neither listed nor a preview (and a listed origin with an empty list)
- `parseAllowedOrigins`: splits, trims, drops empty entries
- `parseAllowedOrigins`: falls back to the local dev origins when unset

**Validation (local, Node 24, pnpm 10.32.1 via corepack):**

| Command | Result |
|---|---|
| `pnpm -C apps/api build` | ok |
| `pnpm -C apps/api test` | 36 suites passed, 3 skipped (integration), **402 tests passed**, 43 skipped — 39 spec files (was 38) |
| `DATABASE_URL=postgresql://dig:dig@localhost:5432/dig_stellar pnpm -C apps/api test:contract` | **40/40 checks passed** |

Docs: `docs/deployment.md` "CORS: allowed origins" (with the post-deploy curl check),
`docs/security-invariants.md` §7 amendment dated 2026-11-04.

## Part 2 — `packages/sdk` (`@getdig/stellar-api` 0.1.0)

**operationIds.** All 15 operations in `openapi.v1.yaml` already carried an `operationId`
(`getHealth`, `listProtocols`, `listPools`, `getPool`, `getPoolFlows`, `getPoolSeries`,
`getNetworkStats`, `getNetworkTvlSeries`, `getBridgeSummary`, `listBridgeFlows`,
`getBridgeSeries`, `getOpsStatus`, `getOpsMetrics`, `getOpsAdoption`, `quoteSdexSwap`).
**No spec change, no CHANGELOG line, version stays 1.0.0.**

**What was built.**

- `pnpm generate`: `openapi-typescript@7.13.0` over `../../apps/api/openapi/openapi.v1.yaml` →
  `src/generated/openapi.d.ts` (1,405 lines, committed). The generated `operations` interface is
  keyed by operationId, which is what the client's types are read from.
- `src/client.ts`: `DigStellarClient({ baseUrl = "https://stellar-api.getdig.ai", fetch =
  globalThis.fetch, timeoutMs = 10000, userAgent })`, one method per operationId, query
  parameters and 200 bodies typed from `operations[...]`. No `any` in the public surface.
  `AbortController` timeout; no retries.
- `src/errors.ts`: `DigApiError { status, method, url, body, rawBody, retryAfterSeconds,
  isRateLimited }` for every non-2xx (`body` typed as the documented `NestError |
  NestInternalError | RateLimited`, `undefined` when not JSON); `retryAfterSeconds` parsed from
  `Retry-After` (seconds or HTTP-date, the latter guarded by a weekday prefix so `-5` is not read
  as a year); `DigTimeoutError { timeoutMs }`.
- `src/freshness.ts`: `isStale(payload)` (reads `isStale`, falls back to the deprecated `stale`,
  else `null`) and `asOfDate(payload)` (`updatedAt` → `Date | null`).
- `src/types.ts`: named aliases over `components['schemas']` and per-operation query types.
- Build: `tsup` (one config) → `dist/index.js` (ESM), `dist/index.cjs` (CJS), `index.d.ts`,
  `index.d.cts`; `exports` map with `import` / `require` conditions; `files` = `dist`, `src`,
  `README.md`, `LICENSE` (checked with `pnpm pack`: 15 files, no tests/examples/config).
  Both formats smoke-tested from plain Node (`require` and `import`).
- Tests: `node --test` via `tsx` (the repo's lightest option, same as `apps/indexer`).
- Type-level test `test/types.assert.ts` (compiled by `pnpm typecheck`): each of the 15 methods
  returns exactly the spec's 200 body; the operationId set of the spec equals the client's method
  set (a new operation in the yaml fails the typecheck until the client gains its method); query
  parameter types equal the spec's; `DigApiError['body']` equals the union of the documented
  error shapes.

**Validation:**

| Command | Result |
|---|---|
| `pnpm -C packages/sdk generate` | ok (41.6 ms) |
| `pnpm -C packages/sdk typecheck` | clean |
| `pnpm -C packages/sdk test` | **20 tests, 5 suites, 0 failed** (request building ×8 incl. URL + query for `listPools`, `getPoolFlows`, `listBridgeFlows`; errors ×6 incl. 404 mapping, 429 + `Retry-After`, non-JSON body, timeout, network error passthrough; `parseRetryAfter` ×3; freshness ×2; version sync ×1) |
| `pnpm -C packages/sdk build` | ESM 6.85 KB, CJS 7.07 KB, DTS 56 KB |
| `pnpm -C packages/sdk example` | see below |

**Example output (production, 2026-11-04 ~18:50 UTC, one `GET /v1/pools?sort=tvlUsd&order=desc`):**

```
44 pools, top 5 by TVL (https://stellar-api.getdig.ai):
  blend-fixed-pool                         Blend      $ 160,988,033  stale=false  asOf=2026-11-04T18:45:30.761Z
  defindex-meru-usdc                       DeFindex   $  18,570,044  stale=false  asOf=2026-11-04T18:48:50.199Z
  aquarius-xsolvbtc-solvbtc-pool           Aquarius   $  13,321,997  stale=false  asOf=2026-11-04T18:48:33.002Z
  aquarius-pyusd-usdc-pool                 Aquarius   $   8,029,163  stale=false  asOf=2026-11-04T18:47:44.708Z
  aquarius-native-solvbtc-pool             Aquarius   $   7,514,329  stale=false  asOf=2026-11-04T18:46:55.606Z
```

**CI** (`.github/workflows/ci.yml`, new job `sdk`, existing `build-test` job untouched):
checkout → pnpm 10 → Node 24 → `pnpm install --frozen-lockfile` →
`pnpm -C packages/sdk generate` → `git diff --exit-code packages/sdk/src/generated` (fails on
drift between the yaml and the committed types) → `typecheck` → `test` → `build`.

**Lockfile.** `pnpm-lock.yaml` gains the sdk's dev dependencies (`openapi-typescript`, `tsup`,
and `tsx` / `typescript` / `@types/node` pinned to ranges already resolved in the workspace so
nothing else moves); ~24 removed lines are pnpm re-keying `debug` / `@rollup/pluginutils`
entries that tsup pulls at a newer version.

## Not in this lot

npm publish (name `@getdig/stellar-api` is provisional), retries/backoff, API keys,
pagination, any web change. The SDK's version policy (minor follows additive API changes) is in
`packages/sdk/README.md`.
