// Named aliases over the generated contract types. The generated file is the contract;
// these names only save consumers the `components["schemas"][...]` spelling.
import type { components, operations } from './generated/openapi';

export type Schemas = components['schemas'];

// Shared
export type FreshnessMeta = Schemas['FreshnessMeta'];
export type NestError = Schemas['NestError'];
export type NestInternalError = Schemas['NestInternalError'];
export type RateLimited = Schemas['RateLimited'];

// Health
export type HealthPayload = Schemas['HealthPayload'];
export type HealthVenueFreshness = Schemas['HealthVenueFreshness'];

// Protocols & pools
export type ProtocolSummary = Schemas['ProtocolSummary'];
export type PoolSummary = Schemas['PoolSummary'];
export type PoolDetail = Schemas['PoolDetail'];
export type PoolDetailAmm = Schemas['PoolDetailAmm'];
export type PoolDetailLending = Schemas['PoolDetailLending'];
export type PoolFlows = Schemas['PoolFlows'];
export type PoolSeries = Schemas['PoolSeries'];

// Network
export type NetworkStats = Schemas['NetworkStats'];
export type NetworkTvlSeries = Schemas['NetworkTvlSeries'];

// Bridge
export type BridgeSummary = Schemas['BridgeSummary'];
export type BridgeFlows = Schemas['BridgeFlows'];
export type BridgeSeries = Schemas['BridgeSeries'];

// Operations
export type OpsStatus = Schemas['OpsStatus'];
export type OpsMetrics = Schemas['OpsMetrics'];
export type OpsAdoption = Schemas['OpsAdoption'];

// Quotes
export type SdexQuoteRequest = Schemas['SdexQuoteRequest'];
export type SdexQuote = Schemas['SdexQuote'];

// Query parameters, one per operation that has any (names are the spec operationIds).
export type ListPoolsQuery = NonNullable<operations['listPools']['parameters']['query']>;
export type GetPoolFlowsQuery = NonNullable<operations['getPoolFlows']['parameters']['query']>;
export type GetBridgeSummaryQuery = NonNullable<
  operations['getBridgeSummary']['parameters']['query']
>;
export type ListBridgeFlowsQuery = NonNullable<
  operations['listBridgeFlows']['parameters']['query']
>;
export type GetBridgeSeriesQuery = NonNullable<
  operations['getBridgeSeries']['parameters']['query']
>;
export type GetOpsStatusQuery = NonNullable<operations['getOpsStatus']['parameters']['query']>;

// The JSON body of an operation's 200 response, read from the generated `operations`.
export type JsonResponse<Op extends keyof operations> =
  operations[Op]['responses'] extends { 200: { content: { 'application/json': infer T } } }
    ? T
    : never;
