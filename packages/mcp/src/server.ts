// The MCP server: six read-only tools over `DigStellarClient`. Each tool answers with one
// human line (always ending with freshness) followed by the API payload as JSON text.
import {
  DigApiError,
  DigStellarClient,
  DigTimeoutError,
  type DigStellarClientOptions,
} from '@getdig/stellar-api';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import {
  condensePipelineStatus,
  summarizeNetworkStats,
  summarizePipelineStatus,
  summarizePool,
  summarizePools,
  summarizeProtocols,
  summarizeSeries,
} from './summaries';
import { MCP_VERSION } from './version';

export const TOOL_NAMES = [
  'list_protocols',
  'list_pools',
  'get_pool',
  'get_pool_series',
  'get_network_stats',
  'get_pipeline_status',
] as const;

export const SERVER_INSTRUCTIONS =
  'Read-only access to Dig Stellar DeFi analytics (https://stellar-api.getdig.ai): tracked ' +
  'protocols, pools with TVL, volume, fees and APYs, network figures and the status of the ' +
  'refresh pipeline that produces them. No wallet, no transaction, no key, no write: nothing ' +
  'here can sign, send or change anything. Every tool answer starts with a one-line summary ' +
  'that ends with the freshness of the data (isStale, asOf); when isStale is true the figures ' +
  'are older than their staleness threshold and should be quoted with that caveat. APY and ' +
  'APR values are fractions (0.05 = 5%). Pool slugs come from list_pools (field id).';

export interface CreateServerOptions {
  /** API origin. Default: the production API. Env `DIG_API_BASE_URL` in the CLI. */
  baseUrl?: string;
  /** `User-Agent` sent to the API. Default `@getdig/stellar-mcp/<version>`. Env `DIG_USER_AGENT` in the CLI. */
  userAgent?: string;
  /** `fetch` implementation (tests). Default `globalThis.fetch`. */
  fetch?: DigStellarClientOptions['fetch'];
  /** A ready client; takes precedence over the other options. */
  client?: DigStellarClient;
}

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };

const slugInput = {
  slug: z.string().min(1).describe('Pool slug, the `id` field of a list_pools row (e.g. blend-fixed-pool)'),
};

const listPoolsInput = {
  protocol: z
    .string()
    .min(1)
    .optional()
    .describe('Filter by protocol slug, the `id` field of a list_protocols row (e.g. blend, soroswap, aquarius)'),
  sort: z
    .enum(['tvlUsd', 'volume24hUsd', 'fees24hUsd', 'supplyApy', 'borrowApy', 'name', 'protocol'])
    .optional()
    .describe('Sort key. Default tvlUsd. For "highest supply APY" use supplyApy with order desc'),
  order: z.enum(['asc', 'desc']).optional().describe('Sort direction. Default desc'),
};

export function createServer(options: CreateServerOptions = {}): McpServer {
  const client =
    options.client ??
    new DigStellarClient({
      baseUrl: options.baseUrl,
      userAgent: options.userAgent ?? `@getdig/stellar-mcp/${MCP_VERSION}`,
      fetch: options.fetch,
    });

  const server = new McpServer(
    { name: 'dig-stellar', version: MCP_VERSION },
    { instructions: SERVER_INSTRUCTIONS },
  );

  server.registerTool(
    'list_protocols',
    {
      title: 'List tracked Stellar DeFi protocols',
      description:
        'Every tracked protocol (venue) with its type (lending, amm, vault), TVL, 24h volume and fees, ' +
        'weighted supply/borrow APY and top assets. Use the `id` field as the `protocol` filter of list_pools.',
      inputSchema: {},
      annotations: readOnly,
    },
    () => run(() => client.listProtocols(), summarizeProtocols),
  );

  server.registerTool(
    'list_pools',
    {
      title: 'List pools',
      description:
        'Every tracked pool (lending pools, AMM pairs, yield vaults) with TVL, 24h volume and fees, ' +
        'supply/borrow APY (lending only) and 24h swaps (AMM only). Optional protocol filter, sort key ' +
        'and order; default is TVL descending. About 40 KB of JSON for the full list.',
      inputSchema: listPoolsInput,
      annotations: readOnly,
    },
    (args) => run(() => client.listPools(args), (rows) => summarizePools(rows, args)),
  );

  server.registerTool(
    'get_pool',
    {
      title: 'Get one pool',
      description:
        'One pool by slug: lending pools and vaults carry per-reserve supplied/borrowed amounts, caps and ' +
        'APR/APY; AMM pools carry their tokens, 24h volume, fees and swap count. Unknown slug: tool error.',
      inputSchema: slugInput,
      annotations: readOnly,
    },
    ({ slug }) => run(() => client.getPool(slug), summarizePool),
  );

  server.registerTool(
    'get_pool_series',
    {
      title: 'Get a pool TVL series',
      description:
        'Daily TVL points for one pool (one point per day, USD), with the first and last covered day. ' +
        '`covered` is false when the slug has no daily snapshots yet.',
      inputSchema: slugInput,
      annotations: readOnly,
    },
    ({ slug }) => run(() => client.getPoolSeries(slug), summarizeSeries),
  );

  server.registerTool(
    'get_network_stats',
    {
      title: 'Get Stellar network figures',
      description:
        'Network-level figures: XLM price and 24h change, tracked Stellar DeFi TVL (gross, DeFindex vaults ' +
        'excluded to avoid double counting), protocol count, active wallets, 24h DEX volume, USDC supply, ' +
        'average transaction fee.',
      inputSchema: {},
      annotations: readOnly,
    },
    () => run(() => client.getNetworkStats(), summarizeNetworkStats),
  );

  server.registerTool(
    'get_pipeline_status',
    {
      title: 'Get the refresh-pipeline status',
      description:
        "Status of Dig's own data-refresh pipeline over the last 24 hours (not a Stellar network uptime " +
        'probe): overall state, last run, missed cycles, gaps, per-component state and 24h availability, ' +
        'price-source summary. Per-run segment arrays are replaced by counts plus the last segment to keep ' +
        'the payload small; the full payload is GET /v1/ops/status.',
      inputSchema: {},
      annotations: readOnly,
    },
    () =>
      run(
        () => client.getOpsStatus(),
        summarizePipelineStatus,
        condensePipelineStatus,
      ),
  );

  return server;
}

async function run<T>(
  call: () => Promise<T>,
  summarize: (payload: T) => string,
  shape: (payload: T) => unknown = (payload) => payload,
): Promise<CallToolResult> {
  let payload: T;
  try {
    payload = await call();
  } catch (error) {
    return toolError(error);
  }
  return {
    content: [
      { type: 'text', text: summarize(payload) },
      { type: 'text', text: JSON.stringify(shape(payload)) },
    ],
  };
}

/** The API's own message, the status, nothing else: no URL internals, no stack trace. */
function toolError(error: unknown): CallToolResult {
  let text: string;
  if (error instanceof DigApiError) {
    const message =
      error.body && typeof error.body === 'object' && 'message' in error.body
        ? String(error.body.message)
        : error.rawBody.slice(0, 200) || 'no body';
    const retry = error.retryAfterSeconds !== undefined ? ` (retry after ${error.retryAfterSeconds}s)` : '';
    text = `API error ${error.status}: ${message}${retry}`;
  } else if (error instanceof DigTimeoutError) {
    text = `API request timed out after ${error.timeoutMs} ms`;
  } else {
    text = `API request failed: ${error instanceof Error ? error.message : String(error)}`;
  }
  return { isError: true, content: [{ type: 'text', text }] };
}
