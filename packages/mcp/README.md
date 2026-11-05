# @getdig/stellar-mcp

An MCP server (Model Context Protocol, stdio) that gives an AI agent read-only access to the
Dig Stellar public API (`https://stellar-api.getdig.ai`): the Stellar DeFi protocols and pools
Dig tracks, their TVL, volume, fees and APYs, network-level figures, and the status of the
pipeline that refreshes them. Built on `@getdig/stellar-api`, the TypeScript client generated
from the API's OpenAPI contract (<https://stellar-api.getdig.ai/v1/docs>).

**Read-only.** No wallet, no transaction, no key, no write: the server cannot sign, send or
change anything, and the API behind it has no write path for it to reach.

## Usage

```bash
npx -y @getdig/stellar-mcp
```

The server speaks MCP over stdin/stdout; it is started by the client, not by you.

Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "dig-stellar": {
      "command": "npx",
      "args": ["-y", "@getdig/stellar-mcp"]
    }
  }
}
```

Claude Code: `claude mcp add dig-stellar -- npx -y @getdig/stellar-mcp`. Any other MCP client
that launches a stdio server takes the same command and arguments.

Environment (both optional):

| Variable | Default | Role |
|---|---|---|
| `DIG_API_BASE_URL` | `https://stellar-api.getdig.ai` | API origin (a local API: `http://localhost:3000`) |
| `DIG_USER_AGENT` | `@getdig/stellar-mcp/<version>` | `User-Agent` sent to the API |

## Tools

Six tools, all read-only (`readOnlyHint: true`). Each answer is two text blocks: a one-line
summary that always ends with the freshness of the data (`isStale`, `asOf`), then the API
payload as JSON. APY and APR values are fractions (`0.05` = 5 %).

| Tool | Input | Example question |
|---|---|---|
| `list_protocols` | none | "Which Stellar DeFi protocols does Dig track, and how much TVL does each hold?" |
| `list_pools` | `protocol?`, `sort?` (`tvlUsd`, `volume24hUsd`, `fees24hUsd`, `supplyApy`, `borrowApy`, `name`, `protocol`), `order?` (`asc`, `desc`) | "Which Stellar lending pool has the highest supply APY right now?" |
| `get_pool` | `slug` | "What are the reserves and borrow rates of the Blend fixed pool?" |
| `get_pool_series` | `slug` | "How did the TVL of blend-fixed-pool move over the last 30 days?" |
| `get_network_stats` | none | "What is the total tracked Stellar DeFi TVL and the XLM price right now?" |
| `get_pipeline_status` | none | "Is Dig's data fresh? When did the refresh pipeline last run?" |

Pool slugs are the `id` field of `list_pools` rows; protocol slugs the `id` of `list_protocols`.
`get_pipeline_status` returns `GET /v1/ops/status` with its per-run arrays (`runs`, each
component's `segments`) replaced by counts plus the last segment: the full payload is about
150 KB, the condensed one keeps state, gaps, availability and the price-source summary.

Errors come back as MCP tool errors carrying the API's status and message
(`API error 404: Pool not found: <slug>`), never a stack trace. The API is rate-limited per client
IP (10 requests/s, burst 60); a `429` surfaces with its `Retry-After` delay.

## Not yet

- No API keys: the public API has none; access is rate-limited per IP.
- No actions: no quotes, no transaction building, no signing, no wallet or portfolio tools.
- No bridge, flows, TVL-series or ops-metrics tools: the API has them (`@getdig/stellar-api`
  covers all 15 operations); this server exposes the six an agent asks for first.
- No HTTP transport: stdio only.

## Development

```bash
pnpm -C packages/sdk build       # the server imports the built SDK
pnpm -C packages/mcp typecheck
pnpm -C packages/mcp test        # node --test via tsx: registration, handlers on a mocked API, 404 path
pnpm -C packages/mcp build       # tsup, ESM only: dist/index.js (createServer), dist/cli.js (bin)
pnpm -C packages/mcp example     # spawns dist/cli.js over stdio, calls list_protocols and get_pool
```

Versioning: `0.x`, in step with `@getdig/stellar-api` (which follows the API contract `1.0.0`
additively). MIT, see `LICENSE`.
