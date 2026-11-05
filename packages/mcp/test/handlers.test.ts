import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { condensePipelineStatus, summarizePipelineStatus } from '../src/summaries';
import * as fx from './fixtures';
import { connectedClient, textOf } from './helpers';

describe('tool handlers (mocked API)', () => {
  let ctx: Awaited<ReturnType<typeof connectedClient>>;
  before(async () => {
    ctx = await connectedClient(fx.routes);
  });
  after(() => ctx.close());

  it('list_protocols: summary with per-protocol TVL and row freshness, payload verbatim', async () => {
    const r = textOf(await ctx.client.callTool({ name: 'list_protocols', arguments: {} }));
    assert.equal(r.isError, false);
    assert.match(r.summary, /^2 protocols: Blend \(lending, TVL \$161\.0M\), Aquarius \(amm, TVL \$40\.0M\); /);
    assert.match(r.summary, /isStale=true for 1\/2 rows, asOf oldest=2026-11-05T10:00:00\.000Z newest=2026-11-05T15:00:40\.000Z$/);
    assert.deepEqual(JSON.parse(r.json ?? ''), fx.protocols);
  });

  it('list_pools: default call, summary names the first row and freshness', async () => {
    const r = textOf(await ctx.client.callTool({ name: 'list_pools', arguments: {} }));
    assert.equal(r.isError, false);
    assert.match(r.summary, /^2 pools \(all protocols, sort=tvlUsd desc\); first: blend-fixed-pool \[Blend, lending_pool\] TVL \$156\.5M, supply APY 4\.12%, borrow APY 7\.10%; isStale=true for 0\/2 rows/);
    assert.deepEqual(JSON.parse(r.json ?? ''), fx.pools);
  });

  it('list_pools: protocol, sort and order reach the API as query parameters', async () => {
    const r = textOf(
      await ctx.client.callTool({ name: 'list_pools', arguments: { protocol: 'blend', sort: 'supplyApy', order: 'desc' } }),
    );
    assert.equal(r.isError, false);
    const last = ctx.calls[ctx.calls.length - 1];
    assert.equal(last?.url, 'http://api.test/v1/pools?protocol=blend&sort=supplyApy&order=desc');
    assert.match(r.summary, /^1 pools \(protocol=blend, sort=supplyApy desc\)/);
    assert.equal((last?.init.headers as Record<string, string>)['user-agent'], '@getdig/stellar-mcp/0.1.0');
  });

  it('list_pools: rejects an unknown sort key before any API call', async () => {
    const before = ctx.calls.length;
    const r = textOf(await ctx.client.callTool({ name: 'list_pools', arguments: { sort: 'apy' } }));
    assert.equal(r.isError, true);
    assert.equal(ctx.calls.length, before);
  });

  it('get_pool: lending pool summary (supplied, borrowed, APYs, reserves) ending with freshness', async () => {
    const r = textOf(await ctx.client.callTool({ name: 'get_pool', arguments: { slug: 'blend-fixed-pool' } }));
    assert.equal(r.isError, false);
    assert.equal(
      r.summary,
      'Fixed Pool [Blend, lending_pool]: TVL $156.5M, supplied $200.0M, borrowed $50.0M, supply APY 4.12%, borrow APY 7.10%, 2 reserves; isStale=false, asOf=2026-11-05T15:00:40.000Z',
    );
    assert.deepEqual(JSON.parse(r.json ?? ''), fx.poolLending);
  });

  it('get_pool: AMM pool summary (volume, fees, swaps, tokens) flags stale data', async () => {
    const r = textOf(await ctx.client.callTool({ name: 'get_pool', arguments: { slug: 'aquarius-aqua-usdc-pool' } }));
    assert.equal(r.isError, false);
    assert.equal(
      r.summary,
      'AQUA/USDC [Aquarius, amm_pool]: TVL $2.0M, 24h volume $120.0K, 24h fees $360.00, 24h swaps 410, 2 tokens; isStale=true, asOf=2026-11-05T10:00:00.000Z',
    );
  });

  it('get_pool: 404 becomes a tool error carrying the API message, no stack trace, no URL', async () => {
    const r = textOf(await ctx.client.callTool({ name: 'get_pool', arguments: { slug: 'does-not-exist' } }));
    assert.equal(r.isError, true);
    assert.equal(r.summary, 'API error 404: Cannot GET /v1/pools/does-not-exist');
    assert.equal(r.json, undefined);
    assert.doesNotMatch(r.summary, /\n\s+at /);
    assert.doesNotMatch(r.summary, /http:\/\//);
  });

  it('get_pool_series: point count, range, latest value, request-time freshness', async () => {
    const r = textOf(await ctx.client.callTool({ name: 'get_pool_series', arguments: { slug: 'blend-fixed-pool' } }));
    assert.equal(r.isError, false);
    assert.equal(
      r.summary,
      'blend-fixed-pool: 3 daily TVL points 2026-11-03..2026-11-05, latest $156.5M on 2026-11-05; isStale=n/a (series computed at request time from daily snapshots), asOf=2026-11-05T15:07:21.542Z',
    );
    assert.deepEqual(JSON.parse(r.json ?? ''), fx.series);
  });

  it('get_network_stats: price, TVL, counts, freshness', async () => {
    const r = textOf(await ctx.client.callTool({ name: 'get_network_stats', arguments: {} }));
    assert.equal(r.isError, false);
    assert.equal(
      r.summary,
      'XLM $0.3012 (-1.25% 24h), tracked Stellar DeFi TVL $230.1M across 6 protocols, active wallets 120,000, 24h DEX volume $3.2M, USDC supply $450.0M; isStale=false, asOf=2026-11-05T15:00:07.000Z',
    );
    assert.deepEqual(JSON.parse(r.json ?? ''), fx.networkStats);
  });

  it('get_pipeline_status: condensed payload (counts instead of runs/segments), state summary', async () => {
    const r = textOf(await ctx.client.callTool({ name: 'get_pipeline_status', arguments: {} }));
    assert.equal(r.isError, false);
    assert.match(r.summary, /^Dig refresh pipeline \(24h\): operational, last run 2026-11-05T15:00:07\.000Z, 0 missed cycles and 0 failed steps in 24h, 2 runs, 0 gaps, components: 1 ok, 1 degraded; isStale=(true|false), asOf=2026-11-05T15:00:07\.000Z$/);
    const payload = JSON.parse(r.json ?? '') as Record<string, unknown>;
    assert.equal(payload.runs, undefined);
    assert.equal(payload.runCount, 2);
    const components = payload.components as Array<Record<string, unknown>>;
    assert.equal(components[0]?.segments, undefined);
    assert.equal(components[0]?.segmentCount, 2);
    assert.deepEqual(components[0]?.lastSegment, fx.opsStatus.components[0]?.segments[1]);
    assert.deepEqual(payload.priceSources, fx.opsStatus.priceSources);
    assert.deepEqual(payload, condensePipelineStatus(fx.opsStatus as never));
  });

  it('pipeline staleness is derived from lastRunAt against staleAfterSeconds', () => {
    const status = fx.opsStatus as never;
    const lastRun = Date.parse(fx.opsStatus.overall.lastRunAt);
    assert.match(summarizePipelineStatus(status, lastRun + 60_000), /isStale=false,/);
    assert.match(summarizePipelineStatus(status, lastRun + 2701_000), /isStale=true,/);
  });
});
