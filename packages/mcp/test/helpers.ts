import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { DigStellarClientOptions } from '@getdig/stellar-api';
import { createServer } from '../src/server';

export interface Route {
  status?: number;
  body: unknown;
}

export interface RecordedCall {
  url: string;
  init: RequestInit;
}

/** A fetch stub routed by URL path (query included); unknown paths answer a Nest-style 404. */
export function routedFetch(routes: Record<string, Route>): {
  fetch: NonNullable<DigStellarClientOptions['fetch']>;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const fetch: NonNullable<DigStellarClientOptions['fetch']> = async (url, init) => {
    calls.push({ url, init });
    const { pathname, search } = new URL(url);
    const route = routes[pathname + search] ?? routes[pathname];
    if (!route) {
      return new Response(
        JSON.stringify({ statusCode: 404, error: 'Not Found', message: `Cannot GET ${pathname}` }),
        { status: 404, headers: { 'content-type': 'application/json' } },
      );
    }
    return new Response(JSON.stringify(route.body), {
      status: route.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { fetch, calls };
}

/** A server wired to an in-memory client, the API answered by `routes`. */
export async function connectedClient(routes: Record<string, Route>): Promise<{
  client: Client;
  calls: RecordedCall[];
  close: () => Promise<void>;
}> {
  const { fetch, calls } = routedFetch(routes);
  const server = createServer({ fetch, baseUrl: 'http://api.test' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new McpClient({ name: 'test-client', version: '0.0.0' });
  await client.connect(clientTransport);
  return {
    client,
    calls,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

export interface TextResult {
  isError: boolean;
  summary: string;
  json: string | undefined;
}

/** Reads a tool result as [summary, json] text blocks. */
export function textOf(result: unknown): TextResult {
  const r = result as { isError?: boolean; content: Array<{ type: string; text?: string }> };
  const texts = r.content.filter((c) => c.type === 'text').map((c) => c.text ?? '');
  return { isError: r.isError === true, summary: texts[0] ?? '', json: texts[1] };
}
