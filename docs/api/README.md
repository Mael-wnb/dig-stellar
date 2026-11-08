# Public API — contract, docs page, contract test

"Contract" here means the HTTP API contract, never a smart contract. Decision and rules:
`docs/decisions/2026-11-03-public-api-v1-surface.md`. Changes: `CHANGELOG.md` (this folder).

## Where the contract lives

| What | Where |
|---|---|
| Source of truth (OpenAPI 3.1, hand-written) | `apps/api/openapi/openapi.v1.yaml` — the only copy |
| Built copy read at runtime | `apps/api/dist/openapi/openapi.v1.yaml`, produced by `pnpm -C apps/api build` (`nest-cli.json` → `compilerOptions.assets`, `flat: true`) |
| Served as JSON | `GET /v1/openapi.json` (`Cache-Control: public, max-age=3600`, `Access-Control-Allow-Origin: *`) |
| Reference page | `GET /v1/docs` — single static HTML, Scalar API Reference loaded from the jsDelivr CDN pinned to **1.76.4**, `Content-Type: text/html; charset=utf-8`, same cache and CORS headers |
| Code | `apps/api/src/modules/openapi/` (loader, controller, page template, module) |

The yaml sits under `apps/api/` (not `docs/`) so that one file is reachable by every runtime
without duplication: pm2 on the VPS runs `dist/main.js` from `apps/api` and the Lot Z Docker
image copies only `apps/api/dist`, so the build must carry it. The loader looks in
`dist/openapi/` first (built), then `apps/api/openapi/` (source, for `ts-node` runs). Nothing
under `docs/` is a copy of the yaml.

Both routes fall under the existing nginx `location /v1/` (zone `api_general`); no nginx
change is required for them to work (`docs/deployment.md` §Rate-limit zones).

## Scalar pin

The page loads `https://cdn.jsdelivr.net/npm/@scalar/api-reference@<version>/dist/browser/standalone.js`
with the version fixed in `SCALAR_VERSION` (`apps/api/src/modules/openapi/docs-page.ts`), currently
**1.76.4** (the CDN's `latest` on 2026-11-03). A Scalar release can therefore never change the
page under us. To bump: read the current tag with
`curl -s https://data.jsdelivr.com/v1/package/npm/@scalar/api-reference | jq -r .tags.latest`,
set `SCALAR_VERSION` to it, rebuild, open `/v1/docs` locally from the built dist and check the
page renders, add a line to `CHANGELOG.md` ("docs page: Scalar x.y.z"). Vendoring the bundle
(no CDN at all) is an open item in the decision doc.

The two documentation routes answer `Access-Control-Allow-Origin: *` (route-local, GET only) so
any origin can fetch the contract; the data endpoints keep the global CORS policy of `main.ts`.

## SDK

`packages/sdk` (`@getdig/stellar-api`, `0.1.0`, npm: `npm i @getdig/stellar-api`) is a
TypeScript client generated from the yaml: `pnpm -C packages/sdk generate` runs
openapi-typescript over `openapi.v1.yaml` into `src/generated/openapi.d.ts` (committed, so
consumers need no build step), and `DigStellarClient` exposes one typed method per
`operationId` (15). ESM and CommonJS builds, zero runtime dependencies, Node 18+. The CI job
`sdk` regenerates the file and fails on any drift from the yaml, so a contract change lands
with its types in the same commit and takes an SDK version bump (additive API change → SDK
minor; `0.x` follows contract `1.0.0`). Usage, errors, the freshness helper and what v0 does
not do (retries, keys, pagination): `packages/sdk/README.md`. Published to npm on 2026-11-05
(`npm publish` from `packages/sdk`, founder, 2FA); Lot SDK1 evidence:
`../internal/evidence/lot-sdk/sdk1-build.md`.

## MCP server

`packages/mcp` (`@getdig/stellar-mcp`, `0.1.0`, `npx -y @getdig/stellar-mcp`) is an MCP server
over stdio built on the SDK, for AI agents (Claude Desktop, Claude Code, any MCP client). Six
read-only tools: `list_protocols`, `list_pools` (`protocol`, `sort`, `order`), `get_pool`
(`slug`), `get_pool_series` (`slug`), `get_network_stats`, `get_pipeline_status`. Every answer
is a one-line summary ending with the data's freshness (`isStale`, `asOf`) followed by the API
payload as JSON; `get_pipeline_status` condenses the 150 KB `/v1/ops/status` payload (per-run
arrays replaced by counts). No wallet, no transaction, no key, no write. Env:
`DIG_API_BASE_URL`, `DIG_USER_AGENT`. Tests cover registration, every handler on a mocked API
and the 404 path; CI builds and tests it in the `sdk` job after the SDK build. Depends on
`@getdig/stellar-api` with the `workspace:^` protocol, so it is published with `pnpm pack` (which
rewrites the range to `^0.1.0`, verified in the tarball) followed by `npm publish <tgz>`; a plain
`npm publish` would ship `workspace:^`. Published 2026-11-07. Client config and example
questions: `packages/mcp/README.md`.

## Validating the contract

```bash
# Unit suite (unchanged by this lot, no DB):
pnpm -C apps/api test

# Contract test: boots the real AppModule against a populated local Postgres, calls every
# operation in the yaml, validates each body with ajv (JSON Schema 2020-12 + formats),
# exercises the documented 400/403/404/422 paths and the two docs routes, and checks that
# every `stable` operation has a strict response schema. Needs outbound HTTPS to Horizon
# testnet for the quote. Not in CI in this lot — a deploy-checklist step.
DATABASE_URL=postgresql://dig:dig@localhost:5432/dig_stellar pnpm -C apps/api test:contract

# Prove the built artefact finds the yaml (what pm2 and the image run):
pnpm -C apps/api build
DATABASE_URL=... PORT=3000 node apps/api/dist/main.js &
curl -s localhost:3000/v1/openapi.json | jq .info.version   # "1.0.0"
curl -sI localhost:3000/v1/docs | grep -i content-type        # text/html; charset=utf-8
```

Stale local data is fine: the schemas describe shape, not freshness. Stable schemas use
`additionalProperties: false`, or `unevaluatedProperties: false` where the shared
`FreshnessMeta` is composed with `allOf` (JSON Schema 2020-12 needs the latter for
composed objects). Beta schemas are open.

## Examples

Every example in the yaml was captured from **production** (`https://stellar-api.getdig.ai`)
on **2026-11-03 at 18:10 UTC**, one call per operation, 1.5 s apart (well inside the
`api_general` zone), arrays trimmed to one or two items, nothing edited otherwise. The quote
example is one `POST` on **testnet** with the whitelisted `XLM → USDC` pair and `amount: "10"`.
Commands used:

```bash
B=https://stellar-api.getdig.ai
for p in /health /v1/protocols /v1/pools /v1/network/stats /v1/network/tvl-series \
         "/v1/bridge/summary?window=7d" "/v1/bridge/flows?limit=2" "/v1/bridge/series?days=7" \
         /v1/ops/status /v1/ops/metrics /v1/ops/adoption \
         /v1/pools/blend-etherfuse-pool /v1/pools/aquarius-aqua-usdc-clpool \
         "/v1/pools/aquarius-aqua-usdc-clpool/flows?window=7d" /v1/pools/blend-etherfuse-pool/series \
         /v1/pools/does-not-exist "/v1/ops/status?window=7d"; do
  curl -s "$B$p" | jq -c 'walk(if type=="array" then .[0:2] else . end)'; sleep 1.5
done
curl -s -X POST $B/v1/actions/sdex/quote -H 'content-type: application/json' \
  -d '{"fromAsset":"XLM","toAsset":"USDC","amount":"10","network":"testnet"}'
```

The two pool slugs were the first Blend lending pool and the first Aquarius AMM pool returned by
`/v1/pools` at capture time. Re-capture the same way when a shape changes, and add a line to
`CHANGELOG.md`.
