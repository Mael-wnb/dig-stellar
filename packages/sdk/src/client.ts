import { DigApiError, DigTimeoutError, parseRetryAfter, type ApiErrorBody } from './errors';
import type {
  GetBridgeSeriesQuery,
  GetBridgeSummaryQuery,
  GetOpsStatusQuery,
  GetPoolFlowsQuery,
  JsonResponse,
  ListBridgeFlowsQuery,
  ListPoolsQuery,
  SdexQuoteRequest,
} from './types';
import { SDK_VERSION } from './version';

export const DEFAULT_BASE_URL = 'https://stellar-api.getdig.ai';
export const DEFAULT_TIMEOUT_MS = 10_000;

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface DigStellarClientOptions {
  /** API origin, no trailing slash needed. Default: the production API. */
  baseUrl?: string;
  /** `fetch` implementation. Default: `globalThis.fetch` (Node 18+, browsers, workers). */
  fetch?: FetchLike;
  /** Per-request timeout; the request is aborted and `DigTimeoutError` thrown. `0` disables. Default 10 000. */
  timeoutMs?: number;
  /** Sent as `User-Agent` (browsers drop the header). Default `@getdig/stellar-api/<version>`. */
  userAgent?: string;
}

type QueryValue = string | number | boolean | undefined;

/**
 * Typed client for the Dig Stellar public read API. One method per operation in
 * `apps/api/openapi/openapi.v1.yaml`, named after its `operationId`. Every non-2xx
 * answer throws `DigApiError`; a timeout throws `DigTimeoutError`; a network failure
 * surfaces as the underlying `fetch` error. No retries (v0).
 */
export class DigStellarClient {
  readonly baseUrl: string;
  readonly timeoutMs: number;
  readonly userAgent: string;
  private readonly fetchImpl: FetchLike;

  constructor(options: DigStellarClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.userAgent = options.userAgent ?? `@getdig/stellar-api/${SDK_VERSION}`;
    const fetchImpl = options.fetch ?? (globalThis.fetch as FetchLike | undefined);
    if (!fetchImpl) {
      throw new Error('No fetch available: pass `fetch` in DigStellarClientOptions');
    }
    this.fetchImpl = fetchImpl;
  }

  // ── Health ────────────────────────────────────────────────────────────────────

  /** `GET /health` (stable). Throws `DigApiError` with status 503 when the database is unreachable. */
  getHealth(): Promise<JsonResponse<'getHealth'>> {
    return this.get('/health');
  }

  // ── Protocols & pools ─────────────────────────────────────────────────────────

  /** `GET /v1/protocols` (stable). */
  listProtocols(): Promise<JsonResponse<'listProtocols'>> {
    return this.get('/v1/protocols');
  }

  /** `GET /v1/pools` (stable). */
  listPools(query: ListPoolsQuery = {}): Promise<JsonResponse<'listPools'>> {
    return this.get('/v1/pools', query);
  }

  /** `GET /v1/pools/{slug}` (stable). 404 → `DigApiError`. */
  getPool(slug: string): Promise<JsonResponse<'getPool'>> {
    return this.get(`/v1/pools/${encodeURIComponent(slug)}`);
  }

  /** `GET /v1/pools/{slug}/flows` (beta). */
  getPoolFlows(slug: string, query: GetPoolFlowsQuery = {}): Promise<JsonResponse<'getPoolFlows'>> {
    return this.get(`/v1/pools/${encodeURIComponent(slug)}/flows`, query);
  }

  /** `GET /v1/pools/{slug}/series` (beta). */
  getPoolSeries(slug: string): Promise<JsonResponse<'getPoolSeries'>> {
    return this.get(`/v1/pools/${encodeURIComponent(slug)}/series`);
  }

  // ── Network ───────────────────────────────────────────────────────────────────

  /** `GET /v1/network/stats` (stable). */
  getNetworkStats(): Promise<JsonResponse<'getNetworkStats'>> {
    return this.get('/v1/network/stats');
  }

  /** `GET /v1/network/tvl-series` (stable). */
  getNetworkTvlSeries(): Promise<JsonResponse<'getNetworkTvlSeries'>> {
    return this.get('/v1/network/tvl-series');
  }

  // ── Bridge ────────────────────────────────────────────────────────────────────

  /** `GET /v1/bridge/summary` (stable). */
  getBridgeSummary(query: GetBridgeSummaryQuery = {}): Promise<JsonResponse<'getBridgeSummary'>> {
    return this.get('/v1/bridge/summary', query);
  }

  /** `GET /v1/bridge/flows` (stable). */
  listBridgeFlows(query: ListBridgeFlowsQuery = {}): Promise<JsonResponse<'listBridgeFlows'>> {
    return this.get('/v1/bridge/flows', query);
  }

  /** `GET /v1/bridge/series` (stable). */
  getBridgeSeries(query: GetBridgeSeriesQuery = {}): Promise<JsonResponse<'getBridgeSeries'>> {
    return this.get('/v1/bridge/series', query);
  }

  // ── Operations ────────────────────────────────────────────────────────────────

  /** `GET /v1/ops/status` (beta). */
  getOpsStatus(query: GetOpsStatusQuery = {}): Promise<JsonResponse<'getOpsStatus'>> {
    return this.get('/v1/ops/status', query);
  }

  /** `GET /v1/ops/metrics` (beta). */
  getOpsMetrics(): Promise<JsonResponse<'getOpsMetrics'>> {
    return this.get('/v1/ops/metrics');
  }

  /** `GET /v1/ops/adoption` (beta). */
  getOpsAdoption(): Promise<JsonResponse<'getOpsAdoption'>> {
    return this.get('/v1/ops/adoption');
  }

  // ── Quotes ────────────────────────────────────────────────────────────────────

  /** `POST /v1/actions/sdex/quote` (beta). Read-only price lookup; nothing is built or signed. */
  quoteSdexSwap(body: SdexQuoteRequest): Promise<JsonResponse<'quoteSdexSwap'>> {
    return this.request('POST', '/v1/actions/sdex/quote', undefined, body);
  }

  // ── Transport ─────────────────────────────────────────────────────────────────

  private get<T>(path: string, query?: Record<string, QueryValue>): Promise<T> {
    return this.request<T>('GET', path, query);
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    query?: Record<string, QueryValue>,
    body?: unknown,
  ): Promise<T> {
    const url = this.buildUrl(path, query);
    const headers: Record<string, string> = {
      accept: 'application/json',
      'user-agent': this.userAgent,
    };
    if (body !== undefined) headers['content-type'] = 'application/json';

    const controller = new AbortController();
    const timer =
      this.timeoutMs > 0 ? setTimeout(() => controller.abort(), this.timeoutMs) : undefined;

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) throw new DigTimeoutError(method, url, this.timeoutMs);
      throw error;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }

    const rawBody = await response.text();
    const json = parseJson(rawBody);

    if (!response.ok) {
      throw new DigApiError({
        status: response.status,
        method,
        url,
        body: json as ApiErrorBody | undefined,
        rawBody,
        retryAfterSeconds:
          response.status === 429 ? parseRetryAfter(response.headers.get('retry-after')) : undefined,
      });
    }

    return json as T;
  }

  private buildUrl(path: string, query?: Record<string, QueryValue>): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) params.set(key, String(value));
    }
    const qs = params.toString();
    return `${this.baseUrl}${path}${qs ? `?${qs}` : ''}`;
  }
}

function parseJson(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}
