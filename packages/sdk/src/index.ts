// @getdig/stellar-api — typed client for the Dig Stellar public read API.
// The generated types in ./generated/openapi.d.ts ARE the contract; everything here is a
// thin, dependency-free layer over `fetch`.
export {
  DigStellarClient,
  DEFAULT_BASE_URL,
  DEFAULT_TIMEOUT_MS,
  type DigStellarClientOptions,
  type FetchLike,
} from './client';
export { DigApiError, DigTimeoutError, parseRetryAfter, type ApiErrorBody } from './errors';
export { isStale, asOfDate } from './freshness';
export { SDK_VERSION } from './version';
export type * from './types';
export type { paths, components, operations } from './generated/openapi';
