import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { SERVER_INSTRUCTIONS, TOOL_NAMES } from '../src/server';
import { routes } from './fixtures';
import { connectedClient } from './helpers';

describe('tool registration', () => {
  let ctx: Awaited<ReturnType<typeof connectedClient>>;
  before(async () => {
    ctx = await connectedClient(routes);
  });
  after(() => ctx.close());

  it('exposes exactly the six read-only tools', async () => {
    const { tools } = await ctx.client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), [...TOOL_NAMES].sort());
    for (const tool of tools) {
      assert.ok(tool.description && tool.description.length > 40, `${tool.name} has a description`);
      assert.equal(tool.annotations?.readOnlyHint, true, `${tool.name} is read-only`);
      assert.equal(tool.annotations?.destructiveHint, false, `${tool.name} is not destructive`);
    }
  });

  it('input schemas: slug required on get_pool and get_pool_series, list_pools optional filters', async () => {
    const { tools } = await ctx.client.listTools();
    const byName = new Map(tools.map((t) => [t.name, t]));
    for (const name of ['get_pool', 'get_pool_series']) {
      const schema = byName.get(name)?.inputSchema as { properties: Record<string, unknown>; required?: string[] };
      assert.deepEqual(Object.keys(schema.properties), ['slug']);
      assert.deepEqual(schema.required, ['slug']);
    }
    const pools = byName.get('list_pools')?.inputSchema as {
      properties: Record<string, { enum?: string[] }>;
      required?: string[];
    };
    assert.deepEqual(Object.keys(pools.properties).sort(), ['order', 'protocol', 'sort']);
    assert.deepEqual(pools.required ?? [], []);
    assert.deepEqual(pools.properties.sort?.enum, ['tvlUsd', 'volume24hUsd', 'fees24hUsd', 'supplyApy', 'borrowApy', 'name', 'protocol']);
    assert.deepEqual(pools.properties.order?.enum, ['asc', 'desc']);
    for (const name of ['list_protocols', 'get_network_stats', 'get_pipeline_status']) {
      const schema = byName.get(name)?.inputSchema as { properties?: Record<string, unknown> };
      assert.deepEqual(Object.keys(schema.properties ?? {}), [], `${name} takes no input`);
    }
  });

  it('declares itself read-only in the server instructions', () => {
    assert.match(SERVER_INSTRUCTIONS, /No wallet, no transaction, no key, no write/);
    assert.match(ctx.client.getInstructions() ?? '', /No wallet, no transaction, no key, no write/);
  });
});
