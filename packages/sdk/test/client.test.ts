import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_BASE_URL, DigStellarClient } from '../src/client';
import { DigApiError, DigTimeoutError } from '../src/errors';
import { stubFetch } from './helpers';

describe('DigStellarClient: request building', () => {
  it('defaults to the production base URL and trims a trailing slash', async () => {
    const a = stubFetch({ body: [] });
    await new DigStellarClient({ fetch: a.fetch }).listProtocols();
    assert.equal(a.calls[0]?.url, `${DEFAULT_BASE_URL}/v1/protocols`);

    const b = stubFetch({ body: [] });
    await new DigStellarClient({ fetch: b.fetch, baseUrl: 'http://localhost:3000/' }).listProtocols();
    assert.equal(b.calls[0]?.url, 'http://localhost:3000/v1/protocols');
  });

  it('listPools: GET /v1/pools with protocol, sort and order as query', async () => {
    const { fetch, calls } = stubFetch({ body: [] });
    const client = new DigStellarClient({ fetch, baseUrl: 'http://api.test' });
    await client.listPools({ protocol: 'blend', sort: 'tvlUsd', order: 'desc' });
    assert.equal(calls[0]?.url, 'http://api.test/v1/pools?protocol=blend&sort=tvlUsd&order=desc');
    assert.equal(calls[0]?.init.method, 'GET');
    assert.equal(calls[0]?.init.body, undefined);
  });

  it('listPools: omits undefined query values and sends no "?" when empty', async () => {
    const { fetch, calls } = stubFetch({ body: [] });
    const client = new DigStellarClient({ fetch, baseUrl: 'http://api.test' });
    await client.listPools({ sort: 'name', protocol: undefined });
    await client.listPools();
    assert.equal(calls[0]?.url, 'http://api.test/v1/pools?sort=name');
    assert.equal(calls[1]?.url, 'http://api.test/v1/pools');
  });

  it('getPoolFlows: encodes the slug in the path and sends window', async () => {
    const { fetch, calls } = stubFetch({ body: {} });
    const client = new DigStellarClient({ fetch, baseUrl: 'http://api.test' });
    await client.getPoolFlows('aquarius-aqua-usdc-clpool', { window: '30d' });
    await client.getPoolFlows('weird slug/with?chars');
    assert.equal(calls[0]?.url, 'http://api.test/v1/pools/aquarius-aqua-usdc-clpool/flows?window=30d');
    assert.equal(calls[1]?.url, 'http://api.test/v1/pools/weird%20slug%2Fwith%3Fchars/flows');
  });

  it('listBridgeFlows: direction and numeric limit', async () => {
    const { fetch, calls } = stubFetch({ body: { flows: [] } });
    const client = new DigStellarClient({ fetch, baseUrl: 'http://api.test' });
    await client.listBridgeFlows({ direction: 'inflow', limit: 5 });
    assert.equal(calls[0]?.url, 'http://api.test/v1/bridge/flows?direction=inflow&limit=5');
  });

  it('quoteSdexSwap: POST with a JSON body and content-type', async () => {
    const { fetch, calls } = stubFetch({ body: {} });
    const client = new DigStellarClient({ fetch, baseUrl: 'http://api.test' });
    const body = { fromAsset: 'XLM', toAsset: 'USDC', amount: '10', network: 'testnet' } as const;
    await client.quoteSdexSwap(body);
    assert.equal(calls[0]?.url, 'http://api.test/v1/actions/sdex/quote');
    assert.equal(calls[0]?.init.method, 'POST');
    assert.equal(calls[0]?.init.body, JSON.stringify(body));
    const headers = calls[0]?.init.headers as Record<string, string>;
    assert.equal(headers['content-type'], 'application/json');
    assert.equal(headers['accept'], 'application/json');
  });

  it('sends the SDK user agent by default and a custom one when given', async () => {
    const a = stubFetch({ body: {} });
    await new DigStellarClient({ fetch: a.fetch }).getHealth();
    assert.match((a.calls[0]?.init.headers as Record<string, string>)['user-agent'] ?? '', /^@getdig\/stellar-api\/\d+\.\d+\.\d+$/);

    const b = stubFetch({ body: {} });
    await new DigStellarClient({ fetch: b.fetch, userAgent: 'my-bot/1.0' }).getHealth();
    assert.equal((b.calls[0]?.init.headers as Record<string, string>)['user-agent'], 'my-bot/1.0');
  });

  it('returns the parsed JSON body on 2xx', async () => {
    const { fetch } = stubFetch({ body: { status: 'ok', version: 'abc1234' } });
    const health = await new DigStellarClient({ fetch }).getHealth();
    assert.equal(health.status, 'ok');
    assert.equal(health.version, 'abc1234');
  });
});

describe('DigStellarClient: errors', () => {
  it('maps a documented 404 to DigApiError with the NestError body', async () => {
    const body = { statusCode: 404, error: 'Not Found', message: 'Pool not found: nope' };
    const { fetch } = stubFetch({ status: 404, body });
    const client = new DigStellarClient({ fetch, baseUrl: 'http://api.test' });
    await assert.rejects(client.getPool('nope'), (error: unknown) => {
      assert.ok(error instanceof DigApiError);
      assert.equal(error.name, 'DigApiError');
      assert.equal(error.status, 404);
      assert.equal(error.method, 'GET');
      assert.equal(error.url, 'http://api.test/v1/pools/nope');
      assert.deepEqual(error.body, body);
      assert.equal(error.rawBody, JSON.stringify(body));
      assert.equal(error.retryAfterSeconds, undefined);
      assert.equal(error.isRateLimited, false);
      assert.match(error.message, /404: Pool not found: nope/);
      return true;
    });
  });

  it('maps the edge 429 and parses Retry-After seconds', async () => {
    const body = { statusCode: 429, error: 'Too Many Requests', message: 'Rate limit exceeded - please slow down.' };
    const { fetch } = stubFetch({ status: 429, body, headers: { 'retry-after': '1' } });
    await assert.rejects(new DigStellarClient({ fetch }).listPools(), (error: unknown) => {
      assert.ok(error instanceof DigApiError);
      assert.equal(error.status, 429);
      assert.equal(error.isRateLimited, true);
      assert.equal(error.retryAfterSeconds, 1);
      assert.deepEqual(error.body, body);
      return true;
    });
  });

  it('429 without a readable Retry-After leaves retryAfterSeconds undefined', async () => {
    const { fetch } = stubFetch({ status: 429, body: { statusCode: 429, error: 'x', message: 'y' } });
    await assert.rejects(new DigStellarClient({ fetch }).listPools(), (error: unknown) => {
      assert.ok(error instanceof DigApiError);
      assert.equal(error.retryAfterSeconds, undefined);
      return true;
    });
  });

  it('keeps a non-JSON error body as rawBody with body undefined', async () => {
    const { fetch } = stubFetch({ status: 502, rawBody: '<html>Bad Gateway</html>' });
    await assert.rejects(new DigStellarClient({ fetch }).getNetworkStats(), (error: unknown) => {
      assert.ok(error instanceof DigApiError);
      assert.equal(error.status, 502);
      assert.equal(error.body, undefined);
      assert.equal(error.rawBody, '<html>Bad Gateway</html>');
      assert.match(error.message, /502: <html>Bad Gateway<\/html>/);
      return true;
    });
  });

  it('aborts after timeoutMs and throws DigTimeoutError', async () => {
    const fetch = (_url: string, init: RequestInit): Promise<Response> =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(new DOMException('This operation was aborted', 'AbortError'));
        });
      });
    const client = new DigStellarClient({ fetch, baseUrl: 'http://api.test', timeoutMs: 20 });
    await assert.rejects(client.getOpsStatus(), (error: unknown) => {
      assert.ok(error instanceof DigTimeoutError);
      assert.equal(error.name, 'DigTimeoutError');
      assert.equal(error.timeoutMs, 20);
      assert.equal(error.url, 'http://api.test/v1/ops/status');
      return true;
    });
  });

  it('rethrows a network failure untouched (not a timeout)', async () => {
    const boom = new TypeError('fetch failed');
    const fetch = async (): Promise<Response> => {
      throw boom;
    };
    await assert.rejects(new DigStellarClient({ fetch }).getHealth(), (error: unknown) => error === boom);
  });
});
