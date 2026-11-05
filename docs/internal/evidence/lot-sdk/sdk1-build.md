# Lot SDK1 — SDK publish readiness + MCP server (build evidence)

Date: 2026-11-05. Branch `feat/lot-sdk1` off `main` (`8f6e2b4`). Two commits planned: (1) SDK
publish readiness, (2) MCP package + CI + docs. **Nothing published**: the founder publishes
(npm org `getdig`, 2FA). Node 24.22, pnpm 10.32.1 (corepack).

## Part 1 — `packages/sdk` (`@getdig/stellar-api` 0.1.0)

`package.json`: `repository` → `git+https://github.com/Mael-wnb/dig-stellar.git` (public
remote, directory `packages/sdk`), `bugs`, keywords `stellar defi soroban api sdk openapi blend`,
`files` = `dist README.md LICENSE` (`src` dropped), `engines.node >=18` (was `>=20`; the client
needs only global `fetch`), `sideEffects: false`, `exports` unchanged (ESM/CJS/types verified
by the smoke below). README: real install line, "Versioning" line, "not published" lines gone.

| Command | Result |
|---|---|
| `pnpm -C packages/sdk build` / `typecheck` / `test` | ESM 6.91 KB, CJS 7.12 KB, DTS 56 KB / clean / **20 tests, 5 suites, 0 failed** (unchanged) |
| `npm pack --dry-run` | 9 files, 31.4 kB packed / 179.0 kB unpacked: `LICENSE`, `README.md`, `dist/index.cjs`, `dist/index.cjs.map`, `dist/index.d.cts`, `dist/index.d.ts`, `dist/index.js`, `dist/index.js.map`, `package.json` (no src, no tests) |

**Tarball smoke** (`npm pack` → throwaway project outside the repo, `npm i <tgz>`, 3-line
example against production, 2026-11-05 15:06 UTC):

```
ESM 44 pools; top: blend-fixed-pool 156538821 isStale=false asOf=2026-11-05T15:00:40.330Z
CJS 44 pools; top: blend-fixed-pool 156538821 isStale=false asOf=2026-11-05T15:00:40.330Z
```

## Part 2 — `packages/mcp` (`@getdig/stellar-mcp` 0.1.0, new)

`@modelcontextprotocol/sdk` 1.32.2 + `zod` 4.6.7 + `@getdig/stellar-api` (`workspace:^`).
`src/server.ts`: `createServer()` → `McpServer` with six tools (`registerTool`, zod input
schemas, `readOnlyHint: true`), each answering `[summary, JSON payload]`; summaries end with
`isStale=…, asOf=…` (rows: stale count + oldest/newest `asOf`; series: request time; pipeline:
`lastRunAt` vs `staleAfterSeconds`). `get_pipeline_status` condenses `/v1/ops/status` (145 KB on
prod: `runs` → `runCount`, `segments` → `segmentCount` + `lastSegment`). Errors: `API error
<status>: <API message>` as a tool error, no stack, no URL. `src/cli.ts`: shebang + stdio
transport, env `DIG_API_BASE_URL` / `DIG_USER_AGENT`. Server instructions state "No wallet, no
transaction, no key, no write". Build: tsup ESM only, `dist/index.js` + `dist/cli.js` (+chunk).

| Command | Result |
|---|---|
| `pnpm -C packages/mcp typecheck` | clean |
| `pnpm -C packages/mcp test` | **15 tests, 3 suites, 0 failed**: registration ×3 (6 tools, read-only annotations, input schemas, instructions), handlers ×11 (each tool on a routed fetch mock incl. query passthrough, UA, invalid enum rejected before any call, 404 → `API error 404: Cannot GET …` with no stack/URL, condensed pipeline payload, derived staleness), version sync ×1 |
| `pnpm -C packages/mcp build` | `index.js` 98 B, `cli.js` 345 B (shebang kept, mode 755), chunk 11.1 KB, `index.d.ts` 1 KB |
| `npm pack --dry-run` | 7 files, 7.5 kB packed / 19.5 kB unpacked: `LICENSE`, `README.md`, `dist/chunk-2Z6ZPPCE.js`, `dist/cli.js`, `dist/index.d.ts`, `dist/index.js`, `package.json` |

**Finding — `workspace:^` rewrite.** `npm pack` (and therefore `npm publish`) leaves
`"@getdig/stellar-api": "workspace:^"` in the tarball's `package.json` (checked by extracting
it). `pnpm pack` rewrites it to `"^0.1.0"` (checked the same way). **The MCP package must be
published with `pnpm publish`**, not `npm publish`; the SDK has no workspace dependency and
can go either way.

**Local proof** (`pnpm -C packages/mcp example`: real MCP client spawning `dist/cli.js` over
stdio, production API, 2026-11-05 15:12 UTC, payload lines trimmed):

```
server tools (6): list_protocols, list_pools, get_pool, get_pool_series, get_network_stats, get_pipeline_status
# list_protocols {}
  7 protocols: Allbridge (bridge, TVL n/a), Aquarius (amm, TVL $44.8M), Blend (lending, TVL $157.0M), DeFindex (vault, TVL $18.8M), Soroswap (amm, TVL $1.2M), Stellar Native DEX (amm, TVL $5.5M), XOXNO (lending, TVL $144.8K); isStale=true for 0/7 rows (1 with no row yet), asOf oldest=2026-11-05T15:06:14.050Z newest=2026-11-05T15:06:14.085Z
  payload: 4337 chars of JSON, starts [{"id":"allbridge","name":"Allbridge","type":"bridge",...
# get_pool {"slug":"blend-fixed-pool"}
  Fixed [Blend, lending_pool]: TVL $156.5M, supplied $156.5M, borrowed $31.7M, supply APY 1.68%, borrow APY 9.79%, 3 reserves; isStale=false, asOf=2026-11-05T15:00:40.330Z
  payload: 2188 chars of JSON, starts {"id":"blend-fixed-pool","name":"Fixed","protocol":{"id":"blend",...
# get_pool {"slug":"does-not-exist"} [error]
  API error 404: Pool not found: does-not-exist
```

## Part 3 — CI, docs

`ci.yml` job `sdk` gains `pnpm -C packages/mcp typecheck / test / build` after the SDK build (the
server imports the built SDK). `docs/api/README.md` SDK section rewritten (install line, pnpm
publish note) + new "MCP server" section; root `README.md` (API bullet, "publication pending"
in Status and honesty); `docs/post-grant-summary.md` two lines; `docs/status-board.md` SDK1 row
`in_progress` + Next table. `node tools/check-doc-links.mjs`: 162 files, 703 targets, 0 broken.
`pnpm -C apps/api test`: 402 passed, 43 skipped (unchanged). `pnpm-lock.yaml`:
+131 lines (MCP SDK and its deps, zod 4).

**Not in this lot:** the publish itself (founder), wallet/portfolio/action tools, HTTP transport,
tools for bridge, flows, TVL series and ops metrics (the SDK covers them), retries, API keys.
