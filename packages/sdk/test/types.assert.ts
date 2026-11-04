// Type-level test: the client's method signatures resolve to the generated contract types.
// Checked by `pnpm typecheck` (tsc --noEmit); not executed. A mismatch between a method
// and the spec makes this file fail to compile.
import type { components, operations } from '../src/generated/openapi';
import type { DigStellarClient } from '../src/client';
import type { DigApiError } from '../src/errors';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

type Result<M extends keyof DigStellarClient> = DigStellarClient[M] extends (
  ...args: never[]
) => Promise<infer R>
  ? R
  : never;

type S = components['schemas'];

// Every public operation of the spec has a method whose result is the spec's 200 body.
export type _ops = [
  Expect<Equal<Result<'getHealth'>, S['HealthPayload']>>,
  Expect<Equal<Result<'listProtocols'>, S['ProtocolSummary'][]>>,
  Expect<Equal<Result<'listPools'>, S['PoolSummary'][]>>,
  Expect<Equal<Result<'getPool'>, S['PoolDetail']>>,
  Expect<Equal<Result<'getPoolFlows'>, S['PoolFlows']>>,
  Expect<Equal<Result<'getPoolSeries'>, S['PoolSeries']>>,
  Expect<Equal<Result<'getNetworkStats'>, S['NetworkStats']>>,
  Expect<Equal<Result<'getNetworkTvlSeries'>, S['NetworkTvlSeries']>>,
  Expect<Equal<Result<'getBridgeSummary'>, S['BridgeSummary']>>,
  Expect<Equal<Result<'listBridgeFlows'>, S['BridgeFlows']>>,
  Expect<Equal<Result<'getBridgeSeries'>, S['BridgeSeries']>>,
  Expect<Equal<Result<'getOpsStatus'>, S['OpsStatus']>>,
  Expect<Equal<Result<'getOpsMetrics'>, S['OpsMetrics']>>,
  Expect<Equal<Result<'getOpsAdoption'>, S['OpsAdoption']>>,
  Expect<Equal<Result<'quoteSdexSwap'>, S['SdexQuote']>>,
];

// The operationId set of the spec is exactly the method set above (a new operation in the
// yaml fails here until the client gains its method).
type OperationIds = keyof operations;
type ClientMethods = {
  [K in keyof DigStellarClient]: DigStellarClient[K] extends (...args: never[]) => Promise<unknown> ? K : never;
}[keyof DigStellarClient];
export type _coverage = [Expect<Equal<OperationIds, ClientMethods>>];

// Query parameters are the spec's.
export type _queries = [
  Expect<Equal<Parameters<DigStellarClient['listPools']>[0], operations['listPools']['parameters']['query']>>,
  Expect<Equal<Parameters<DigStellarClient['getPoolFlows']>[1], operations['getPoolFlows']['parameters']['query']>>,
  Expect<Equal<Parameters<DigStellarClient['listBridgeFlows']>[0], operations['listBridgeFlows']['parameters']['query']>>,
  Expect<Equal<Parameters<DigStellarClient['quoteSdexSwap']>[0], S['SdexQuoteRequest']>>,
];

// Error body is the union of the documented error shapes.
export type _errors = [
  Expect<Equal<DigApiError['body'], S['NestError'] | S['NestInternalError'] | S['RateLimited'] | undefined>>,
];

// PoolDetail narrows by the discriminating arrays.
export function narrow(pool: S['PoolDetail']): number {
  return 'reserves' in pool ? pool.reserves.length : pool.tokens.length;
}
